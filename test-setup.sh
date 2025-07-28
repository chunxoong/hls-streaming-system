#!/bin/bash
# Test setup script for HLS4U Stream

echo "=== HLS4U Stream Test Setup ==="
echo "1. Creating required directories..."

# Create required directories
mkdir -p storage/uploads
mkdir -p storage/temp
mkdir -p hls
mkdir -p logs

# Set permissions
chmod 755 storage/uploads
chmod 755 storage/temp
chmod 755 hls
chmod 755 logs

echo "✅ Directories created"

echo ""
echo "2. Testing database connection..."
# Test database connection
node -e "
const mysql = require('mysql2/promise');
(async () => {
  try {
    const connection = await mysql.createConnection({
      host: 'localhost',
      user: 'hls4u-stream',
      password: 'N72kySNBgREd9nNCnu3m',
      database: 'hls4u-stream'
    });
    await connection.ping();
    console.log('✅ Database connection successful');
    await connection.end();
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
  }
})();
"

echo ""
echo "3. File structure check:"
echo "Required files to create/update:"
echo "- ✅ app/routes/upload.js (new)"
echo "- ✅ views/pages/admin/videos.ejs (new)"
echo "- ✅ views/pages/admin/upload.ejs (updated)"
echo "- ⚠️  server.js (needs manual update - add upload route)"

echo ""
echo "4. Manual steps needed:"
echo "   a) Update server.js to add upload route:"
echo "      app.use('/upload', require('./app/routes/upload'));"
echo "      app.locals.hlsQueue = [];"
echo ""
echo "   b) Restart PM2:"
echo "      pm2 restart hls4u-stream"
echo ""
echo "5. Test URLs after restart:"
echo "   - Admin login: http://stream.hls4u.xyz/admin/login"
echo "   - Video management: http://stream.hls4u.xyz/admin/videos"
echo "   - Upload page: http://stream.hls4u.xyz/admin/upload"

echo ""
echo "=== Setup complete ==="
