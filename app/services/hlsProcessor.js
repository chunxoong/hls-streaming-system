const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;

class HLSProcessor {
  constructor(db) {
    this.db = db;
    this.processing = false;
    this.queue = [];
  }

  // Add video to processing queue
  addToQueue(videoData) {
    this.queue.push(videoData);
    console.log(`📹 Added video ${videoData.videoId} to HLS processing queue`);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processNext();
    }
  }

  // Process next video in queue
  async processNext() {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const videoData = this.queue.shift();
    
    try {
      await this.processVideo(videoData);
    } catch (error) {
      console.error(`❌ HLS processing failed for video ${videoData.videoId}:`, error);
      await this.updateVideoStatus(videoData.videoId, 'error');
    }

    // Process next video
    this.processNext();
  }

  // Main video processing function
  async processVideo(videoData) {
    const { videoId, fileName, finalPath } = videoData;
    console.log(`🎬 Starting HLS conversion for video ${videoId}`);

    try {
      // Create HLS output directory
      const hlsDir = path.join(__dirname, '../../hls', `video-${videoId}`);
      await fs.mkdir(hlsDir, { recursive: true });

      // Get video info
      const videoInfo = await this.getVideoInfo(finalPath);
      console.log(`📊 Video info:`, videoInfo);

      // Update video metadata
      await this.updateVideoMetadata(videoId, videoInfo);

      // Generate thumbnail
      const thumbnailPath = await this.generateThumbnail(finalPath, videoId);

      // Convert to HLS with multiple qualities
      const hlsPath = await this.convertToHLS(finalPath, hlsDir, videoId, videoInfo);

      // Update video record
      await this.db.execute(
        'UPDATE videos SET status = ?, hls_path = ?, thumbnail_path = ?, duration = ?, resolution = ? WHERE id = ?',
        ['completed', hlsPath, thumbnailPath, videoInfo.duration, videoInfo.resolution, videoId]
      );

      console.log(`✅ HLS conversion completed for video ${videoId}`);
      
    } catch (error) {
      console.error(`❌ Error processing video ${videoId}:`, error);
      throw error;
    }
  }

  // Get video information using ffprobe
  getVideoInfo(inputPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(inputPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }

        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

        resolve({
          duration: Math.round(metadata.format.duration),
          bitrate: metadata.format.bit_rate,
          size: metadata.format.size,
          resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : 'unknown',
          videoCodec: videoStream ? videoStream.codec_name : 'unknown',
          audioCodec: audioStream ? audioStream.codec_name : 'unknown',
          fps: videoStream ? eval(videoStream.r_frame_rate) : 0
        });
      });
    });
  }

  // Generate thumbnail
  async generateThumbnail(inputPath, videoId) {
    const thumbnailDir = path.join(__dirname, '../../public/thumbnails');
    await fs.mkdir(thumbnailDir, { recursive: true });
    
    const thumbnailPath = path.join(thumbnailDir, `video-${videoId}.jpg`);
    const publicPath = `/public/thumbnails/video-${videoId}.jpg`;

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .screenshots({
          timestamps: ['10%'], // Take screenshot at 10% of video duration
          filename: `video-${videoId}.jpg`,
          folder: thumbnailDir,
          size: '640x360'
        })
        .on('end', () => {
          console.log(`📸 Thumbnail generated for video ${videoId}`);
          resolve(publicPath);
        })
        .on('error', (err) => {
          console.error(`❌ Thumbnail generation failed:`, err);
          reject(err);
        });
    });
  }

  // Convert video to HLS format with multiple qualities
  async convertToHLS(inputPath, outputDir, videoId, videoInfo) {
    const masterPlaylist = path.join(outputDir, 'playlist.m3u8');
    const publicPath = `/hls/video-${videoId}/playlist.m3u8`;

    // Determine which qualities to generate based on source resolution
    const sourceHeight = parseInt(videoInfo.resolution.split('x')[1]);
    const qualities = this.determineQualities(sourceHeight);

    console.log(`🎯 Generating qualities:`, qualities.map(q => q.name).join(', '));

    // Generate HLS for each quality
    const variantPlaylists = [];
    
    for (const quality of qualities) {
      const variantName = `${quality.name}/playlist.m3u8`;
      const variantDir = path.join(outputDir, quality.name);
      await fs.mkdir(variantDir, { recursive: true });

      await this.generateHLSVariant(inputPath, variantDir, quality);
      
      variantPlaylists.push({
        name: quality.name,
        bandwidth: quality.bitrate * 1000,
        resolution: quality.resolution,
        playlist: `${quality.name}/playlist.m3u8`
      });
    }

    // Create master playlist
    await this.createMasterPlaylist(masterPlaylist, variantPlaylists);

    return publicPath;
  }

  // Determine which qualities to generate
  determineQualities(sourceHeight) {
    const allQualities = [
      { name: '1080p', height: 1080, bitrate: 5000, resolution: '1920x1080' },
      { name: '720p', height: 720, bitrate: 3000, resolution: '1280x720' },
      { name: '480p', height: 480, bitrate: 1500, resolution: '854x480' },
      { name: '360p', height: 360, bitrate: 800, resolution: '640x360' }
    ];

    // Only include qualities that are equal or lower than source
    return allQualities.filter(q => q.height <= sourceHeight);
  }

  // Generate HLS variant
  generateHLSVariant(inputPath, outputDir, quality) {
    return new Promise((resolve, reject) => {
      const outputPath = path.join(outputDir, 'playlist.m3u8');
      
      ffmpeg(inputPath)
        .outputOptions([
          '-c:v libx264',
          '-c:a aac',
          '-b:v ' + quality.bitrate + 'k',
          '-b:a 128k',
          '-vf scale=' + quality.resolution,
          '-f hls',
          '-hls_time 10',
          '-hls_list_size 0',
          '-hls_segment_filename ' + path.join(outputDir, 'segment_%03d.ts')
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          console.log(`🚀 Starting ${quality.name} conversion...`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ ${quality.name}: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log(`✅ ${quality.name} conversion completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`❌ ${quality.name} conversion failed:`, err);
          reject(err);
        })
        .run();
    });
  }

  // Create master playlist
  async createMasterPlaylist(masterPath, variants) {
    let content = '#EXTM3U\n#EXT-X-VERSION:3\n\n';
    
    for (const variant of variants) {
      content += `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${variant.resolution}\n`;
      content += `${variant.playlist}\n\n`;
    }

    await fs.writeFile(masterPath, content);
    console.log(`📄 Master playlist created`);
  }

  // Update video metadata
  async updateVideoMetadata(videoId, videoInfo) {
    await this.db.execute(
      'UPDATE videos SET duration = ?, resolution = ? WHERE id = ?',
      [videoInfo.duration, videoInfo.resolution, videoId]
    );
  }

  // Update video status
  async updateVideoStatus(videoId, status) {
    await this.db.execute(
      'UPDATE videos SET status = ? WHERE id = ?',
      [status, videoId]
    );
  }
}

module.exports = HLSProcessor;