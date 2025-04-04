#!/bin/bash

# 1. Set deployment target directory
if [ -z "$DEPLOYMENT_TARGET" ]; then
  DEPLOYMENT_TARGET="$DEPLOYMENT_TARGET/site/wwwroot"
fi

# 2. Copy all files to deployment target
echo "Copying files to deployment target..."
cp -R . "$DEPLOYMENT_TARGET"

# 3. Install npm packages
if [ -f "$DEPLOYMENT_TARGET/package.json" ]; then
  cd "$DEPLOYMENT_TARGET"
  npm install --production
  if [ $? -ne 0 ]; then
    echo "Error: npm install failed"
    exit 1
  fi
fi

# 4. Start the application
cd "$DEPLOYMENT_TARGET"
npm start 