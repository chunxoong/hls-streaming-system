// HLS4U Stream Server - Complete Fixed Version
// All issues resolved: Redis + CORS + Session timing

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Global variables for session store
let sessionStore;
let redisClient;
let useRedis = false;

// Redis initialization with robust error handling
const initRedis = async () => {
  try {
    const RedisStore = require('connect-redis').default;
    const { createClient } = require('redis');
    
    console.log('🔌 Initializing Redis connection...');
    
    redisClient = createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        connectTimeout: 10000,
        lazyConnect: false
      }
    });
    
    // Redis event handlers
    redisClient.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
    });
    
    redisClient.on('connect', () => {
      console.log('🔌 Redis connecting...');
    });
    
    redisClient.on('ready', () => {
      console.log('✅ Redis connected and ready');
    });
    
    redisClient.on('end', () => {
      console.log('🔌 Redis connection ended');
    });
    
    // Connect to Redis
    await redisClient.connect();
    
    // Test connection
    const result = await redisClient.ping();
    if (result === 'PONG') {
      console.log('🏓 Redis ping successful');
    }
    
    // Create Redis store
    sessionStore = new RedisStore({
      client: redisClient,
      prefix: 'hls4u:sess:',
      ttl: 24 * 60 * 60 // 24 hours
    });
    
    useRedis = true;
    console.log('✅ Using Redis session store');
    return true;
    
  } catch (error) {
    console.log('⚠️  Redis initialization failed:', error.message);
    console.log('📝 Falling back to Memory store');
    
    // Fallback to memory store
    sessionStore = new session.MemoryStore();
    useRedis = false;
    return false;
  }
};

// Database connection pool
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  acquireTimeout: 60000
});

// Test database connection
const testDatabase = async () => {
  try {
    const connection = await dbPool.getConnection();
    await connection.ping();
    connection.release();
    console.log('✅ Database connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    return false;
  }
};

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for HLS streaming
  crossOriginEmbedderPolicy: false
}));

// CORS configuration - FIXED
app.use(cors({
  origin: function (origin, callback) {
    // Allow all origins (can be restricted later for production)
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Body parser middleware
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static files serving with optimized headers
app.use('/hls', express.static(path.join(__dirname, 'hls'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.setHeader('Cache-Control', 'public, max-age=10');
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (filePath.endsWith('.ts')) {
      res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
      res.setHeader('Content-Type', 'video/mp2t');
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
  }
}));

app.use('/public', express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Make database available to all routes
app.locals.db = dbPool;

// Health check endpoint
app.get('/health', async (req, res) => {
  let redisStatus = 'disconnected';
  let dbStatus = 'disconnected';
  
  // Test Redis
  if (useRedis && redisClient) {
    try {
      await redisClient.ping();
      redisStatus = 'connected';
    } catch (error) {
      redisStatus = 'error';
    }
  } else if (!useRedis) {
    redisStatus = 'memory-store';
  }
  
  // Test Database
  try {
    const connection = await dbPool.getConnection();
    await connection.ping();
    connection.release();
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'error';
  }
  
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      redis: redisStatus,
      database: dbStatus,
      sessionStore: useRedis ? 'redis' : 'memory'
    },
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    },
    uptime: Math.round(process.uptime()) + 's'
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n📴 Received ${signal}, shutting down gracefully...`);
  
  try {
    if (redisClient && useRedis) {
      await redisClient.quit();
      console.log('✅ Redis connection closed');
    }
    
    await dbPool.end();
    console.log('✅ Database pool closed');
    
    console.log('👋 Goodbye!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    process.exit(1);
  }
};

// Process signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Error handlers
process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// Main server initialization function
const startServer = async () => {
  try {
    console.log('🚀 Starting HLS4U Stream Server...\n');
    
    // Step 1: Initialize Redis
    console.log('📦 Step 1: Initializing session store...');
    await initRedis();
    
    // Step 2: Test database
    console.log('📦 Step 2: Testing database connection...');
    const dbConnected = await testDatabase();
    if (!dbConnected) {
      throw new Error('Database connection failed - cannot continue');
    }
    
    // Step 3: Configure session middleware (CRITICAL: After Redis is ready)
    console.log('📦 Step 3: Configuring session middleware...');
    const sessionConfig = {
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'hls4u-secret-key-2024-production',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      name: 'hls4u.sid',
      cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'lax'
      }
    };
    
    app.use(session(sessionConfig));
    console.log('✅ Session middleware configured');
    
    // Step 4: Load routes (MUST be after session middleware)
    console.log('📦 Step 4: Loading routes...');
    app.use('/', require('./app/routes/index'));
    app.use('/api', require('./app/routes/api'));
    app.use('/admin', require('./app/routes/admin'));
    app.use('/upload', require('./app/routes/upload'));
    console.log('✅ Routes loaded');
    
    // Step 5: Error handling middleware
    app.use((err, req, res, next) => {
      console.error('💥 Application Error:', err);
      
      // Handle specific errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' });
      }
      
      if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ error: 'CORS policy violation' });
      }
      
      // Generic error response
      res.status(500).json({ 
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message 
      });
    });
    
    // 404 handler
    app.use((req, res) => {
      res.status(404).render('pages/404', { title: 'Page Not Found' });
    });
    
    // Step 6: Start HTTP server
    console.log('📦 Step 6: Starting HTTP server...');
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log('\n🎉 HLS4U Stream Server started successfully!');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`🌐 Server URL: http://127.0.0.1:${PORT}`);
      console.log(`📺 HLS Streaming: http://127.0.0.1:${PORT}/hls/`);
      console.log(`⚙️  Admin Panel: http://127.0.0.1:${PORT}/admin`);
      console.log(`🏥 Health Check: http://127.0.0.1:${PORT}/health`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`💾 Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB`);
      console.log(`🗄️  Session Store: ${useRedis ? 'Redis' : 'Memory'} Store`);
      console.log(`🐛 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🆔 Process ID: ${process.pid}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      console.log('💡 Ready to accept connections!');
    });
    
    // Server error handling
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('💡 Try: pm2 stop hls4u-stream && pm2 start hls4u-stream');
      } else {
        console.error('❌ Server error:', err);
      }
      process.exit(1);
    });
    
  } catch (error) {
    console.error('💥 Server startup failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
};

// Initialize and start the server
startServer();

module.exports = app;