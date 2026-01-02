// backend/index.js - CLEAN VERSION
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const socialRoutes = require('./routes/social');
const {
  pool,
  findUserByEmail,
  createUser,
  updatePassword,
  getProfileByEmail,
  updateProfile,
  getAllClubs,
  getClubById,
  getClubMembers,
  getAllAnnouncements,
  getAnnouncementsByClub,
  createAnnouncement,
  deleteAnnouncement,
  updateAnnouncement
} = require("./db");

const app = express();
app.set('trust proxy', 1); // Trust first proxy (Render load balancer)

// ==================== CONFIGURATION ====================

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '1h';
const CODE_TTL = (process.env.CODE_TTL_SECONDS ? parseInt(process.env.CODE_TTL_SECONDS) : 300) * 1000;
const DEV_FALLBACK = String(process.env.DEV_FALLBACK || '').toLowerCase() === 'true';

// ==================== FILE UPLOAD SETUP ====================

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'announcement-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error('Only image files allowed!'));
  }
});

app.use('/uploads', express.static(uploadsDir));

// ==================== MIDDLEWARE ====================

app.use(express.json({ limit: '50mb' }));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || '*' }));

// ==================== EMAIL SETUP ====================

const smtpPort = parseInt(process.env.EMAIL_PORT || '587');
const smtpSecure = (String(process.env.EMAIL_SECURE || '').toLowerCase() === 'true') || smtpPort === 465;

let transporter;

const initializeEmail = async () => {
  try {
    const dns = require('dns').promises;
    console.log('📧 Resolving SMTP Host:', process.env.EMAIL_HOST);

    // Explicitly resolve to IPv4
    const { address } = await dns.lookup(process.env.EMAIL_HOST, { family: 4 });
    console.log(`✅ Resolved ${process.env.EMAIL_HOST} to IPv4: ${address}`);

    transporter = nodemailer.createTransport({
      host: address, // Use the IP directly
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false
      },
      servername: process.env.EMAIL_HOST, // verifying certificate needs this when using IP
    });

    await transporter.verify();
    console.log('✅ SMTP transporter verified connection to ' + address);
  } catch (err) {
    console.warn('❌ SMTP Init Failed:', err.message);
  }
};

// Initialize immediately
initializeEmail();

// Wrapper function to send mail safely
const sendEmailWrapper = async (mailOptions) => {
  if (!transporter) {
    await initializeEmail();
  }
  if (!transporter) {
    throw new Error('Email transporter not initialized');
  }
  return transporter.sendMail(mailOptions);
};

// ==================== OTP CODE STORAGE ====================

const codeStore = new Map();

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function storeCode(email, code) {
  const key = email.toLowerCase();
  const expiresAt = Date.now() + CODE_TTL;
  codeStore.set(key, { code, expiresAt });
}

function validateCode(email, code) {
  const key = email.toLowerCase();
  const rec = codeStore.get(key);
  if (!rec) return false;
  if (Date.now() > rec.expiresAt) {
    codeStore.delete(key);
    return false;
  }
  if (rec.code !== code) return false;
  codeStore.delete(key);
  return true;
}

// ==================== MIDDLEWARE FUNCTIONS ====================

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'missing token' });

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'invalid auth header' });
  }

  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    req.userEmail = payload.sub;
    req.userRole = payload.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

function isCoordinator(req, res, next) {
  const coordinatorEmail = 'bigbossssz550@gmail.com';
  if (req.userEmail !== coordinatorEmail) {
    return res.status(403).json({ ok: false, error: 'Access denied: Admin privileges required' });
  }
  next();
}

// ==================== RATE LIMITING ====================

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 6,
  standardHeaders: true,
  legacyHeaders: false,
});

// ==================== AUTH ROUTES ====================

app.post('/auth/send-code', limiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email required' });
  }

  const code = generateCode();
  storeCode(email, code);
  console.log(`[OTP] stored for ${email.toLowerCase()}: ${code} (expires in ${Math.round(CODE_TTL / 1000)}s)`);

  const fromAddress = process.env.FROM_EMAIL || process.env.EMAIL_USER || 'no-reply@clubhub.local';
  const mailOptions = {
    from: fromAddress,
    to: email,
    subject: 'Your verification code',
    text: `Your verification code is: ${code}`,
    html: `<p>Your verification code is: <strong>${code}</strong></p><p>It expires in ${Math.round(CODE_TTL / 1000)} seconds.</p>`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', { accepted: info.accepted, rejected: info.rejected });
    return res.json({ ok: true, message: 'Code sent' });
  } catch (err) {
    console.error('Error sending email:', err.message);
    if (DEV_FALLBACK) {
      console.warn('DEV_FALLBACK enabled — returning OTP in response');
      return res.json({ ok: true, message: 'Code generated (dev fallback)', code });
    }
    return res.status(500).json({ error: 'failed to send email', detail: err.message });
  }
});

app.post('/auth/verify', async (req, res) => {
  const { email, code, password, confirm } = req.body || {};
  if (!email || !code) {
    return res.status(400).json({ error: 'email and code required' });
  }

  try {
    const ok = validateCode(email, code);
    if (!ok) return res.status(401).json({ error: 'invalid or expired code' });

    const key = email.toLowerCase();
    const existing = await findUserByEmail(key);

    if (password !== undefined) {
      if (typeof password !== 'string' || password.length < 6) {
        return res.status(400).json({ error: 'password must be at least 6 characters' });
      }
      if (password !== confirm) {
        return res.status(400).json({ error: 'password and confirm do not match' });
      }

      const hash = await bcrypt.hash(password, 10);
      if (existing) {
        await updatePassword(key, hash);
        const payload = { sub: key, role: existing.role };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        return res.json({ ok: true, token, user: { email: key, role: existing.role } });
      } else {
        await createUser(key, hash, null);
        const payload = { sub: key, role: null };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
        return res.json({ ok: true, token, user: { email: key, role: null, created: true } });
      }
    } else {
      if (!existing) {
        await createUser(key, null, null);
      }
      const role = existing ? existing.role : null;
      const payload = { sub: key, role };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
      return res.json({ ok: true, token, user: { email: key, role } });
    }
  } catch (err) {
    console.error('Error in /auth/verify:', err);
    return res.status(500).json({ error: 'server error', detail: err.message });
  }
});

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await findUserByEmail(email.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    if (!user.password_hash) {
      return res.status(400).json({ error: "Password not set. Please sign up or reset password." });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    const token = jwt.sign(
      { sub: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.json({
      ok: true,
      token,
      user: { email: user.email, role: user.role }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "server error" });
  }
});

// ==================== USER PROFILE ROUTES ====================

app.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'missing token' });

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return res.status(401).json({ error: 'invalid auth header' });
  }

  try {
    const payload = jwt.verify(parts[1], JWT_SECRET);
    const user = await findUserByEmail(payload.sub);

    if (!user) return res.status(404).json({ error: 'user not found' });

    return res.json({
      ok: true,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
        roll_number: user.roll_number,
        admin_requested: user.admin_requested,
        profile_picture: user.profile_picture,
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(401).json({ error: 'invalid token' });
  }
});

app.get('/profile', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'missing token' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await findUserByEmail(decoded.sub);

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      profile: {
        email: user.email,
        name: user.name,
        branch: user.branch,
        roll_number: user.roll_number,
        role: user.role,
        club_id: user.club_id,
        admin_requested: user.admin_requested,
        requested_at: user.requested_at,
        club_name: user.club_name,
        club_code: user.club_code,
        profile_picture: user.profile_picture,
      }
    });
  } catch (err) {
    console.error('GET /profile error:', err);
    res.status(401).json({ error: 'Unauthorized' });
  }
});

app.post('/profile', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'missing token' });

    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const email = payload.sub.toLowerCase();

    const { name, branch, roll_number, role, club_id } = req.body;

    const currentUser = await findUserByEmail(email);

    if (role && !currentUser.role) {
      if (role === 'student') {
        await updateProfile(email, {
          name: name || null,
          branch: branch || null,
          roll_number: roll_number || null,
          role: 'student',
          club_id: null,
          request_admin: false
        });
      } else if (role === 'club_admin') {
        await updateProfile(email, {
          name: name || null,
          branch: branch || null,
          roll_number: roll_number || null,
          role: null,
          club_id: club_id || null,
          request_admin: true
        });

        // Send email notification to coordinator
        sendAdminRequestEmail(email, name, club_id);
      }
    } else {
      await updateProfile(email, {
        name: name || null,
        branch: branch || null,
        roll_number: roll_number || null,
        role: null,
        club_id: null,
        request_admin: false
      });
    }

    const updatedUser = await findUserByEmail(email);

    return res.json({
      ok: true,
      message: role === 'club_admin' && !currentUser.role
        ? 'Club admin request submitted! Coordinator will review your request.'
        : 'Profile updated successfully',
      profile: updatedUser
    });
  } catch (err) {
    console.error('Profile save error:', err);
    return res.status(500).json({ error: 'server error', detail: err.message });
  }
});

// ==================== CLUB ROUTES ====================

app.get('/clubs', async (req, res) => {
  try {
    const clubs = await getAllClubs();
    return res.json({ ok: true, clubs });
  } catch (err) {
    console.error('Error fetching clubs:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/clubs/:id', async (req, res) => {
  try {
    const clubId = parseInt(req.params.id);
    const club = await getClubById(clubId);

    if (!club) {
      return res.status(404).json({ error: 'Club not found' });
    }

    const members = await getClubMembers(clubId);
    return res.json({ ok: true, club, members });
  } catch (err) {
    console.error('Error fetching club:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// ==================== ANNOUNCEMENT ROUTES ====================

app.get('/announcements', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const { rows: announcements } = await pool.query(`
      SELECT 
        a.id,
        a.club_id,
        a.title,
        a.content,
        a.image_url,
        a.registration_enabled,
        a.registration_deadline,
        a.max_registrations,
        a.created_at,
        a.created_by,
        c.club_name,
        c.club_code
      FROM announcements a
      LEFT JOIN clubs c ON a.club_id = c.id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    console.log(`✓ Fetched ${announcements.length} announcements with registration data`);

    return res.json({ ok: true, announcements });
  } catch (err) {
    console.error('Error fetching announcements:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.get('/announcements/club/:clubId', async (req, res) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const announcements = await getAnnouncementsByClub(clubId);
    return res.json({ ok: true, announcements });
  } catch (err) {
    console.error('Error fetching club announcements:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// REPLACE YOUR EXISTING app.post('/announcements') ROUTE WITH THIS:


// Route removed: duplicate legacy handler that was ignoring registration data.
// The correct handler is located at the bottom of the file.


// REPLACE YOUR notifySubscribers FUNCTION WITH THIS:

async function notifySubscribers(clubId, announcementTitle, announcementContent, announcementId) {
  try {
    console.log('🔔 notifySubscribers called for club:', clubId);

    // Get club details
    const club = await getClubById(clubId);
    if (!club) {
      console.log('❌ Club not found:', clubId);
      return;
    }

    console.log('✅ Club found:', club.club_name);

    // Get all active subscribers with their emails
    const { rows: subscribers } = await pool.query(`
      SELECT u.id, u.email, u.name
      FROM club_subscriptions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.club_id = $1 AND cs.is_active = true AND u.email IS NOT NULL
    `, [clubId]);

    console.log(`📊 Found ${subscribers.length} subscribers for club ${club.club_name}`);

    if (subscribers.length === 0) {
      console.log('⚠️ No subscribers to notify for club', clubId);
      return;
    }

    // Log subscriber details
    subscribers.forEach((sub, i) => {
      console.log(`  ${i + 1}. ${sub.email} (ID: ${sub.id}, Name: ${sub.name || 'N/A'})`);
    });

    console.log('📧 Attempting to send emails...');

    // Send email to each subscriber
    const emailPromises = subscribers.map((subscriber, index) => {
      const mailOptions = {
        from: process.env.FROM_EMAIL || process.env.EMAIL_USER,
        to: subscriber.email,
        subject: `🔔 New Announcement from ${club.club_name} - Club Hub`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                line-height: 1.6; 
                color: #333; 
                margin: 0;
                padding: 0;
                background: #f5f5f5;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: white;
              }
              .header { 
                background: linear-gradient(135deg, #C41E3A, #E63946); 
                padding: 30px; 
                text-align: center; 
                color: white;
              }
              .header h1 { 
                margin: 0; 
                font-size: 24px;
              }
              .club-badge {
                display: inline-block;
                background: rgba(255, 255, 255, 0.2);
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                margin-top: 10px;
              }
              .content { 
                padding: 30px; 
              }
              .greeting {
                font-size: 16px;
                color: #1F2937;
                margin-bottom: 20px;
              }
              .announcement-box {
                background: #F9FAFB;
                border-left: 4px solid #C41E3A;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
              }
              .announcement-title {
                font-size: 20px;
                font-weight: bold;
                color: #1F2937;
                margin-bottom: 15px;
              }
              .announcement-content {
                font-size: 15px;
                color: #4B5563;
                line-height: 1.8;
                white-space: pre-wrap;
              }
              .view-button {
                display: inline-block;
                background: #C41E3A;
                color: white;
                padding: 12px 30px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: bold;
                margin: 20px 0;
              }
              .footer {
                background: #F9FAFB;
                padding: 20px;
                text-align: center;
                color: #6B7280;
                font-size: 14px;
              }
              .unsubscribe {
                margin-top: 15px;
                font-size: 12px;
              }
              .unsubscribe a {
                color: #6B7280;
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔔 New Announcement</h1>
                <div class="club-badge">${club.club_name}</div>
              </div>
              
              <div class="content">
                <p class="greeting">
                  Hi${subscriber.name ? ' ' + subscriber.name.split(' ')[0] : ''},
                </p>
                
                <p>
                  <strong>${club.club_name}</strong> just posted a new announcement!
                </p>
                
                <div class="announcement-box">
                  <div class="announcement-title">${announcementTitle}</div>
                  <div class="announcement-content">${announcementContent.substring(0, 300)}${announcementContent.length > 300 ? '...' : ''}</div>
                </div>
                
                <div style="text-align: center;">
                  <a href="http://localhost:3000/" class="view-button">
                    View Full Announcement
                  </a>
                </div>
                
                <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">
                  You're receiving this because you subscribed to ${club.club_name} on Club Hub.
                </p>
              </div>
              
              <div class="footer">
                <p><strong>Club Hub</strong> - KLE Technological University</p>
                <div class="unsubscribe">
                  Not interested anymore? <a href="http://localhost:3000/clubs.html">Manage your subscriptions</a>
                </div>
              </div>
            </div>
          </body>
          </html>
        `
      };

      console.log(`  📤 Sending email ${index + 1}/${subscribers.length} to ${subscriber.email}...`);

      return transporter.sendMail(mailOptions)
        .then((info) => {
          console.log(`  ✅ Email ${index + 1} sent to ${subscriber.email}`, {
            messageId: info.messageId,
            accepted: info.accepted,
            rejected: info.rejected
          });
        })
        .catch(err => {
          console.error(`  ❌ Failed to send email ${index + 1} to ${subscriber.email}:`, {
            error: err.message,
            code: err.code,
            command: err.command
          });
        });
    });

    await Promise.all(emailPromises);
    console.log(`✅ Completed sending ${subscribers.length} notification emails`);
  } catch (err) {
    console.error('❌ Error in notifySubscribers:', err);
    throw err;
  }
}

app.delete('/announcements/:id', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'missing token' });

    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const email = payload.sub.toLowerCase();

    const announcementId = parseInt(req.params.id);
    const success = await deleteAnnouncement(announcementId, email);

    if (!success) {
      return res.status(404).json({ error: 'announcement not found or unauthorized' });
    }

    return res.json({ ok: true, message: 'Announcement deleted' });
  } catch (err) {
    console.error('Error deleting announcement:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

app.put('/announcements/:id', async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'missing token' });

    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const email = payload.sub.toLowerCase();

    const announcementId = parseInt(req.params.id);
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content required' });
    }

    const success = await updateAnnouncement(announcementId, title, content, email);

    if (!success) {
      return res.status(404).json({ error: 'announcement not found or unauthorized' });
    }

    return res.json({ ok: true, message: 'Announcement updated' });
  } catch (err) {
    console.error('Error updating announcement:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// ==================== ADMIN ROUTES ====================

app.get('/admin/pending-requests', authMiddleware, isCoordinator, async (req, res) => {
  try {
    const { rows: requests } = await pool.query(`
      SELECT 
        u.email,
        u.name,
        u.branch,
        u.roll_number,
        u.club_id,
        u.requested_at,
        c.club_name,
        c.club_code
      FROM users u
      LEFT JOIN clubs c ON u.club_id = c.id
      WHERE u.admin_requested = true AND u.role IS NULL
      ORDER BY u.requested_at DESC
    `);

    res.json({ ok: true, requests });
  } catch (err) {
    console.error('Error fetching pending requests:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch requests' });
  }
});

app.get('/admin/stats', authMiddleware, isCoordinator, async (req, res) => {
  try {
    const { rows: countResult } = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = 'club_admin'"
    );

    res.json({ ok: true, adminCount: countResult[0].count });
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ ok: false, error: 'Failed' });
  }
});

app.post('/admin/approve-request', authMiddleware, isCoordinator, async (req, res) => {
  try {
    const { email, club_id } = req.body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email required' });
    }

    await pool.query(`
      UPDATE users 
      SET role = 'club_admin', 
          admin_requested = false,
          updated_at = NOW()
      WHERE email = $1
    `, [email.toLowerCase()]);

    console.log(`✓ Approved club admin: ${email}`);

    res.json({ ok: true, message: 'Approved successfully' });
  } catch (err) {
    console.error('Error approving:', err);
    res.status(500).json({ ok: false, error: 'Failed to approve' });
  }
});

app.post('/admin/reject-request', authMiddleware, isCoordinator, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ ok: false, error: 'Email required' });
    }

    await pool.execute(`
      UPDATE users 
      SET admin_requested = 0,
          club_id = NULL,
          requested_at = NULL,
          updated_at = NOW()
      WHERE email = ?
    `, [email.toLowerCase()]);

    console.log(`✗ Rejected request: ${email}`);

    res.json({ ok: true, message: 'Rejected' });
  } catch (err) {
    console.error('Error rejecting:', err);
    res.status(500).json({ ok: false, error: 'Failed to reject' });
  }
});

// ==================== EMAIL NOTIFICATION FUNCTION ====================

// UPDATE THE sendAdminRequestEmail FUNCTION IN backend/index.js

async function sendAdminRequestEmail(userEmail, userName, clubId) {
  try {
    let clubName = 'Unknown Club';
    if (clubId) {
      const [clubs] = await pool.execute('SELECT club_name FROM clubs WHERE id = ?', [clubId]);
      if (clubs.length > 0) clubName = clubs[0].club_name;
    }

    // Generate unique token for this request
    const requestToken = jwt.sign(
      {
        action: 'admin_request',
        email: userEmail,
        club_id: clubId,
        timestamp: Date.now()
      },
      JWT_SECRET,
      { expiresIn: '7d' } // Token valid for 7 days
    );

    // Create approve and reject links
    const approveUrl = `http://localhost:4000/admin/approve-via-email?token=${requestToken}`;
    const rejectUrl = `http://localhost:4000/admin/reject-via-email?token=${requestToken}`;

    const mailOptions = {
      from: process.env.FROM_EMAIL || process.env.EMAIL_USER,
      to: 'bigbossssz550@gmail.com',
      subject: '🎯 New Club Admin Request - Club Hub',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              line-height: 1.6; 
              color: #333; 
              margin: 0;
              padding: 0;
            }
            .email-container {
              max-width: 600px;
              margin: 0 auto;
              background: #f5f5f5;
              padding: 20px;
            }
            .header { 
              background: linear-gradient(135deg, #F2B705, #F5C422); 
              padding: 30px; 
              text-align: center; 
              border-radius: 10px 10px 0 0;
            }
            .header h1 { 
              color: #1A1A1A; 
              margin: 0; 
              font-size: 24px;
            }
            .content { 
              background: white; 
              padding: 30px; 
              border: 1px solid #E5E7EB;
            }
            .info-box { 
              background: #F9FAFB; 
              padding: 20px; 
              border-radius: 8px; 
              margin: 20px 0;
              border-left: 4px solid #C41E3A;
            }
            .info-item { 
              margin: 10px 0;
              font-size: 15px;
            }
            .label { 
              font-weight: bold; 
              color: #374151;
              display: inline-block;
              width: 120px;
            }
            .value { 
              color: #1F2937;
            }
            .action-section {
              background: #FFF9E6;
              padding: 25px;
              border-radius: 10px;
              margin: 25px 0;
              border: 2px solid #F2B705;
              text-align: center;
            }
            .action-title {
              font-size: 18px;
              font-weight: bold;
              color: #1A1A1A;
              margin-bottom: 15px;
            }
            .button-group {
              display: flex;
              gap: 15px;
              justify-content: center;
              margin-top: 20px;
            }
            .button { 
              display: inline-block; 
              padding: 15px 40px; 
              text-decoration: none; 
              border-radius: 8px; 
              font-weight: bold;
              font-size: 16px;
              text-align: center;
              cursor: pointer;
            }
            .btn-approve {
              background: #10B981;
              color: white;
            }
            .btn-approve:hover {
              background: #059669;
            }
            .btn-reject {
              background: #EF4444;
              color: white;
            }
            .btn-reject:hover {
              background: #DC2626;
            }
            .dashboard-link {
              text-align: center;
              margin: 20px 0;
              padding: 15px;
              background: #F9FAFB;
              border-radius: 8px;
            }
            .dashboard-link a {
              color: #C41E3A;
              text-decoration: none;
              font-weight: 600;
            }
            .footer { 
              text-align: center; 
              padding: 20px; 
              color: #6B7280; 
              font-size: 14px;
              background: white;
              border-radius: 0 0 10px 10px;
            }
            .warning {
              color: #D97706;
              font-size: 13px;
              margin-top: 15px;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <h1>🎯 New Club Admin Request</h1>
            </div>
            
            <div class="content">
              <p style="font-size: 16px; margin-bottom: 20px;">Hello Coordinator,</p>
              
              <p style="font-size: 15px;">A new club admin access request has been submitted on Club Hub:</p>
              
              <div class="info-box">
                <div class="info-item">
                  <span class="label">Name:</span> 
                  <span class="value">${userName || 'Not provided'}</span>
                </div>
                <div class="info-item">
                  <span class="label">Email:</span> 
                  <span class="value">${userEmail}</span>
                </div>
                <div class="info-item">
                  <span class="label">Requested Club:</span> 
                  <span class="value">${clubName}</span>
                </div>
                <div class="info-item">
                  <span class="label">Date:</span> 
                  <span class="value">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</span>
                </div>
              </div>
              
              <div class="action-section">
                <div class="action-title">⚡ Quick Action - Click to Respond</div>
                <p style="color: #6B7280; font-size: 14px; margin: 10px 0;">
                  Review this request and take action with one click:
                </p>
                
                <div class="button-group">
                  <a href="${approveUrl}" class="button btn-approve">
                    ✓ Approve Request
                  </a>
                  <a href="${rejectUrl}" class="button btn-reject">
                    ✗ Reject Request
                  </a>
                </div>
                
                <p class="warning">
                  ⚠️ These links expire in 7 days
                </p>
              </div>
              
              <div class="dashboard-link">
                <p style="margin: 5px 0; color: #6B7280; font-size: 14px;">
                  Or view all requests in:
                </p>
                <a href="http://localhost:3000/admin-dashboard.html">Admin Dashboard →</a>
              </div>
              
              <p style="color: #6B7280; font-size: 14px; margin-top: 20px;">
                💡 <strong>Tip:</strong> Once approved, the user will immediately gain club admin privileges and can start creating announcements.
              </p>
            </div>
            
            <div class="footer">
              <p style="margin: 5px 0;"><strong>Club Hub</strong> - KLE Technological University</p>
              <p style="margin: 5px 0; font-size: 12px;">This is an automated notification. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✓ Admin notification email sent to bigbossssz550@gmail.com`);
  } catch (err) {
    console.error('Failed to send admin notification email:', err);
    // Don't throw - request should still be saved even if email fails
  }
}

// ==================== ADD THESE NEW ROUTES ====================

// Approve request via email link
app.get('/admin/approve-via-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error - Club Hub</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FEE2E2; margin: 0; }
            .container { background: white; padding: 40px; border-radius: 10px; text-align: center; max-width: 500px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #DC2626; margin-bottom: 20px; }
            p { color: #6B7280; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Invalid Link</h1>
            <p>This approval link is invalid or missing required information.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Expired - Club Hub</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FEF2F2; margin: 0; }
            .container { background: white; padding: 40px; border-radius: 10px; text-align: center; max-width: 500px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #DC2626; margin-bottom: 20px; }
            p { color: #6B7280; line-height: 1.6; }
            .button { display: inline-block; margin-top: 20px; padding: 12px 30px; background: #C41E3A; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⏰ Link Expired</h1>
            <p>This approval link has expired. Please use the admin dashboard to review the request.</p>
            <a href="http://localhost:3000/admin-dashboard.html" class="button">Go to Dashboard</a>
          </div>
        </body>
        </html>
      `);
    }

    const { email, club_id } = decoded;

    // Check if request still exists
    const [requests] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND admin_requested = 1 AND role IS NULL',
      [email.toLowerCase()]
    );

    if (requests.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Already Processed - Club Hub</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FEF3C7; margin: 0; }
            .container { background: white; padding: 40px; border-radius: 10px; text-align: center; max-width: 500px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
            h1 { color: #D97706; margin-bottom: 20px; }
            p { color: #6B7280; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>ℹ️ Already Processed</h1>
            <p>This request has already been approved or rejected.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Approve the request
    await pool.execute(`
      UPDATE users 
      SET role = 'club_admin', 
          admin_requested = 0,
          updated_at = NOW()
      WHERE email = ?
    `, [email.toLowerCase()]);

    console.log(`✓ Approved club admin via email: ${email}`);

    // Success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Approved - Club Hub</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #F2B705, #F5C422); margin: 0; }
          .container { background: white; padding: 50px; border-radius: 15px; text-align: center; max-width: 500px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
          .icon { font-size: 80px; margin-bottom: 20px; }
          h1 { color: #10B981; margin-bottom: 20px; font-size: 28px; }
          p { color: #6B7280; line-height: 1.8; font-size: 16px; }
          .user-info { background: #F9FAFB; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
          .label { font-weight: bold; color: #374151; }
          .value { color: #1F2937; }
          .button { display: inline-block; margin-top: 20px; padding: 12px 30px; background: #C41E3A; color: white; text-decoration: none; border-radius: 8px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">✅</div>
          <h1>Request Approved!</h1>
          <p>The club admin request has been successfully approved.</p>
          <div class="user-info">
            <p><span class="label">User:</span> <span class="value">${email}</span></p>
            <p><span class="label">Status:</span> <span class="value">Now Club Admin</span></p>
            <p><span class="label">Access:</span> <span class="value">Can create announcements</span></p>
          </div>
          <p>The user has been notified and can now access admin features.</p>
          <a href="http://localhost:3000/admin-dashboard.html" class="button">View Dashboard</a>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error approving via email:', err);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - Club Hub</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FEE2E2; margin: 0; }
          .container { background: white; padding: 40px; border-radius: 10px; text-align: center; max-width: 500px; }
          h1 { color: #DC2626; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Failed to process the request. Please try using the admin dashboard instead.</p>
        </div>
      </body>
      </html>
    `);
  }
});

// Reject request via email link
app.get('/admin/reject-via-email', async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).send('<h1>Invalid link</h1>');
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Expired - Club Hub</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FEF2F2; margin: 0; }
            .container { background: white; padding: 40px; border-radius: 10px; text-align: center; max-width: 500px; }
            h1 { color: #DC2626; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>⏰ Link Expired</h1>
            <p>This link has expired. Please use the admin dashboard.</p>
          </div>
        </body>
        </html>
      `);
    }

    const { email } = decoded;

    // Check if request exists
    const [requests] = await pool.execute(
      'SELECT * FROM users WHERE email = ? AND admin_requested = 1 AND role IS NULL',
      [email.toLowerCase()]
    );

    if (requests.length === 0) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Already Processed</title>
          <style>
            body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #FEF3C7; margin: 0; }
            .container { background: white; padding: 40px; border-radius: 10px; text-align: center; max-width: 500px; }
            h1 { color: #D97706; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>ℹ️ Already Processed</h1>
            <p>This request has already been processed.</p>
          </div>
        </body>
        </html>
      `);
    }

    // Reject the request
    await pool.execute(`
      UPDATE users 
      SET admin_requested = 0,
          club_id = NULL,
          requested_at = NULL,
          updated_at = NOW()
      WHERE email = ?
    `, [email.toLowerCase()]);

    console.log(`✗ Rejected club admin via email: ${email}`);

    // Success page
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Rejected - Club Hub</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #F2B705, #F5C422); margin: 0; }
          .container { background: white; padding: 50px; border-radius: 15px; text-align: center; max-width: 500px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
          .icon { font-size: 80px; margin-bottom: 20px; }
          h1 { color: #EF4444; margin-bottom: 20px; font-size: 28px; }
          p { color: #6B7280; line-height: 1.8; font-size: 16px; }
          .user-info { background: #F9FAFB; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: left; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="icon">🚫</div>
          <h1>Request Rejected</h1>
          <p>The club admin request has been rejected.</p>
          <div class="user-info">
            <p><strong>User:</strong> ${email}</p>
            <p><strong>Status:</strong> Request denied</p>
          </div>
          <p>The request has been removed from the system.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Error rejecting via email:', err);
    res.status(500).send('<h1>Error processing request</h1>');
  }
});
// ADD THESE ROUTES TO backend/index.js

// ==================== CLUB SUBSCRIPTION ROUTES ====================

// Subscribe to a club
app.post('/clubs/:clubId/subscribe', authMiddleware, async (req, res) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const userEmail = req.userEmail;

    // Get user ID
    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    // Check if club exists
    const club = await getClubById(clubId);
    if (!club) {
      return res.status(404).json({ ok: false, error: 'Club not found' });
    }

    // Check if already subscribed
    const [existing] = await pool.execute(
      'SELECT id, is_active FROM club_subscriptions WHERE user_id = ? AND club_id = ?',
      [user.id, clubId]
    );

    if (existing.length > 0) {
      // Reactivate if was unsubscribed
      await pool.execute(
        'UPDATE club_subscriptions SET is_active = 1, subscribed_at = NOW() WHERE user_id = ? AND club_id = ?',
        [user.id, clubId]
      );
    } else {
      // Create new subscription
      await pool.execute(
        'INSERT INTO club_subscriptions (user_id, club_id) VALUES (?, ?)',
        [user.id, clubId]
      );
    }

    console.log(`✓ ${userEmail} subscribed to club ${clubId}`);

    res.json({
      ok: true,
      message: 'Successfully subscribed to club',
      subscribed: true
    });
  } catch (err) {
    console.error('Error subscribing to club:', err);
    res.status(500).json({ ok: false, error: 'Failed to subscribe' });
  }
});

// Unsubscribe from a club
app.post('/clubs/:clubId/unsubscribe', authMiddleware, async (req, res) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const userEmail = req.userEmail;

    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    // Soft delete - set is_active to 0
    await pool.execute(
      'UPDATE club_subscriptions SET is_active = 0 WHERE user_id = ? AND club_id = ?',
      [user.id, clubId]
    );

    console.log(`✓ ${userEmail} unsubscribed from club ${clubId}`);

    res.json({
      ok: true,
      message: 'Successfully unsubscribed from club',
      subscribed: false
    });
  } catch (err) {
    console.error('Error unsubscribing from club:', err);
    res.status(500).json({ ok: false, error: 'Failed to unsubscribe' });
  }
});

// Check subscription status for a club
app.get('/clubs/:clubId/subscription-status', authMiddleware, async (req, res) => {
  try {
    const clubId = parseInt(req.params.clubId);
    const userEmail = req.userEmail;

    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.json({ ok: true, subscribed: false });
    }

    const [subscription] = await pool.execute(
      'SELECT is_active FROM club_subscriptions WHERE user_id = ? AND club_id = ?',
      [user.id, clubId]
    );

    res.json({
      ok: true,
      subscribed: subscription.length > 0 && subscription[0].is_active === 1
    });
  } catch (err) {
    console.error('Error checking subscription:', err);
    res.status(500).json({ ok: false, error: 'Failed to check subscription' });
  }
});

// Get all subscribed clubs for current user
app.get('/my-subscriptions', authMiddleware, async (req, res) => {
  try {
    const userEmail = req.userEmail;

    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.json({ ok: true, subscriptions: [] });
    }

    const [subscriptions] = await pool.execute(`
      SELECT 
        c.id,
        c.club_name,
        c.club_code,
        c.description,
        c.category,
        cs.subscribed_at
      FROM club_subscriptions cs
      JOIN clubs c ON cs.club_id = c.id
      WHERE cs.user_id = ? AND cs.is_active = 1
      ORDER BY cs.subscribed_at DESC
    `, [user.id]);

    res.json({ ok: true, subscriptions });
  } catch (err) {
    console.error('Error fetching subscriptions:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch subscriptions' });
  }
});

// Get subscriber count for a club
app.get('/clubs/:clubId/subscriber-count', async (req, res) => {
  try {
    const clubId = parseInt(req.params.clubId);

    const [result] = await pool.execute(
      'SELECT COUNT(*) as count FROM club_subscriptions WHERE club_id = ? AND is_active = 1',
      [clubId]
    );

    res.json({ ok: true, count: result[0].count });
  } catch (err) {
    console.error('Error getting subscriber count:', err);
    res.status(500).json({ ok: false, error: 'Failed to get count' });
  }
});

// ==================== EMAIL NOTIFICATION FUNCTION ====================

// Function to send announcement notification to subscribers
async function notifySubscribers(clubId, announcementTitle, announcementContent, announcementId) {
  try {
    // Get club details
    const club = await getClubById(clubId);
    if (!club) return;

    // Get all active subscribers with their emails
    const [subscribers] = await pool.execute(`
      SELECT u.email, u.name
      FROM club_subscriptions cs
      JOIN users u ON cs.user_id = u.id
      WHERE cs.club_id = ? AND cs.is_active = 1 AND u.email IS NOT NULL
    `, [clubId]);

    if (subscribers.length === 0) {
      console.log('No subscribers to notify for club', clubId);
      return;
    }

    console.log(`Sending announcement notification to ${subscribers.length} subscribers of ${club.club_name}`);

    // Send email to each subscriber
    const emailPromises = subscribers.map(subscriber => {
      const mailOptions = {
        from: process.env.FROM_EMAIL || process.env.EMAIL_USER,
        to: subscriber.email,
        subject: `🔔 New Announcement from ${club.club_name} - Club Hub`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <style>
              body { 
                font-family: Arial, sans-serif; 
                line-height: 1.6; 
                color: #333; 
                margin: 0;
                padding: 0;
                background: #f5f5f5;
              }
              .container {
                max-width: 600px;
                margin: 0 auto;
                background: white;
              }
              .header { 
                background: linear-gradient(135deg, #C41E3A, #E63946); 
                padding: 30px; 
                text-align: center; 
                color: white;
              }
              .header h1 { 
                margin: 0; 
                font-size: 24px;
              }
              .club-badge {
                display: inline-block;
                background: rgba(255, 255, 255, 0.2);
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 14px;
                margin-top: 10px;
              }
              .content { 
                padding: 30px; 
              }
              .greeting {
                font-size: 16px;
                color: #1F2937;
                margin-bottom: 20px;
              }
              .announcement-box {
                background: #F9FAFB;
                border-left: 4px solid #C41E3A;
                padding: 20px;
                border-radius: 8px;
                margin: 20px 0;
              }
              .announcement-title {
                font-size: 20px;
                font-weight: bold;
                color: #1F2937;
                margin-bottom: 15px;
              }
              .announcement-content {
                font-size: 15px;
                color: #4B5563;
                line-height: 1.8;
                white-space: pre-wrap;
              }
              .view-button {
                display: inline-block;
                background: #C41E3A;
                color: white;
                padding: 12px 30px;
                text-decoration: none;
                border-radius: 8px;
                font-weight: bold;
                margin: 20px 0;
              }
              .footer {
                background: #F9FAFB;
                padding: 20px;
                text-align: center;
                color: #6B7280;
                font-size: 14px;
              }
              .unsubscribe {
                margin-top: 15px;
                font-size: 12px;
              }
              .unsubscribe a {
                color: #6B7280;
                text-decoration: underline;
              }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🔔 New Announcement</h1>
                <div class="club-badge">${club.club_name}</div>
              </div>
              
              <div class="content">
                <p class="greeting">
                  Hi${subscriber.name ? ' ' + subscriber.name.split(' ')[0] : ''},
                </p>
                
                <p>
                  <strong>${club.club_name}</strong> just posted a new announcement!
                </p>
                
                <div class="announcement-box">
                  <div class="announcement-title">${announcementTitle}</div>
                  <div class="announcement-content">${announcementContent.substring(0, 300)}${announcementContent.length > 300 ? '...' : ''}</div>
                </div>
                
                <div style="text-align: center;">
                  <a href="http://localhost:3000/" class="view-button">
                    View Full Announcement
                  </a>
                </div>
                
                <p style="color: #6B7280; font-size: 14px; margin-top: 30px;">
                  You're receiving this because you subscribed to ${club.club_name} on Club Hub.
                </p>
              </div>
              
              <div class="footer">
                <p><strong>Club Hub</strong> - KLE Technological University</p>
                <div class="unsubscribe">
                  Not interested anymore? <a href="http://localhost:3000/clubs.html">Manage your subscriptions</a>
                </div>
              </div>
            </div>
          </body>
          </html>
        `
      };

      // Use sendEmailWrapper for safe handling (auto-init if needed)
      return sendEmailWrapper(mailOptions)
        .then(() => console.log(`✓ Email sent to ${subscriber.email}`))
        .catch(err => console.error(`✗ Failed to send to ${subscriber.email}:`, err.message));
    });

    await Promise.all(emailPromises);
    console.log(`✓ Notification emails sent to ${subscribers.length} subscribers`);
  } catch (err) {
    console.error('Error notifying subscribers:', err);
    // Don't throw - announcement should still be created even if emails fail
  }
}

// ==================== UPDATE ANNOUNCEMENT CREATION ====================

// UPDATE YOUR EXISTING app.post('/announcements') ROUTE
// Find this route and modify it to send notifications:


// Route removed: duplicate legacy handler.
// Correct handler is at line 2044.

// ==================== SOCIAL ROUTES (LIKES & COMMENTS) ====================
// ADD THESE ROUTES TO backend/index.js

// ==================== EVENT REGISTRATION ROUTES ====================

// Register for an event
app.post('/announcements/:announcementId/register', authMiddleware, async (req, res) => {
  try {
    const announcementId = parseInt(req.params.announcementId);
    const userEmail = req.userEmail;

    // Get user details
    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    // Check if announcement exists and has registration enabled
    // Check if announcement exists and has registration enabled
    const { rows: announcements } = await pool.query(
      `SELECT id, title, registration_enabled, registration_deadline, max_registrations 
       FROM announcements WHERE id = $1`,
      [announcementId]
    );

    if (announcements.length === 0) {
      return res.status(404).json({ ok: false, error: 'Event not found' });
    }

    const announcement = announcements[0];

    if (!announcement.registration_enabled) {
      return res.status(400).json({ ok: false, error: 'Registration not enabled for this event' });
    }

    // Check if registration deadline has passed
    if (announcement.registration_deadline) {
      const deadline = new Date(announcement.registration_deadline);
      if (new Date() > deadline) {
        return res.status(400).json({ ok: false, error: 'Registration deadline has passed' });
      }
    }

    // Check if max registrations reached
    if (announcement.max_registrations) {
      if (announcement.max_registrations) {
        const { rows: countResult } = await pool.query(
          'SELECT COUNT(*) as count FROM event_registrations WHERE announcement_id = $1 AND status = \'registered\'',
          [announcementId]
        );

        if (countResult[0].count >= announcement.max_registrations) {
          return res.status(400).json({ ok: false, error: 'Event is full. Maximum registrations reached.' });
        }
      }

      // Check if already registered
      // Check if already registered
      const { rows: existing } = await pool.query(
        'SELECT id, status FROM event_registrations WHERE announcement_id = $1 AND user_id = $2',
        [announcementId, user.id]
      );

      if (existing.length > 0) {
        if (existing[0].status === 'registered') {
          return res.status(400).json({ ok: false, error: 'Already registered for this event' });
        } else {
          // Re-register if previously cancelled
          await pool.query(
            'UPDATE event_registrations SET status = \'registered\', registered_at = NOW() WHERE id = $1',
            [existing[0].id]
          );
        }
      } else {
        // Create new registration
        await pool.query(
          `INSERT INTO event_registrations 
         (announcement_id, user_id, user_email, user_name, roll_number, branch) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
          [announcementId, user.id, user.email, user.name, user.roll_number, user.branch]
        );
      }
    }

    console.log(`✓ ${userEmail} registered for event ${announcementId}`);

    res.json({
      ok: true,
      message: 'Successfully registered for event!',
      registered: true
    });
  } catch (err) {
    console.error('Error registering for event:', err);
    res.status(500).json({ ok: false, error: 'Failed to register' });
  }
});

// Cancel registration
app.post('/announcements/:announcementId/unregister', authMiddleware, async (req, res) => {
  try {
    const announcementId = parseInt(req.params.announcementId);
    const userEmail = req.userEmail;

    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.status(404).json({ ok: false, error: 'User not found' });
    }

    // Update registration status to cancelled
    // Update registration status to cancelled
    const { rowCount } = await pool.query(
      'UPDATE event_registrations SET status = \'cancelled\' WHERE announcement_id = $1 AND user_id = $2 AND status = \'registered\'',
      [announcementId, user.id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Registration not found' });
    }

    console.log(`✓ ${userEmail} cancelled registration for event ${announcementId}`);

    res.json({
      ok: true,
      message: 'Registration cancelled successfully',
      registered: false
    });
  } catch (err) {
    console.error('Error cancelling registration:', err);
    res.status(500).json({ ok: false, error: 'Failed to cancel registration' });
  }
});

// Check registration status for an event
app.get('/announcements/:announcementId/registration-status', authMiddleware, async (req, res) => {
  try {
    const announcementId = parseInt(req.params.announcementId);
    const userEmail = req.userEmail;

    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.json({ ok: true, registered: false });
    }

    const { rows: registrations } = await pool.query(
      'SELECT status FROM event_registrations WHERE announcement_id = $1 AND user_id = $2',
      [announcementId, user.id]
    );

    res.json({
      ok: true,
      registered: registrations.length > 0 && registrations[0].status === 'registered'
    });
  } catch (err) {
    console.error('Error checking registration status:', err);
    res.status(500).json({ ok: false, error: 'Failed to check status' });
  }
});

// Get registration count and capacity for an event
app.get('/announcements/:announcementId/registration-info', async (req, res) => {
  try {
    const announcementId = parseInt(req.params.announcementId);

    const { rows: announcements } = await pool.query(
      `SELECT registration_enabled, registration_deadline, max_registrations 
       FROM announcements WHERE id = $1`,
      [announcementId]
    );

    if (announcements.length === 0) {
      return res.status(404).json({ ok: false, error: 'Event not found' });
    }

    const announcement = announcements[0];

    const { rows: countResult } = await pool.query(
      "SELECT COUNT(*) as count FROM event_registrations WHERE announcement_id = $1 AND status = 'registered'",
      [announcementId]
    );

    const currentCount = countResult[0].count;
    const isFull = announcement.max_registrations && currentCount >= announcement.max_registrations;
    const deadlinePassed = announcement.registration_deadline && new Date() > new Date(announcement.registration_deadline);

    res.json({
      ok: true,
      registration_enabled: announcement.registration_enabled === 1,
      current_count: currentCount,
      max_registrations: announcement.max_registrations,
      is_full: isFull,
      deadline: announcement.registration_deadline,
      deadline_passed: deadlinePassed
    });
  } catch (err) {
    console.error('Error getting registration info:', err);
    res.status(500).json({ ok: false, error: 'Failed to get info' });
  }
});

// Get all registrations for an event (Club Admins only)
app.get('/announcements/:announcementId/registrations', authMiddleware, async (req, res) => {
  try {
    const announcementId = parseInt(req.params.announcementId);
    const userEmail = req.userEmail;

    // Check if user is the club admin who created this announcement
    const user = await findUserByEmail(userEmail);
    if (user.role !== 'club_admin') {
      return res.status(403).json({ ok: false, error: 'Only club admins can view registrations' });
    }

    const { rows: announcement } = await pool.query(
      'SELECT club_id, created_by FROM announcements WHERE id = $1',
      [announcementId]
    );

    if (announcement.length === 0) {
      return res.status(404).json({ ok: false, error: 'Event not found' });
    }

    // Verify the club admin owns this announcement
    if (user.club_id !== announcement[0].club_id) {
      return res.status(403).json({ ok: false, error: 'You can only view registrations for your club events' });
    }

    // Get all registrations
    const { rows: registrations } = await pool.query(
      `SELECT 
        er.id,
        er.user_name,
        er.user_email,
        er.roll_number,
        er.branch,
        er.registered_at,
        er.status,
        er.notes
       FROM event_registrations er
       WHERE er.announcement_id = $1
       ORDER BY er.registered_at DESC`,
      [announcementId]
    );

    res.json({
      ok: true,
      registrations,
      total_count: registrations.length,
      registered_count: registrations.filter(r => r.status === 'registered').length
    });
  } catch (err) {
    console.error('Error fetching registrations:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch registrations' });
  }
});

// Export registrations as CSV (Club Admins only)
app.get('/announcements/:announcementId/registrations/export', authMiddleware, async (req, res) => {
  try {
    const announcementId = parseInt(req.params.announcementId);
    const userEmail = req.userEmail;

    const user = await findUserByEmail(userEmail);
    if (user.role !== 'club_admin') {
      return res.status(403).json({ ok: false, error: 'Only club admins can export registrations' });
    }

    const { rows: announcement } = await pool.query(
      'SELECT title, club_id FROM announcements WHERE id = $1',
      [announcementId]
    );

    if (announcement.length === 0 || user.club_id !== announcement[0].club_id) {
      return res.status(403).json({ ok: false, error: 'Unauthorized' });
    }

    const { rows: registrations } = await pool.query(
      `SELECT 
        user_name,
        user_email,
        roll_number,
        branch,
        registered_at,
        status
       FROM event_registrations
       WHERE announcement_id = $1
       ORDER BY registered_at DESC`,
      [announcementId]
    );

    // Generate CSV
    const csv = [
      ['Name', 'Email', 'Roll Number', 'Branch', 'Registered At', 'Status'].join(','),
      ...registrations.map(r => [
        `"${r.user_name || ''}"`,
        r.user_email,
        r.roll_number || '',
        r.branch || '',
        new Date(r.registered_at).toLocaleString(),
        r.status
      ].join(','))
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="registrations-${announcementId}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error('Error exporting registrations:', err);
    res.status(500).json({ ok: false, error: 'Failed to export' });
  }
});

// COMPLETE FIXED ANNOUNCEMENT CREATION ROUTE
// Replace your entire app.post('/announcements', ...) route in backend/index.js

app.post('/announcements', upload.single('image'), async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).json({ error: 'missing token' });

    const token = auth.split(' ')[1];
    const payload = jwt.verify(token, JWT_SECRET);
    const email = payload.sub.toLowerCase();

    // Log what we received
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📝 CREATE ANNOUNCEMENT REQUEST');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Raw req.body:', JSON.stringify(req.body, null, 2));
    console.log('req.file:', req.file ? req.file.filename : 'No file');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const {
      title,
      content,
      registration_enabled,
      registration_deadline,
      max_registrations
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content required' });
    }

    const user = await findUserByEmail(email);
    if (user.role !== 'club_admin' || !user.club_id) {
      return res.status(403).json({ error: 'only club admins can create announcements' });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : null;

    // ⭐⭐⭐ CRITICAL FIX: Parse registration_enabled correctly ⭐⭐⭐
    // FormData sends boolean as string 'true' or 'false'
    let regEnabled = 0;

    if (registration_enabled === 'true' ||
      registration_enabled === true ||
      registration_enabled === 1 ||
      registration_enabled === '1') {
      regEnabled = 1;
    }

    // Parse deadline
    let regDeadline = null;
    if (registration_deadline &&
      registration_deadline !== '' &&
      registration_deadline !== 'null' &&
      registration_deadline !== 'undefined') {
      // Parse flexible date string to ISO for Postgres
      const parsedDate = new Date(registration_deadline);
      if (!isNaN(parsedDate.getTime())) {
        regDeadline = parsedDate; // passing Date object to pg is safe
      } else {
        console.warn('Invalid deadline format received:', registration_deadline);
        // Fallback or leave as string (might fail in DB) but preventing crash
      }
    }

    // Parse max registrations
    let maxReg = null;
    if (max_registrations &&
      max_registrations !== '' &&
      max_registrations !== 'null' &&
      max_registrations !== 'undefined') {
      maxReg = parseInt(max_registrations);
      if (isNaN(maxReg)) maxReg = null;
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ PARSED VALUES:');
    console.log('  registration_enabled (raw):', registration_enabled, typeof registration_enabled);
    console.log('  regEnabled (parsed):', regEnabled);
    console.log('  regDeadline:', regDeadline);
    console.log('  maxReg:', maxReg);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Insert announcement
    // Insert announcement (Postgres syntax)
    const { rows: result } = await pool.query(
      `INSERT INTO announcements 
       (club_id, title, content, image_url, registration_enabled, registration_deadline, max_registrations, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [user.club_id, title, content, imageUrl, regEnabled, regDeadline, maxReg, email]
    );

    const announcementId = result[0].id;

    // Verify it was saved correctly
    const { rows: verify } = await pool.query(
      'SELECT id, registration_enabled, registration_deadline, max_registrations FROM announcements WHERE id = $1',
      [announcementId]
    );

    console.log('✅ SAVED TO DATABASE:');
    console.log('  Announcement ID:', announcementId);
    console.log('  Verification:', verify[0]);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Send notification to subscribers (if function exists)
    if (typeof notifySubscribers === 'function') {
      try {
        notifySubscribers(user.club_id, title, content, announcementId);
      } catch (err) {
        console.error('Error notifying subscribers:', err);
      }
    }

    return res.json({
      ok: true,
      message: 'Announcement created successfully',
      announcement: {
        id: announcementId,
        club_id: user.club_id,
        title,
        content,
        image_url: imageUrl,
        registration_enabled: regEnabled,
        registration_deadline: regDeadline,
        max_registrations: maxReg,
        created_by: email
      }
    });
  } catch (err) {
    console.error('❌ ERROR creating announcement:', err);
    return res.status(500).json({ error: 'server error', detail: err.message });
  }
});
// ADD THIS ROUTE TO backend/index.js (if not already added)

// Get all events the current user is registered for
app.get('/my-registrations', authMiddleware, async (req, res) => {
  try {
    const userEmail = req.userEmail;

    // Get user ID
    const user = await findUserByEmail(userEmail);
    if (!user) {
      return res.json({ ok: true, registrations: [] });
    }

    // Get all active registrations with event details
    const [registrations] = await pool.execute(`
      SELECT 
        er.id,
        er.announcement_id,
        er.registered_at,
        er.status,
        a.title,
        a.created_at as event_date,
        a.registration_deadline,
        c.club_name,
        c.club_code
      FROM event_registrations er
      JOIN announcements a ON er.announcement_id = a.id
      JOIN clubs c ON a.club_id = c.id
      WHERE er.user_id = ? AND er.status = 'registered'
      ORDER BY er.registered_at DESC
    `, [user.id]);

    res.json({
      ok: true,
      registrations
    });
  } catch (err) {
    console.error('Error fetching my registrations:', err);
    res.status(500).json({ ok: false, error: 'Failed to fetch registrations' });
  }
});
app.use('/', socialRoutes(pool));

// ==================== START SERVER ====================

app.listen(PORT, () => console.log(`Auth server listening on http://localhost:${PORT}`));