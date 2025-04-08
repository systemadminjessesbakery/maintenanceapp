/**
 * Local development server starter
 * This file helps run the app locally with proper database connections
 */

// First load environment variables
require('dotenv').config();

// Print environment info
console.log('==========================================');
console.log('Local Development Environment');
console.log('Node version:', process.version);
console.log('Database server:', process.env.DB_SERVER);
console.log('Database name:', process.env.DB_NAME);
console.log('==========================================');

// Now import the combined server and run it
require('./combined-server.js'); 