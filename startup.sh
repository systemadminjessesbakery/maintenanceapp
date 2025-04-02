#!/bin/bash

# Exit on error
set -e

# Print environment information
echo "Node version: $(node -v)"
echo "NPM version: $(npm -v)"
echo "Current directory: $(pwd)"
echo "Environment: $NODE_ENV"

# Set default port if not set
export PORT="${PORT:-8080}"
echo "Using port: $PORT"

# Change to the application directory
cd /home/site/wwwroot

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install --production
fi

# Start the application
echo "Starting server..."
exec node combined-server.js 