const express = require('express');
const router = express.Router();

// Get videos list
router.get('/videos', async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    
    const [videos] = await db.execute(
      'SELECT id, title, description, thumbnail_path, views, duration, created_at FROM videos WHERE status = "completed" ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [limit, offset]
    );
    
    const [countResult] = await db.execute(
      'SELECT COUNT(*) as total FROM videos WHERE status = "completed"'
    );
    
    res.json({
      videos: videos,
      pagination: {
        page: page,
        limit: limit,
        total: countResult[0].total,
        totalPages: Math.ceil(countResult[0].total / limit)
      }
    });
  } catch (error) {
    console.error('API videos error:', error);
    res.status(500).json({ error: 'Unable to fetch videos' });
  }
});

// Get video details
router.get('/video/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const videoId = req.params.id;
    
    const [videos] = await db.execute(
      'SELECT * FROM videos WHERE id = ? AND status = "completed"',
      [videoId]
    );
    
    if (videos.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({ video: videos[0] });
  } catch (error) {
    console.error('API video error:', error);
    res.status(500).json({ error: 'Unable to fetch video' });
  }
});

module.exports = router;
