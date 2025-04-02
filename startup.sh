#!/bin/bash
echo "Starting deployment..."
cd /home/site/wwwroot
echo "Installing dependencies..."
npm install
echo "Starting server..."
node combined-server.js 