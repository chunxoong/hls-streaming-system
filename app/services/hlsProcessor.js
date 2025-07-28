// app/services/hlsProcessor.js - FIXED VERSION với đúng path
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const Redis = require('ioredis');

class HLSProcessor {
  constructor() {
    this.redis = new Redis({
      host: 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });
    
    this.isProcessing = false;
    
    // Start queue processor
    this.startQueueProcessor();
    
    console.log('✅ HLS Processor initialized - Fixed Version');
  }

  async startQueueProcessor() {
    console.log('🚀 Starting HLS queue processor...');
    
    // Process pending videos from database first
    await this.processPendingVideos();
    
    // Then start Redis queue monitoring
    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processQueue();
      }
    }, 5000); // Check every 5 seconds
    
    console.log('✅ Queue processor started successfully');
  }

  async processPendingVideos() {
    try {
      const mysql = require('mysql2/promise');
      const connection = await mysql.createConnection({
        host: 'localhost',
        user: 'hls4u-stream',
        password: 'N72kySNBgREd9nNCnu3m',
        database: 'hls4u-stream'
      });

      const [pendingVideos] = await connection.execute(
        'SELECT * FROM videos WHERE status = "processing" ORDER BY created_at ASC'
      );

      console.log(`📋 Found ${pendingVideos.length} pending videos to process`);

      for (const video of pendingVideos) {
        console.log(`➕ Adding pending video to queue: ${video.title} (ID: ${video.id})`);
        await this.addToQueue(video);
      }

      await connection.end();
    } catch (error) {
      console.error('❌ Error processing pending videos:', error);
    }
  }

  async addToQueue(videoData) {
    try {
      await this.redis.lpush('hls_queue', JSON.stringify(videoData));
      console.log(`✅ Video added to HLS queue: ${videoData.title} (ID: ${videoData.id})`);
    } catch (error) {
      console.error('❌ Error adding video to queue:', error);
    }
  }

  async processQueue() {
    try {
      const videoDataStr = await this.redis.brpop('hls_queue', 1);
      
      if (videoDataStr && videoDataStr[1]) {
        const videoData = JSON.parse(videoDataStr[1]);
        console.log(`🎬 Processing video from queue: ${videoData.title} (ID: ${videoData.id})`);
        
        this.isProcessing = true;
        await this.processVideo(videoData);
        this.isProcessing = false;
      }
    } catch (error) {
      console.error('❌ Error processing queue:', error);
      this.isProcessing = false;
    }
  }

  async processVideo(videoData) {
    const mysql = require('mysql2/promise');
    let connection;

    try {
      connection = await mysql.createConnection({
        host: 'localhost',
        user: 'hls4u-stream',
        password: 'N72kySNBgREd9nNCnu3m',
        database: 'hls4u-stream'
      });

      console.log(`🔄 Starting HLS processing for: ${videoData.title} (ID: ${videoData.id})`);
      
      // Update status to processing
      await connection.execute(
        'UPDATE videos SET status = ?, updated_at = NOW() WHERE id = ?',
        ['processing', videoData.id]
      );

      // FIXED: Use correct path - storage/uploads instead of uploads
      const inputPath = path.join(__dirname, '../../storage/uploads', videoData.filename);
      
      console.log(`📁 Looking for file: ${inputPath}`);
      
      try {
        await fs.access(inputPath);
        console.log(`✅ Input file found: ${inputPath}`);
      } catch {
        throw new Error(`Input file not found: ${inputPath}`);
      }

      // Create output directory
      const outputDir = path.join(__dirname, '../../public/hls', videoData.id.toString());
      await fs.mkdir(outputDir, { recursive: true });
      console.log(`📁 Created output directory: ${outputDir}`);

      // Generate HLS files
      const outputPath = path.join(outputDir, 'playlist.m3u8');
      
      await this.convertToHLS(inputPath, outputPath, videoData.id);

      // Update database with success
      const hlsPath = `/hls/${videoData.id}/playlist.m3u8`;
      await connection.execute(
        'UPDATE videos SET status = ?, hls_path = ?, updated_at = NOW() WHERE id = ?',
        ['completed', hlsPath, videoData.id]
      );

      console.log(`✅ HLS processing completed for: ${videoData.title} (ID: ${videoData.id})`);

    } catch (error) {
      console.error(`❌ HLS processing failed for: ${videoData.title} (ID: ${videoData.id})`, error);
      
      if (connection) {
        await connection.execute(
          'UPDATE videos SET status = ?, updated_at = NOW() WHERE id = ?',
          ['error', videoData.id]
        );
      }
    } finally {
      if (connection) {
        await connection.end();
      }
    }
  }

  convertToHLS(inputPath, outputPath, videoId) {
    return new Promise((resolve, reject) => {
      console.log(`🎞️  Converting ${inputPath} to HLS...`);
      
      const startTime = Date.now();
      
      ffmpeg(inputPath)
        .addOptions([
          '-profile:v baseline',
          '-level 3.0',
          '-start_number 0',
          '-hls_time 10',
          '-hls_list_size 0',
          '-f hls',
          '-hls_segment_filename', path.join(path.dirname(outputPath), 'segment%03d.ts')
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`🚀 FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Processing video ${videoId}: ${Math.round(progress.percent)}% complete`);
          }
        })
        .on('end', () => {
          const duration = Math.round((Date.now() - startTime) / 1000);
          console.log(`✅ FFmpeg finished processing video ${videoId} in ${duration}s`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`❌ FFmpeg error for video ${videoId}:`, err);
          reject(err);
        })
        .run();
    });
  }

  async getQueueLength() {
    try {
      return await this.redis.llen('hls_queue');
    } catch (error) {
      console.error('❌ Error getting queue length:', error);
      return 0;
    }
  }
}

module.exports = HLSProcessor;
