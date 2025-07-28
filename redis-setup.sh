#!/bin/bash
echo "🔧 Setting up Redis for HLS4U Stream..."

# Install Redis
if ! command -v redis-server &> /dev/null; then
    echo "📦 Installing Redis..."
    sudo apt update
    sudo apt install -y redis-server
fi

# Start Redis service
sudo systemctl enable redis-server
sudo systemctl restart redis-server

# Test Redis
sleep 2
if redis-cli ping | grep -q "PONG"; then
    echo "✅ Redis is working"
else
    echo "❌ Redis failed"
    exit 1
fi

# Install Node.js dependencies
echo "📦 Installing Redis dependencies..."
npm install redis@^4.6.5 connect-redis@^7.1.0

echo "✅ Redis setup complete!"