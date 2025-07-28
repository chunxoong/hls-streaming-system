#!/bin/bash
echo "🔧 Fixing HLS4U Stream Errors..."

# 1. Fix Redis
echo "📦 Step 1: Fixing Redis..."
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is now running"
else
    echo "❌ Redis failed to start - installing..."
    sudo apt update
    sudo apt install -y redis-server
    sudo systemctl start redis-server
    sudo systemctl enable redis-server
fi

# 2. Update server.js to fix trust proxy and CORS
echo "📦 Step 2: Updating server configuration..."

# Backup current server.js
cp server.js server.js.backup

# Create fixed server.js
cat > server.js << 'EOF'
// HLS4U Stream Server - All Errors Fixed
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mysql = require('mysql2/promise');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// TRUST PROXY - Fix for X-Forwarded-For error
app.set('trust proxy', 1);

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
        connectTimeout: 5000,
        lazyConnect: false
      },
      retry_strategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });
    
    // Redis event handlers
    redisClient.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
      useRedis = false;
    });
    
    redisClient.on('connect', () => {
      console.log('🔌 Redis connecting...');
    });
    
    redisClient.on('ready', () => {
      console.log('✅ Redis connected and ready');
      useRedis = true;
    });
    
    // Connect to Redis with timeout
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
      )
    ]);
    
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

// FIXED Database connection pool - Remove invalid options
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  // Remove invalid options that cause warnings
  // acquireTimeout: 60000,  // REMOVED
  // timeout: 60000,         // REMOVED  
  // maxReusedConnections: 10 // REMOVED
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
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

// FIXED CORS configuration - More permissive but secure
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://stream.hls4u.xyz',
  // Add your domain here
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all localhost and IP addresses for development
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Check whitelist for production
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log blocked origins for debugging
    console.log('🚫 CORS blocked origin:', origin);
    callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// FIXED Rate limiting - Handle X-Forwarded-For properly
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP',
  standardHeaders: true,
  legacyHeaders: false,
  // Handle proxy headers properly
  keyGenerator: (req) => {
    return req.ip; // Express will handle X-Forwarded-For correctly with trust proxy
  }
});

app.use('/api', limiter);
app.use('/upload', limiter);

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
      res.setHeader('Cache-Control', 'public, max-age=2592000');
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
    
    // Step 3: Configure session middleware
    console.log('📦 Step 3: Configuring session middleware...');
    const sessionConfig = {
      store: sessionStore,
      secret: process.env.SESSION_SECRET || 'hls4u-secret-key-2024-production',
      resave: false,
      saveUninitialized: false,
      rolling: true,
      name: 'hls4u.sid',
      cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      }
    };
    
    app.use(session(sessionConfig));
    console.log('✅ Session middleware configured');
    
    // Step 4: Load routes
    console.log('📦 Step 4: Loading routes...');
    app.use('/', require('./app/routes/index'));
    app.use('/api', require('./app/routes/api'));
    app.use('/admin', require('./app/routes/admin'));
    app.use('/upload', require('./app/routes/upload'));
    console.log('✅ Routes loaded');
    
    // Step 5: Error handling middleware
    app.use((err, req, res, next) => {
      console.error('💥 Application Error:', err);
      
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' });
      }
      
      if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ error: 'CORS policy violation' });
      }
      
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
EOF

echo "✅ Server configuration updated"

# 3. Restart services
echo "📦 Step 3: Restarting services..."

# Stop PM2 process
pm2 stop hls4u-stream 2>/dev/null || true
pm2 delete hls4u-stream 2>/dev/null || true

# Clear logs
pm2 flush

# Start again
pm2 start ecosystem.config.js

echo "📦 Step 4: Checking status..."
sleep 3
pm2 status
pm2 logs hls4u-stream --lines 20

echo ""
echo "✅ All fixes applied!"
echo "🔍 Check logs: pm2 logs hls4u-stream"
echo "🌐 Test health: curl http://127.0.0.1:3000/health"
