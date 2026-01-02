// backend/routes.js - Add these routes to your Express server

const express = require('express');
const router = express.Router();
const db = require('./db'); // Your database connection

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token provided' });

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// ==================== PROFILE PICTURE ====================

// Upload/Update profile picture
router.post('/profile/picture', authenticateToken, async (req, res) => {
    try {
        const { profile_picture } = req.body; // base64 image data
        const userId = req.user.id;

        await db.run(
            'UPDATE users SET profile_picture = ? WHERE id = ?',
            [profile_picture, userId]
        );

        res.json({ ok: true, message: 'Profile picture updated' });
    } catch (error) {
        console.error('Error updating profile picture:', error);
        res.status(500).json({ error: 'Failed to update profile picture' });
    }
});

// Get profile picture
router.get('/profile/picture/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await db.get(
            'SELECT profile_picture FROM users WHERE id = ?',
            [userId]
        );

        if (!user || !user.profile_picture) {
            return res.status(404).json({ error: 'Profile picture not found' });
        }

        res.json({ ok: true, profile_picture: user.profile_picture });
    } catch (error) {
        console.error('Error fetching profile picture:', error);
        res.status(500).json({ error: 'Failed to fetch profile picture' });
    }
});

// ==================== LIKES ====================

// Like an announcement
router.post('/announcements/:id/like', authenticateToken, async (req, res) => {
    try {
        const announcementId = req.params.id;
        const userId = req.user.id;

        // Check if already liked
        const existing = await db.get(
            'SELECT * FROM announcement_likes WHERE announcement_id = ? AND user_id = ?',
            [announcementId, userId]
        );

        if (existing) {
            // Unlike
            await db.run(
                'DELETE FROM announcement_likes WHERE announcement_id = ? AND user_id = ?',
                [announcementId, userId]
            );

            const count = await db.get(
                'SELECT COUNT(*) as count FROM announcement_likes WHERE announcement_id = ?',
                [announcementId]
            );

            return res.json({
                ok: true,
                liked: false,
                likeCount: count.count
            });
        } else {
            // Like
            await db.run(
                'INSERT INTO announcement_likes (announcement_id, user_id) VALUES (?, ?)',
                [announcementId, userId]
            );

            const count = await db.get(
                'SELECT COUNT(*) as count FROM announcement_likes WHERE announcement_id = ?',
                [announcementId]
            );

            return res.json({
                ok: true,
                liked: true,
                likeCount: count.count
            });
        }
    } catch (error) {
        console.error('Error toggling like:', error);
        res.status(500).json({ error: 'Failed to toggle like' });
    }
});

// Get likes for announcement
router.get('/announcements/:id/likes', async (req, res) => {
    try {
        const announcementId = req.params.id;

        const count = await db.get(
            'SELECT COUNT(*) as count FROM announcement_likes WHERE announcement_id = ?',
            [announcementId]
        );

        const likes = await db.all(
            `SELECT al.*, u.name, u.email 
       FROM announcement_likes al 
       JOIN users u ON al.user_id = u.id 
       WHERE al.announcement_id = ?
       ORDER BY al.created_at DESC`,
            [announcementId]
        );

        res.json({
            ok: true,
            likeCount: count.count,
            likes: likes
        });
    } catch (error) {
        console.error('Error fetching likes:', error);
        res.status(500).json({ error: 'Failed to fetch likes' });
    }
});

// Check if user liked announcement
router.get('/announcements/:id/liked', authenticateToken, async (req, res) => {
    try {
        const announcementId = req.params.id;
        const userId = req.user.id;

        const like = await db.get(
            'SELECT * FROM announcement_likes WHERE announcement_id = ? AND user_id = ?',
            [announcementId, userId]
        );

        res.json({
            ok: true,
            liked: !!like
        });
    } catch (error) {
        console.error('Error checking like status:', error);
        res.status(500).json({ error: 'Failed to check like status' });
    }
});

// ==================== COMMENTS ====================

// Add comment to announcement
router.post('/announcements/:id/comments', authenticateToken, async (req, res) => {
    try {
        const announcementId = req.params.id;
        const userId = req.user.id;
        const { comment_text } = req.body;

        if (!comment_text || comment_text.trim().length === 0) {
            return res.status(400).json({ error: 'Comment text is required' });
        }

        const result = await db.run(
            'INSERT INTO announcement_comments (announcement_id, user_id, comment_text) VALUES (?, ?, ?)',
            [announcementId, userId, comment_text.trim()]
        );

        const comment = await db.get(
            `SELECT c.*, u.name, u.email, u.profile_picture 
       FROM announcement_comments c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.id = ?`,
            [result.lastID]
        );

        res.json({
            ok: true,
            comment: comment
        });
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});

// Get comments for announcement
router.get('/announcements/:id/comments', async (req, res) => {
    try {
        const announcementId = req.params.id;

        const comments = await db.all(
            `SELECT c.*, u.name, u.email, u.profile_picture 
       FROM announcement_comments c 
       JOIN users u ON c.user_id = u.id 
       WHERE c.announcement_id = ?
       ORDER BY c.created_at DESC`,
            [announcementId]
        );

        res.json({
            ok: true,
            comments: comments,
            count: comments.length
        });
    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// Delete comment
router.delete('/comments/:id', authenticateToken, async (req, res) => {
    try {
        const commentId = req.params.id;
        const userId = req.user.id;

        // Check if user owns the comment
        const comment = await db.get(
            'SELECT * FROM announcement_comments WHERE id = ?',
            [commentId]
        );

        if (!comment) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (comment.user_id !== userId) {
            return res.status(403).json({ error: 'Not authorized to delete this comment' });
        }

        await db.run(
            'DELETE FROM announcement_comments WHERE id = ?',
            [commentId]
        );

        res.json({ ok: true, message: 'Comment deleted' });
    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({ error: 'Failed to delete comment' });
    }
});

// ==================== ENHANCED ANNOUNCEMENTS ====================

// Get announcements with likes and comments count
router.get('/announcements/enhanced', async (req, res) => {
    try {
        const announcements = await db.all(`
      SELECT 
        a.*,
        c.club_name,
        (SELECT COUNT(*) FROM announcement_likes WHERE announcement_id = a.id) as like_count,
        (SELECT COUNT(*) FROM announcement_comments WHERE announcement_id = a.id) as comment_count
      FROM announcements a
      LEFT JOIN clubs c ON a.club_id = c.id
      ORDER BY a.created_at DESC
    `);

        res.json({ ok: true, announcements });
    } catch (error) {
        console.error('Error fetching enhanced announcements:', error);
        res.status(500).json({ error: 'Failed to fetch announcements' });
    }
});

module.exports = router;