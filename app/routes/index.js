const express = require('express');
const router = express.Router();

// Home page
router.get('/', async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    // Get recent videos
    const [videos] = await db.execute(
      'SELECT id, title, description, thumbnail_path, views, created_at FROM videos WHERE status = "completed" ORDER BY created_at DESC LIMIT 12'
    );
    
    res.render('pages/index', { 
      title: 'HLS4U Stream', 
      videos: videos 
    });
  } catch (error) {
    console.error('Home page error:', error);
    res.status(500).render('pages/error', { error: 'Unable to load videos' });
  }
});

// Video player page
router.get('/watch/:id', async (req, res) => {
  try {
    const db = req.app.locals.db;
    const videoId = req.params.id;
    
    // Get video details
    const [videos] = await db.execute(
      'SELECT * FROM videos WHERE id = ? AND status = "completed"',
      [videoId]
    );
    
    if (videos.length === 0) {
      return res.status(404).render('pages/404', { title: 'Video Not Found' });
    }
    
    const video = videos[0];
    
    // Increment view count
    await db.execute('UPDATE videos SET views = views + 1 WHERE id = ?', [videoId]);
    
    res.render('pages/watch', { 
      title: video.title,
      video: video 
    });
  } catch (error) {
    console.error('Watch page error:', error);
    res.status(500).render('pages/error', { error: 'Unable to load video' });
  }
});

module.exports = router;
