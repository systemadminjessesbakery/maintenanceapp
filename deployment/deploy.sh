#!/bin/bash
set -e

echo "Starting deployment process for Linux server..."

# Print current directory and files for debugging
echo "Current directory: $(pwd)"
echo "Files before deployment:"
ls -la

echo "Installing dependencies..."
npm install --production

echo "Setting up environment..."
if [ ! -f ".env" ]; then
    echo "Creating .env file..."
    cp .env.example .env
fi

echo "Making script files executable..."
chmod +x *.sh

echo "Ensuring proper file permissions..."
find . -type f -name "*.html" -exec chmod 644 {} \;
find . -type f -name "*.js" -exec chmod 644 {} \;
find . -type f -name "*.json" -exec chmod 644 {} \;

echo "Clearing server cache..."
echo "Files to be touched:"
find . -type f \( -name "*.html" -o -name "*.js" \) -exec echo {} \;
find . -type f \( -name "*.html" -o -name "*.js" \) -exec touch {} \;

# Force update timestamp on critical files
echo "Updating timestamps on critical files..."
touch regional-performance.html
touch combined-server.js

# Verify file contents
echo "Verifying file contents:"
echo "regional-performance.html size: $(stat -c %s regional-performance.html 2>/dev/null || wc -c < regional-performance.html)"
echo "combined-server.js size: $(stat -c %s combined-server.js 2>/dev/null || wc -c < combined-server.js)"

echo "Files after deployment:"
ls -la

# Create a temp directory if it doesn't exist
if [ ! -d "tmp" ]; then
    mkdir -p tmp
fi

# Signal for application restart
echo "Creating restart marker..."
date > ./tmp/restart.txt

# Attempt to restart the application
echo "Stopping existing process..."
pkill -f "node.*combined-server.js" || echo "No server process found"

echo "Starting server..."
nohup node combined-server.js > server.log 2>&1 &
echo $! > server.pid
echo "Server started with PID: $(cat server.pid)"

echo "Deployment completed successfully" 