#!/bin/bash

echo "Clearing cache and restarting application for Linux server..."

# Find and kill the Node.js process running server.js
echo "Stopping application processes..."
pkill -f "node.*server.js" || echo "No matching processes found"

# Clear Node.js cache
echo "Clearing Node.js cache..."
rm -rf ~/.npm/_cacache/* 2>/dev/null
rm -rf node_modules/.cache/* 2>/dev/null

# Clear temporary files
echo "Clearing temporary files..."
mkdir -p tmp
rm -rf tmp/* 2>/dev/null
touch tmp/restart.txt

# Touch all HTML and JS files to update timestamps
echo "Updating file timestamps..."
find . -name "*.html" -exec touch {} \;
find . -name "*.js" -exec touch {} \;

# Update version marker
echo "$(date)" > lastDeployment.txt

# Restart the application
echo "Restarting application..."
NODE_ENV=production nohup node server.js > server.log 2>&1 &
echo $! > server.pid

echo "Cache clearing complete, application restarted" 