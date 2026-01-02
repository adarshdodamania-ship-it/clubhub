// backend/db.js
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "postgres",
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

/* =========================
   USER FUNCTIONS
========================= */

const findUserByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT 
      u.id,
      u.email,
      u.password_hash,
      u.role,
      u.name,
      u.branch,
      u.roll_number,
      u.club_id,
      u.admin_requested,
      u.profile_picture,
      c.club_name,
      c.club_code,
      c.description AS club_description
     FROM users u
     LEFT JOIN clubs c ON u.club_id = c.id
     WHERE u.email = $1
     LIMIT 1`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
};

const createUser = async (email, passwordHash, role = null) => {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, updated_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING id`,
    [email.toLowerCase(), passwordHash, role]
  );
  return { id: rows[0].id, email: email.toLowerCase(), role };
};

const getProfileByEmail = async (email) => {
  const { rows } = await pool.query(
    `SELECT 
      u.*,
      c.club_name,
      c.club_code,
      c.description AS club_description
     FROM users u
     LEFT JOIN clubs c ON u.club_id = c.id
     WHERE u.email = $1
     LIMIT 1`,
    [email.toLowerCase()]
  );
  return rows[0] || null;
};

const updateProfile = async (
  email,
  { name = null, branch = null, roll_number = null, role = null, club_id = null, request_admin = false }
) => {
  let query;
  let params;

  if (request_admin) {
    query = `
      UPDATE users
      SET name=$1, branch=$2, roll_number=$3, club_id=$4,
          admin_requested=true, requested_at=NOW(), updated_at=NOW()
      WHERE email=$5`;
    params = [name, branch, roll_number, club_id, email.toLowerCase()];
  } else if (role) {
    query = `
      UPDATE users
      SET name=$1, branch=$2, roll_number=$3, role=$4, updated_at=NOW()
      WHERE email=$5`;
    params = [name, branch, roll_number, role, email.toLowerCase()];
  } else {
    query = `
      UPDATE users
      SET name=$1, branch=$2, roll_number=$3, updated_at=NOW()
      WHERE email=$4`;
    params = [name, branch, roll_number, email.toLowerCase()];
  }

  await pool.query(query, params);
};

const updatePassword = async (email, passwordHash) => {
  await pool.query(
    `UPDATE users SET password_hash=$1, updated_at=NOW() WHERE email=$2`,
    [passwordHash, email.toLowerCase()]
  );
};

/* =========================
   CLUB FUNCTIONS
========================= */

const getAllClubs = async () => {
  const { rows } = await pool.query(
    `SELECT id, club_name, club_code, description, category
     FROM clubs
     WHERE is_active=true
     ORDER BY club_name`
  );
  return rows;
};

const getClubById = async (clubId) => {
  const { rows } = await pool.query(
    `SELECT * FROM clubs WHERE id=$1 AND is_active=true LIMIT 1`,
    [clubId]
  );
  return rows[0] || null;
};

const getClubMembers = async (clubId) => {
  const { rows } = await pool.query(
    `SELECT email, name, branch, roll_number, role, admin_requested
     FROM users
     WHERE club_id=$1
     ORDER BY role DESC, name`,
    [clubId]
  );
  return rows;
};

/* =========================
   ANNOUNCEMENTS
========================= */

const getAllAnnouncements = async (limit = 50, offset = 0) => {
  const { rows } = await pool.query(
    `SELECT 
      a.id, a.title, a.content, a.image_url, a.created_at,
      a.club_id, c.club_name, c.club_code,
      a.created_by, u.name AS author_name
     FROM announcements a
     JOIN clubs c ON a.club_id = c.id
     LEFT JOIN users u ON a.created_by = u.email
     WHERE a.is_active=true
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
};

// Added missing function from previous implementation to prevent crashes
const getAnnouncementsByClub = async (clubId, limit = 50) => {
  const { rows } = await pool.query(
    `SELECT 
        a.id,
        a.title,
        a.content,
        a.created_at,
        a.club_id,
        c.club_name,
        a.created_by,
        u.name as author_name
       FROM announcements a
       JOIN clubs c ON a.club_id = c.id
       LEFT JOIN users u ON a.created_by = u.email
       WHERE a.club_id = $1 AND a.is_active = true
       ORDER BY a.created_at DESC
       LIMIT $2`,
    [clubId, limit]
  );
  return rows;
};

const createAnnouncement = async (clubId, title, content, createdBy) => {
  const { rows } = await pool.query(
    `INSERT INTO announcements (club_id, title, content, created_by)
     VALUES ($1,$2,$3,$4)
     RETURNING id`,
    [clubId, title, content, createdBy]
  );
  return rows[0];
};

const deleteAnnouncement = async (announcementId, userEmail) => {
  const res = await pool.query(
    `UPDATE announcements SET is_active=false WHERE id=$1 AND created_by=$2`,
    [announcementId, userEmail]
  );
  return res.rowCount > 0;
};

const updateAnnouncement = async (announcementId, title, content, userEmail) => {
  const res = await pool.query(
    `UPDATE announcements
     SET title=$1, content=$2, updated_at=NOW()
     WHERE id=$3 AND created_by=$4`,
    [title, content, announcementId, userEmail]
  );
  return res.rowCount > 0;
};

module.exports = {
  pool,
  findUserByEmail,
  createUser,
  getProfileByEmail,
  updateProfile,
  updatePassword,
  getAllClubs,
  getClubById,
  getClubMembers,
  getAllAnnouncements,
  getAnnouncementsByClub,
  createAnnouncement,
  deleteAnnouncement,
  updateAnnouncement
};
