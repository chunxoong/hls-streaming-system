// HLS4U Stream Server - Balanced Version
// Single Process Architecture

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs').promises;
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Redis client setup
let redisClient;
const initRedis = async () => {
  try {
    redisClient = createClient({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    
    redisClient.on('error', (err) => {
      console.log('Redis Client Error', err);
    });
    
    await redisClient.connect();
    console.log('✅ Redis connected successfully');
  } catch (error) {
    console.log('❌ Redis connection failed:', error.message);
  }
};

// Database connection pool
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test database connection
const testDatabase = async () => {
  try {
    const connection = await dbPool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Database connected successfully');
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
  }
};

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for HLS video streaming
  crossOriginEmbedderPolicy: false
}));

// CORS configuration for HLS streaming
app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins for video streaming
    callback(null, true);
  },
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Session configuration - FIXED VERSION
app.use(session({
  secret: process.env.SESSION_SECRET || 'hls4u-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  name: 'hls4u.sid',
  cookie: {
    secure: false,  // QUAN TRỌNG: false cho HTTP testing
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

// Body parser middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Static files serving with cache headers for HLS
app.use('/hls', express.static(path.join(__dirname, 'hls'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      // M3U8 playlists - short cache for seeking
      res.setHeader('Cache-Control', 'public, max-age=10');
    } else if (filePath.endsWith('.ts')) {
      // TS segments - long cache for fast loading
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
  }
}));

// Public static files
app.use('/public', express.static(path.join(__dirname, 'public')));

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make database available to all routes
app.locals.db = dbPool;

// Basic health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// Routes
app.use('/', require('./app/routes/index'));
app.use('/api', require('./app/routes/api'));
app.use('/admin', require('./app/routes/admin'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('pages/404', { title: 'Page Not Found' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully');
  
  if (redisClient) {
    await redisClient.quit();
  }
  
  await dbPool.end();
  process.exit(0);
});

// Start server
const startServer = async () => {
  await initRedis();
  await testDatabase();
  
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`🚀 HLS4U Stream Server running on port ${PORT}`);
    console.log(`📺 Video streaming: http://127.0.0.1:${PORT}/hls/`);
    console.log(`⚙️  Admin panel: http://127.0.0.1:${PORT}/admin`);
    console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
  });
};

startServer().catch(console.error);

module.exports = app;
