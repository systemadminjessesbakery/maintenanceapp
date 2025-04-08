// Application entry point
require('dotenv').config();
console.log('Starting app.js in environment: ' + process.env.NODE_ENV);

// Use the combined server to provide all functionality
require('./combined-server.js'); 