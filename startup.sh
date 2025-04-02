#!/bin/bash

# Exit on error
set -e

# Print timestamps for logging
echo "[$(date)] Starting deployment script"

# Navigate to the application directory
cd /home/site/wwwroot
echo "[$(date)] Current directory: $(pwd)"
echo "[$(date)] Directory contents:"
ls -la

# Verify Node.js version
echo "[$(date)] Node.js version: $(node -v)"
echo "[$(date)] npm version: $(npm -v)"

# Remove problematic symlink if it exists
if [ -L "_del_node_modules" ]; then
    echo "[$(date)] Removing problematic symlink _del_node_modules"
    rm -f _del_node_modules
fi

# Clean install
echo "[$(date)] Cleaning node_modules"
rm -rf node_modules

# Verify package.json exists
if [ ! -f "package.json" ]; then
    echo "[$(date)] Error: package.json not found"
    ls -la
    exit 1
fi

# Install dependencies
echo "[$(date)] Installing dependencies"
npm config set loglevel verbose
npm install --production --no-optional --no-package-lock

# Verify node_modules exists and is not empty
if [ ! -d "node_modules" ] || [ -z "$(ls -A node_modules)" ]; then
    echo "[$(date)] Error: node_modules directory is missing or empty"
    exit 1
fi

# Verify combined-server.js exists
if [ ! -f "combined-server.js" ]; then
    echo "[$(date)] Error: combined-server.js not found"
    ls -la
    exit 1
fi

# Set default port if not set
export PORT=${PORT:-8080}
echo "[$(date)] Using port: $PORT"

# Start the application
echo "[$(date)] Starting the application"
exec node combined-server.js 