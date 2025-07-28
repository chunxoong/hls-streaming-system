const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.admin) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};

// Ensure upload directories exist
const ensureUploadDirs = async () => {
  const dirs = [
    path.join(__dirname, '../../storage/uploads'),
    path.join(__dirname, '../../storage/temp'),
    path.join(__dirname, '../../hls')
  ];
  
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
};

// Initialize directories
ensureUploadDirs();

// Multer configuration for chunked uploads
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    const tempDir = path.join(__dirname, '../../storage/temp');
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB chunks for Cloudflare
  }
});

// Initialize video upload
router.post('/init', requireAuth, async (req, res) => {
  try {
    const { fileName, fileSize, totalChunks } = req.body;
    const db = req.app.locals.db;
    
    // Generate unique upload ID
    const uploadId = uuidv4();
    const fileExt = path.extname(fileName);
    const safeFileName = `video-${uploadId}${fileExt}`;
    
    // Insert video record with uploading status
    const [result] = await db.execute(
      'INSERT INTO videos (title, filename, original_filename, file_size, status) VALUES (?, ?, ?, ?, ?)',
      [fileName, safeFileName, fileName, fileSize, 'uploading']
    );
    
    res.json({
      uploadId: uploadId,
      videoId: result.insertId,
      fileName: safeFileName,
      totalChunks: totalChunks
    });
  } catch (error) {
    console.error('Upload init error:', error);
    res.status(500).json({ error: 'Failed to initialize upload' });
  }
});

// Upload chunk
router.post('/chunk', requireAuth, upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks, videoId } = req.body;
    const chunkPath = req.file.path;
    
    // Store chunk info in temp directory
    const chunkInfoPath = path.join(__dirname, '../../storage/temp', `${uploadId}-${chunkIndex}`);
    await fs.rename(chunkPath, chunkInfoPath);
    
    // Check if all chunks are uploaded
    const chunks = [];
    for (let i = 0; i < parseInt(totalChunks); i++) {
      const chunkFile = path.join(__dirname, '../../storage/temp', `${uploadId}-${i}`);
      try {
        await fs.access(chunkFile);
        chunks.push(i);
      } catch (e) {
        // Chunk not found
      }
    }
    
    if (chunks.length === parseInt(totalChunks)) {
      // All chunks uploaded, merge them
      res.json({ 
        status: 'chunk_uploaded', 
        complete: true,
        chunks: chunks.length,
        totalChunks: totalChunks
      });
    } else {
      res.json({ 
        status: 'chunk_uploaded', 
        complete: false,
        chunks: chunks.length,
        totalChunks: totalChunks
      });
    }
  } catch (error) {
    console.error('Chunk upload error:', error);
    res.status(500).json({ error: 'Failed to upload chunk' });
  }
});

// Merge chunks and start processing
router.post('/merge', requireAuth, async (req, res) => {
  try {
    const { uploadId, videoId, fileName, totalChunks } = req.body;
    const db = req.app.locals.db;
    
    const finalPath = path.join(__dirname, '../../storage/uploads', fileName);
    const writeStream = require('fs').createWriteStream(finalPath);
    
    // Merge all chunks in order
    for (let i = 0; i < parseInt(totalChunks); i++) {
      const chunkPath = path.join(__dirname, '../../storage/temp', `${uploadId}-${i}`);
      const chunkData = await fs.readFile(chunkPath);
      writeStream.write(chunkData);
      
      // Delete chunk after writing
      await fs.unlink(chunkPath);
    }
    
    writeStream.end();
    
    writeStream.on('finish', async () => {
      // Update video status to processing
      await db.execute(
        'UPDATE videos SET status = ? WHERE id = ?',
        ['processing', videoId]
      );
      
      // Trigger HLS conversion (will implement next)
      const hlsQueue = req.app.locals.hlsQueue || [];
      hlsQueue.push({ videoId, fileName, finalPath });
      
      res.json({ 
        status: 'merged',
        videoId: videoId,
        message: 'Video uploaded successfully, processing started'
      });
    });
    
    writeStream.on('error', (error) => {
      console.error('Merge error:', error);
      res.status(500).json({ error: 'Failed to merge chunks' });
    });
    
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({ error: 'Failed to merge video' });
  }
});

// Simple upload for small files (< 100MB)
router.post('/video', requireAuth, upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }
    
    const db = req.app.locals.db;
    const { title = req.file.originalname, description = '' } = req.body;
    
    // Generate unique filename
    const uploadId = uuidv4();
    const fileExt = path.extname(req.file.originalname);
    const fileName = `video-${uploadId}${fileExt}`;
    const finalPath = path.join(__dirname, '../../storage/uploads', fileName);
    
    // Move file to uploads directory
    await fs.rename(req.file.path, finalPath);
    
    // Insert video record
    const [result] = await db.execute(
      'INSERT INTO videos (title, description, filename, original_filename, file_size, status) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, fileName, req.file.originalname, req.file.size, 'processing']
    );
    
    const videoId = result.insertId;
    
    // Trigger HLS conversion
    const hlsQueue = req.app.locals.hlsQueue || [];
    hlsQueue.push({ videoId, fileName, finalPath });
    
    res.json({
      status: 'success',
      videoId: videoId,
      message: 'Video uploaded successfully'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload video' });
  }
});

// Get upload progress
router.get('/progress/:videoId', requireAuth, async (req, res) => {
  try {
    const db = req.app.locals.db;
    const videoId = req.params.videoId;
    
    const [videos] = await db.execute(
      'SELECT id, title, status, created_at FROM videos WHERE id = ?',
      [videoId]
    );
    
    if (videos.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    
    res.json({ video: videos[0] });
  } catch (error) {
    console.error('Progress check error:', error);
    res.status(500).json({ error: 'Failed to check progress' });
  }
});

module.exports = router;