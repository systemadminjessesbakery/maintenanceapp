/**
 * Jesse's Bakery Maintenance App - Simplified Server
 * Single server file with combined functionality
 */

// Load dependencies
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const sql = require('mssql');
const cors = require('cors');
require('dotenv').config();

// Create Express app
const app = express();

// Simple version tracking
const VERSION = Date.now().toString();

// Configure logging based on environment
const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'error' : 'info');
const logger = {
  error: (...args) => console.error(...args),
  warn: (...args) => LOG_LEVEL !== 'error' && console.warn(...args),
  info: (...args) => ['info', 'debug'].includes(LOG_LEVEL) && console.log(...args),
  debug: (...args) => LOG_LEVEL === 'debug' && console.log(...args)
};

logger.info(`Server starting with version: ${VERSION}`);

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Add static file serving before other routes
app.use(express.static(__dirname));
app.use('/images', express.static('images'));

// Add CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    next();
});

// Simplified request logging middleware - only log in debug mode
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.url}`);
  next();
});

// Anti-caching middleware for HTML files
app.use((req, res, next) => {
  // Strong no-cache headers
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Version': VERSION
  });
  
  // Add version info for HTML responses
  const originalSend = res.send;
  res.send = function(body) {
    let modifiedBody = body;
    
    // Only modify HTML content
    if (typeof body === 'string' && res.get('Content-Type')?.includes('text/html')) {
      // Add timestamp to JS and CSS file references
      modifiedBody = body.replace(
        /(src|href)=(["'])([^"'http].*?\.(?:js|css))(["'])/g, 
        `$1=$2$3?v=${VERSION}$4`
      );
      
      // Add meta tags to prevent caching if not already present
      if (!modifiedBody.includes('<meta http-equiv="Cache-Control"')) {
        const headEndPos = modifiedBody.indexOf('</head>');
        if (headEndPos !== -1) {
          modifiedBody = 
            modifiedBody.slice(0, headEndPos) + 
            '\n  <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">' +
            '\n  <meta http-equiv="Pragma" content="no-cache">' +
            '\n  <meta http-equiv="Expires" content="0">' +
            '\n  <meta name="version" content="' + VERSION + '">' +
            modifiedBody.slice(headEndPos);
        }
      }
    }
    
    return originalSend.call(this, modifiedBody);
  };
  
  next();
});

// Database configuration
const dbConfig = {
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER || '',
  database: process.env.DB_NAME || '',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
    enableArithAbort: true,
    connectTimeout: 60000,
    requestTimeout: 60000
  },
  pool: {
    max: parseInt(process.env.DB_MAX_POOL_SIZE) || 20,
    min: 0,
    idleTimeoutMillis: 60000
  }
};

// Database connection pool
const pool = new sql.ConnectionPool(dbConfig);
let poolConnected = false;

// Connect to database in background
pool.connect().then(() => {
  logger.info('Connected to database');
  poolConnected = true;
}).catch(err => {
  logger.error('Database connection error:', err);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    version: VERSION,
    timestamp: new Date().toISOString(),
    dbConnected: poolConnected
  });
});

// Debug info endpoint
app.get('/debug', (req, res) => {
  const info = {
    version: VERSION,
    timestamp: new Date().toISOString(),
    directory: __dirname,
    dbConfig: {
      server: dbConfig.server,
      database: dbConfig.database,
      connected: poolConnected
    },
    environment: process.env.NODE_ENV,
    files: fs.readdirSync(__dirname)
  };
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Jesse's Bakery - Debug Info</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #4CAF50; }
        .content { max-width: 800px; margin: 0 auto; }
        .debug { background: #f5f5f5; padding: 15px; border-radius: 5px; margin-top: 20px; }
        pre { overflow-x: auto; }
        a { color: #4CAF50; }
      </style>
    </head>
    <body>
      <div class="content">
        <h1>Jesse's Bakery Maintenance App - Debug Info</h1>
        <p><a href="/">Back to Home</a></p>
        <div class="debug">
          <pre>${JSON.stringify(info, null, 2)}</pre>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Regional Performance endpoint
app.get('/api/regional-performance', async (req, res) => {
  logger.debug('Received request for /api/regional-performance');
  
  // Set strict no-cache headers
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'Pragma': 'no-cache',
    'Expires': '0'
  });

  if (!poolConnected) {
    logger.error('Database connection not available');
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Query the view directly with NOLOCK hint
    const query = `
      SELECT 
        Week_Label,
        Region,
        Sunday,
        Monday,
        Tuesday,
        Wednesday,
        Thursday,
        Friday,
        Saturday,
        Total_Week_Quantity
      FROM [dbo].[vw_Cumulative_Weekly_Region_Sales] WITH (NOLOCK)
      ORDER BY Week_Label DESC, Region;
    `;
    
    logger.debug('Executing regional performance query');
    const result = await pool.request().query(query);
    
    if (!result || !result.recordset) {
      logger.error('Query returned no recordset');
      throw new Error('Invalid query result structure');
    }
    
    // Get unique regions for the selector
    const regions = [...new Set(result.recordset.map(row => row.Region))];
    
    // Add metadata to help client verify freshness
    const response = {
      data: result.recordset,
      regions: regions,
      metadata: {
        timestamp: new Date().toISOString(),
        rowCount: result.recordset.length
      }
    };
    
    logger.debug(`Regional performance query returned ${result.recordset.length} rows`);
    res.json(response);
    
  } catch (err) {
    logger.error('Error fetching regional performance data:', err);
    res.status(500).json({ 
      error: 'Error fetching regional performance data',
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Actual Sales endpoint
app.get('/api/actual-sales', async (req, res) => {
  logger.debug('Received request for /api/actual-sales');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Extract date parameters
    const startDate = req.query.start || null;
    const endDate = req.query.end || null;
    
    // Default to 30 days if no date range provided
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);
    const defaultEndDate = new Date();
    
    // Build the query with date parameters
    const request = pool.request();
    
    if (startDate) {
      request.input('StartDate', sql.Date, new Date(startDate));
    } else {
      request.input('StartDate', sql.Date, defaultStartDate);
    }
    
    if (endDate) {
      request.input('EndDate', sql.Date, new Date(endDate));
    } else {
      request.input('EndDate', sql.Date, defaultEndDate);
    }
    
    const result = await request.query(`
      SELECT 
        s.Store_ID,
        s.Store_Name,
        s.Location,
        p.Product_ID,
        p.Description,
        c.Transaction_Date,
        c.Quantity,
        c.Source
      FROM dbo.Combined_Sales_Data_Final c WITH (NOLOCK)
      JOIN dbo.Stores_Master s WITH (NOLOCK) ON c.Store_ID = s.Store_ID
      JOIN dbo.Products_Master p WITH (NOLOCK) ON c.Product_ID = p.Product_ID
      WHERE c.Transaction_Date >= @StartDate
      AND c.Transaction_Date <= @EndDate
      ORDER BY s.Store_Name, p.Description, c.Transaction_Date
    `);
    
    logger.debug(`Actual sales query returned ${result.recordset.length} rows`);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: 'No sales data found for the selected date range'
      });
    }
    
    res.json(result.recordset);
  } catch (err) {
    logger.error('Error fetching sales data:', err);
    res.status(500).json({ 
      error: 'Error fetching sales data',
      details: err.message
    });
  }
});

// Stores Master endpoints
// Get all stores
app.get('/api/stores', async (req, res) => {
  logger.debug('Received request for /api/stores');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Get all stores
    const storesResult = await pool.request()
      .query(`
        SELECT * FROM Stores_Master
        ORDER BY Store_Name;
      `);
    
    // Get unique regions for dropdown
    const regionsResult = await pool.request()
      .query(`
        SELECT DISTINCT Region FROM Stores_Master
        WHERE Region IS NOT NULL AND Region <> ''
        ORDER BY Region;
      `);
    
    const regions = regionsResult.recordset.map(r => r.Region);
    
    // Format expected by stores-master.html
    res.json({
      stores: storesResult.recordset,
      regions: regions,
      lastRunDate: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Error fetching stores data:', err);
    res.status(500).json({ 
      error: 'Error fetching stores data',
      details: err.message
    });
  }
});

// Get next available store ID
app.get('/api/stores/next-id', async (req, res) => {
  logger.debug('Received request for /api/stores/next-id');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const result = await pool.request()
      .query(`
        SELECT MAX(CAST(Store_ID AS INT)) + 1 AS NextID FROM Stores_Master;
      `);
    
    const nextId = result.recordset[0].NextID || 1;
    res.json({ nextId: nextId.toString() });
  } catch (err) {
    logger.error('Error getting next store ID:', err);
    res.status(500).json({ 
      error: 'Error getting next store ID',
      details: err.message
    });
  }
});

// Get store by ID
app.get('/api/stores/:storeId', async (req, res) => {
  const storeId = req.params.storeId;
  logger.debug(`Received request for store ID: ${storeId}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const result = await pool.request()
      .input('Store_ID', sql.VarChar(50), storeId)
      .query(`
        SELECT * FROM Stores_Master
        WHERE Store_ID = @Store_ID;
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    res.json(result.recordset[0]);
  } catch (err) {
    logger.error(`Error fetching store ${storeId}:`, err);
    res.status(500).json({ 
      error: 'Error fetching store data',
      details: err.message
    });
  }
});

// Create a new store
app.post('/api/stores', async (req, res) => {
  logger.debug('Received request to create a new store');
  const store = req.body;
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  // Validate required fields
  if (!store.Store_Name) {
    return res.status(400).json({ error: 'Store Name is required' });
  }
  if (!store.Region) {
    return res.status(400).json({ error: 'Region is required' });
  }
  
  try {
    // Get next store ID
    const idResult = await pool.request()
      .query(`SELECT MAX(CAST(Store_ID AS INT)) + 1 AS NextID FROM Stores_Master;`);
    const storeId = (idResult.recordset[0].NextID || 1).toString();
    
    // Insert the new store
    const request = pool.request()
      .input('Store_ID', sql.VarChar(50), storeId)
      .input('Store_Name', sql.NVarChar(500), store.Store_Name)
      .input('Region', sql.NVarChar(500), store.Region)
      .input('State', sql.NVarChar(500), store.State || '')
      .input('Active', sql.VarChar(50), store.Active || 'Active')
      .input('Address', sql.NVarChar(500), store.Address || '')
      .input('Supplier_Code', sql.NVarChar(500), store.Supplier_Code || '');
    
    // Add boolean fields
    ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 
     'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY'].forEach(day => {
      request.input(day, sql.Bit, store[day] === 'TRUE' ? 1 : 0);
    });
    
    const query = `
      INSERT INTO Stores_Master (
        Store_ID, Store_Name, Region, State, Active, Address, Supplier_Code,
        SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
        SPECIAL_FRIDAY, SPECIAL_SUNDAY, Created_At, Updated_At
      )
      VALUES (
        @Store_ID, @Store_Name, @Region, @State, @Active, @Address, @Supplier_Code,
        @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
        @SPECIAL_FRIDAY, @SPECIAL_SUNDAY, GETDATE(), GETDATE()
      );
      
      SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID;
    `;
    
    const result = await request.query(query);
    logger.info(`Store created with ID: ${storeId}`);
    res.status(201).json({ storeId: storeId, store: result.recordset[0] });
  } catch (err) {
    logger.error('Error creating store:', err);
    res.status(500).json({ 
      error: 'Error creating store',
      details: err.message
    });
  }
});

// Update a store
app.put('/api/stores/:storeId', async (req, res) => {
  const storeId = req.params.storeId;
  const updates = req.body;

  try {
    // Check database connection
    if (!poolConnected) {
      logger.error('Database connection not available');
      return res.status(503).json({ error: 'Database connection not available' });
    }

    // Validate store exists
    const storeExists = await pool.request()
      .input('storeId', sql.VarChar, storeId)
      .query('SELECT COUNT(*) as count FROM Stores_Master WHERE Store_ID = @storeId');

    if (storeExists.recordset[0].count === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }

    // Validate required fields
    if (!updates.Store_Name || !updates.Region) {
      return res.status(400).json({ error: 'Store name and region are required' });
    }

    // Validate field lengths
    if (updates.Store_Name.length > 100 || updates.Region.length > 50) {
      return res.status(400).json({ error: 'Store name or region exceeds maximum length' });
    }

    // Build dynamic update query
    const updateFields = [];
    const request = pool.request().input('storeId', sql.VarChar, storeId);

    // Define boolean fields
    const booleanFields = [
      'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 
      'FRIDAY', 'SATURDAY', 'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY'
    ];

    Object.entries(updates).forEach(([key, value]) => {
      if (key !== 'Store_ID') { // Don't update the ID
        if (booleanFields.includes(key)) {
          // Handle string 'TRUE'/'FALSE' values
          const boolValue = value === 'TRUE' || value === true || value === '1' || value === 1 ? 1 : 0;
          updateFields.push(`${key} = @${key}`);
          request.input(key, sql.Bit, boolValue);
        } else {
          updateFields.push(`${key} = @${key}`);
          // Use NVarChar for text fields that may contain Unicode characters
          if (['Store_Name', 'Region', 'State', 'Address', 'Supplier_Code'].includes(key)) {
            request.input(key, sql.NVarChar, value);
          } else {
            request.input(key, sql.VarChar, value);
          }
        }
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const query = `
      UPDATE Stores_Master 
      SET ${updateFields.join(', ')}
      WHERE Store_ID = @storeId;
      
      SELECT * FROM Stores_Master WHERE Store_ID = @storeId;
    `;

    const result = await request.query(query);

    if (result.recordset.length > 0) {
      res.json(result.recordset[0]);
    } else {
      res.status(404).json({ error: 'Store not found after update' });
    }
  } catch (err) {
    logger.error(`Error updating store ${storeId}:`, err);
    res.status(500).json({ 
      error: 'Error updating store',
      details: err.message
    });
  }
});

// Delete a store
app.delete('/api/stores/:storeId', async (req, res) => {
  const storeId = req.params.storeId;
  logger.debug(`Received request to delete store ID: ${storeId}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Check if the store exists
    const storeCheck = await pool.request()
      .input('Store_ID', sql.VarChar(50), storeId)
      .query('SELECT Store_ID FROM Stores_Master WHERE Store_ID = @Store_ID');
        
    if (storeCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    // Delete the store
    await pool.request()
      .input('Store_ID', sql.VarChar(50), storeId)
      .query('DELETE FROM Stores_Master WHERE Store_ID = @Store_ID');
    
    logger.info(`Store ${storeId} deleted successfully`);
    res.json({ message: 'Store deleted successfully' });
  } catch (err) {
    logger.error(`Error deleting store ${storeId}:`, err);
    res.status(500).json({ 
      error: 'Error deleting store',
      details: err.message
    });
  }
});

// Serve static files with cache busting
app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=0');
    }
  }
}));

// Default route handler for unmatched routes
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Page Not Found</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #E57373; }
        .content { max-width: 800px; margin: 0 auto; }
        a { color: #4CAF50; }
      </style>
    </head>
    <body>
      <div class="content">
        <h1>404 - Page Not Found</h1>
        <p>The page you requested could not be found.</p>
        <p><a href="/">Return to home</a> or <a href="/debug">View debug information</a></p>
      </div>
    </body>
    </html>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Server Error</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
        h1 { color: #E57373; }
        .content { max-width: 800px; margin: 0 auto; }
        a { color: #4CAF50; }
      </style>
    </head>
    <body>
      <div class="content">
        <h1>500 - Server Error</h1>
        <p>Something went wrong on the server.</p>
        <p><a href="/">Return to home</a> or <a href="/debug">View debug information</a></p>
      </div>
    </body>
    </html>
  `);
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
}); 