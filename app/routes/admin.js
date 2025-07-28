const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const router = express.Router();

// Auth middleware with better debugging
const requireAuth = (req, res, next) => {
  console.log('Auth check - Session exists:', !!req.session);
  console.log('Auth check - Admin data:', req.session ? !!req.session.admin : false);
  
  if (req.session && req.session.admin) {
    return next();
  }
  res.redirect('/admin/login');
};

// Login page
router.get('/login', (req, res) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin/dashboard');
  }
  res.render('pages/admin/login', { title: 'Admin Login', error: null });
});

// Login POST with improved session handling
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const db = req.app.locals.db;
    
    console.log('=== LOGIN ATTEMPT ===');
    console.log('Username:', username);
    
    const [users] = await db.execute(
      'SELECT * FROM users WHERE username = ?',
      [username]
    );
    
    if (users.length === 0) {
      console.log('User not found');
      return res.render('pages/admin/login', { 
        title: 'Admin Login', 
        error: 'Invalid credentials' 
      });
    }
    
    const user = users[0];
    const isValid = await bcrypt.compare(password, user.password);
    
    if (!isValid) {
      console.log('Invalid password');
      return res.render('pages/admin/login', { 
        title: 'Admin Login', 
        error: 'Invalid credentials' 
      });
    }
    
    // Set session
    req.session.admin = {
      id: user.id,
      username: user.username
    };
    
    // Force session save
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
        return res.render('pages/admin/login', { 
          title: 'Admin Login', 
          error: 'Session error' 
        });
      }
      
      console.log('Login successful, redirecting...');
      res.redirect('/admin/dashboard');
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.render('pages/admin/login', { 
      title: 'Admin Login', 
      error: 'Login failed' 
    });
  }
});

// Dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const [videoStats] = await db.execute(
      'SELECT COUNT(*) as total, SUM(CASE WHEN status = "completed" THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status = "processing" THEN 1 ELSE 0 END) as processing FROM videos'
    );
    
    const [recentVideos] = await db.execute(
      'SELECT id, title, status, created_at FROM videos ORDER BY created_at DESC LIMIT 5'
    );
    
    res.render('pages/admin/dashboard', {
      title: 'Admin Dashboard',
      stats: videoStats[0] || { total: 0, completed: 0, processing: 0 },
      recentVideos: recentVideos || []
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send('Dashboard error: ' + error.message);
  }
});

// Videos page
router.get('/videos', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    const [videos] = await db.execute(
      'SELECT * FROM videos ORDER BY created_at DESC'
    );
    
    res.render('pages/admin/videos', {
      title: 'Video Management',
      videos: videos || []
    });
  } catch (error) {
    console.error('Videos page error:', error);
    res.status(500).send('Videos page error: ' + error.message);
  }
});

// Upload page
router.get('/upload', requireAuth, (req, res) => {
  res.render('pages/admin/upload', { title: 'Upload Video' });
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error('Logout error:', err);
    res.redirect('/admin/login');
  });
});

// Redirect /admin to /admin/login
router.get('/', (req, res) => {
  res.redirect('/admin/login');
});


module.exports = router;