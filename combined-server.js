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
    'Cache-Control': 'no-store, no-cache, must-revalidate',
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
    // Get date parameters, default to last 30 days if not provided
    const endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
    const startDate = req.query.startDate ? 
      new Date(req.query.startDate) : 
      new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // Validate dates
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({
        error: 'Invalid date format',
        message: 'Please provide dates in YYYY-MM-DD format'
      });
    }
    
    // Format dates for SQL
    const startDateStr = startDate.toISOString().split('T')[0];
    const endDateStr = endDate.toISOString().split('T')[0];
    
    // Query the database with NOLOCK hint for better performance
    const result = await pool.request()
      .input('startDate', sql.Date, startDateStr)
      .input('endDate', sql.Date, endDateStr)
      .query(`
        SELECT 
          [Transaction_Date]
          ,[Store_ID]
          ,[Store_Name]
          ,[Location]
          ,[Product_ID]
          ,[Description]
          ,[Quantity]
          ,[Dollars_Sold]
          ,[Source]
          ,[Old_Store_ID]
          ,[Old_Product_ID]
        FROM [dbo].[Combined_Sales_Data_Final] WITH (NOLOCK)
        WHERE [Transaction_Date] BETWEEN @startDate AND @endDate
        ORDER BY [Transaction_Date] DESC, [Store_Name], [Description];
      `);
    
    // If no data found, return 404
    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: 'No sales data found for the specified date range',
        dateRange: {
          start: startDateStr,
          end: endDateStr
        }
      });
    }
    
    // Add cache control headers
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    // Return the data with metadata
    res.json({
      data: result.recordset,
      metadata: {
        startDate: startDateStr,
        endDate: endDateStr,
        rowCount: result.recordset.length,
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (err) {
    logger.error('Error fetching actual sales data:', err);
    res.status(500).json({ 
      error: 'Error fetching actual sales data',
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
    logger.debug(`Received request to update store ID: ${storeId}`);
    
    if (!poolConnected) {
        return res.status(503).json({
            error: 'Database not connected',
            message: 'The database connection is not available'
        });
    }
    
    try {
        // Validate store exists
        const storeCheck = await pool.request()
            .input('Store_ID', sql.VarChar(50), storeId)
            .query('SELECT Store_ID FROM Stores_Master WHERE Store_ID = @Store_ID');
            
        if (storeCheck.recordset.length === 0) {
            return res.status(404).json({ error: 'Store not found' });
        }

        // Validate required fields
        if (updates.Store_Name !== undefined && updates.Store_Name.trim() === '') {
            return res.status(400).json({ error: 'Store Name cannot be empty' });
        }
        if (updates.Region !== undefined && updates.Region.trim() === '') {
            return res.status(400).json({ error: 'Region cannot be empty' });
        }

        // Validate field lengths
        if (updates.Store_Name !== undefined && updates.Store_Name.length > 500) {
            return res.status(400).json({ error: 'Store Name exceeds maximum length of 500 characters' });
        }
        if (updates.Region !== undefined && updates.Region.length > 500) {
            return res.status(400).json({ error: 'Region exceeds maximum length of 500 characters' });
        }

        const request = pool.request()
            .input('Store_ID', sql.VarChar(50), storeId);

        // Build dynamic update query based on provided fields
        const updateFields = [];
        for (const [key, value] of Object.entries(updates)) {
            if (key === 'Store_ID') continue; // Skip Store_ID as it's the identifier

            if (['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY'].includes(key)) {
                // Handle boolean fields
                request.input(key, sql.VarChar(50), value === 'TRUE' ? 'TRUE' : 'FALSE');
                updateFields.push(`${key} = @${key}`);
            } else if (key === 'Shelf_Limit') {
                // Handle Shelf_Limit as a numeric field
                const numValue = value === '' ? null : parseFloat(value);
                request.input(key, sql.Int, numValue);
                updateFields.push(`${key} = @${key}`);
            } else {
                // Handle other fields (Store_Name, Region, State, etc.)
                request.input(key, sql.NVarChar(500), value.trim());
                updateFields.push(`${key} = @${key}`);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const query = `
            UPDATE Stores_Master 
            SET ${updateFields.join(', ')},
                Updated_At = GETDATE()
            WHERE Store_ID = @Store_ID;
            
            SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID;
        `;

        const result = await request.query(query);
        logger.info(`Store ${storeId} updated successfully`);
        
        if (result.recordset.length > 0) {
            res.json(result.recordset[0]);
        } else {
            res.json({ message: 'Store updated successfully' });
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

// Products Master endpoints
app.get('/api/products', async (req, res) => {
  logger.debug('Received request for /api/products');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Get all products with explicit field selection
    const productsResult = await pool.request()
      .query(`
        SELECT 
          Product_ID,
          Product_Description,
          Product_Family,
          WoolworthsCode,
          ColesCode,
          HarrisFarmCode,
          OtherCode,
          BakingUOM,
          BakingQuantity,
          UnitPerProduct,
          Wholesale_Cost_AUD,
          RRP_AUD,
          Product_Description_Production
        FROM Products_Master
        ORDER BY Product_Description;
      `);
    
    // Get unique product families for dropdown
    const familiesResult = await pool.request()
      .query(`
        SELECT DISTINCT Product_Family FROM Products_Master
        WHERE Product_Family IS NOT NULL AND Product_Family <> ''
        ORDER BY Product_Family;
      `);
    
    const families = familiesResult.recordset.map(r => r.Product_Family);

    res.json({
      products: productsResult.recordset,
      families: families,
      lastRunDate: new Date().toISOString()
    });
  } catch (err) {
    logger.error('Error fetching products data:', err);
    res.status(500).json({ 
      error: 'Error fetching products data',
      details: err.message
    });
  }
});

// Update a product
app.post('/api/products/update', async (req, res) => {
    const product = req.body;
  logger.debug(`Received request to update product: ${product.Product_ID}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Validate product exists
    const productExists = await pool.request()
            .input('Product_ID', sql.VarChar(50), product.Product_ID)
      .query('SELECT COUNT(*) as count FROM Products_Master WHERE Product_ID = @Product_ID');
    
    if (productExists.recordset[0].count === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    
    // Build update query
    const updateFields = [];
    const request = pool.request()
      .input('Product_ID', sql.VarChar(50), product.Product_ID);
    
    Object.entries(product).forEach(([key, value]) => {
      if (key !== 'Product_ID') { // Don't update the ID
        updateFields.push(`${key} = @${key}`);
        request.input(key, sql.NVarChar(500), value);
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    const query = `
      UPDATE Products_Master 
      SET ${updateFields.join(', ')}, Updated_At = GETDATE()
      WHERE Product_ID = @Product_ID;
      
      SELECT * FROM Products_Master WHERE Product_ID = @Product_ID;
    `;
    
    const result = await request.query(query);
    res.json(result.recordset[0]);
    } catch (err) {
    logger.error(`Error updating product ${product.Product_ID}:`, err);
    res.status(500).json({ 
      error: 'Error updating product',
      details: err.message
    });
  }
});

// Add a new product
app.post('/api/products/add', async (req, res) => {
  const product = req.body;
  logger.debug('Received request to add new product');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Check if product ID already exists
    const idExists = await pool.request()
      .input('Product_ID', sql.VarChar(50), product.Product_ID)
      .query('SELECT COUNT(*) as count FROM Products_Master WHERE Product_ID = @Product_ID');
    
    if (idExists.recordset[0].count > 0) {
      return res.status(400).json({ error: 'Product ID already exists' });
    }
    
    // Insert the new product
    const request = pool.request()
      .input('Product_ID', sql.VarChar(50), product.Product_ID)
      .input('Product_Description', sql.NVarChar(500), product.Product_Description)
      .input('Product_Family', sql.NVarChar(500), product.Product_Family)
      .input('WoolworthsCode', sql.NVarChar(500), product.WoolworthsCode || '')
      .input('ColesCode', sql.NVarChar(500), product.ColesCode || '')
      .input('HarrisFarmCode', sql.NVarChar(500), product.HarrisFarmCode || '')
      .input('OtherCode', sql.NVarChar(500), product.OtherCode || '')
      .input('BakingUOM', sql.NVarChar(500), product.BakingUOM || '')
      .input('BakingQuantity', sql.NVarChar(500), product.BakingQuantity || '')
      .input('UnitPerProduct', sql.NVarChar(500), product.UnitPerProduct || '')
      .input('Wholesale_Cost_AUD', sql.NVarChar(500), product.Wholesale_Cost_AUD || '')
      .input('RRP_AUD', sql.NVarChar(500), product.RRP_AUD || '')
      .input('Product_Description_Production', sql.NVarChar(500), product.Product_Description_Production || '');
    
    const query = `
      INSERT INTO Products_Master (
        Product_ID, Product_Description, Product_Family, WoolworthsCode, ColesCode,
        HarrisFarmCode, OtherCode, BakingUOM, BakingQuantity, UnitPerProduct,
        Wholesale_Cost_AUD, RRP_AUD, Product_Description_Production,
        Created_At, Updated_At
      )
      VALUES (
        @Product_ID, @Product_Description, @Product_Family, @WoolworthsCode, @ColesCode,
        @HarrisFarmCode, @OtherCode, @BakingUOM, @BakingQuantity, @UnitPerProduct,
        @Wholesale_Cost_AUD, @RRP_AUD, @Product_Description_Production,
        GETDATE(), GETDATE()
      );
      
      SELECT * FROM Products_Master WHERE Product_ID = @Product_ID;
    `;
    
    const result = await request.query(query);
    logger.info(`Product created with ID: ${product.Product_ID}`);
    res.status(201).json(result.recordset[0]);
    } catch (err) {
    logger.error('Error creating product:', err);
    res.status(500).json({ 
      error: 'Error creating product',
      details: err.message
    });
    }
});

// Adjustments endpoints
app.get('/api/adjustments', async (req, res) => {
  logger.debug('Received request for /api/adjustments');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const result = await pool.request()
            .query(`
                SELECT [Adjustment_ID]
                    ,[Store_ID]
                    ,[Store_Name]
                    ,[Product_ID]
                    ,[Product_Description]
                    ,[SUNDAY]
                    ,[MONDAY]
                    ,[TUESDAY]
                    ,[WEDNESDAY]
                    ,[THURSDAY]
                    ,[FRIDAY]
                    ,[SATURDAY]
                    ,[Week_Total]
                    ,[Created_At]
                    ,[Updated_At]
                FROM [dbo].[Store_Product_Adjustments]
        ORDER BY Created_At DESC;
      `);
    
    res.json({ adjustments: result.recordset });
    } catch (err) {
    logger.error('Error fetching adjustments data:', err);
    res.status(500).json({ 
      error: 'Error fetching adjustments data',
      details: err.message
    });
  }
});

app.post('/api/adjustments', async (req, res) => {
        const adjustment = req.body;
  logger.debug('Received request to create adjustment');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const request = pool.request()
      .input('Store_ID', sql.VarChar(50), adjustment.Store_ID)
      .input('Store_Name', sql.NVarChar(100), adjustment.Store_Name)
      .input('Product_ID', sql.VarChar(50), adjustment.Product_ID)
      .input('Product_Description', sql.NVarChar(200), adjustment.Product_Description)
            .input('SUNDAY', sql.Int, adjustment.SUNDAY || 0)
            .input('MONDAY', sql.Int, adjustment.MONDAY || 0)
            .input('TUESDAY', sql.Int, adjustment.TUESDAY || 0)
            .input('WEDNESDAY', sql.Int, adjustment.WEDNESDAY || 0)
            .input('THURSDAY', sql.Int, adjustment.THURSDAY || 0)
            .input('FRIDAY', sql.Int, adjustment.FRIDAY || 0)
            .input('SATURDAY', sql.Int, adjustment.SATURDAY || 0)
      .input('Week_Total', sql.Int, adjustment.Week_Total || 0);
    
    const query = `
      INSERT INTO [dbo].[Store_Product_Adjustments] (
        Store_ID, Store_Name, Product_ID, Product_Description,
                 SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
        Week_Total, Created_At, Updated_At
      )
      VALUES (
        @Store_ID, @Store_Name, @Product_ID, @Product_Description,
                 @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
        @Week_Total, GETDATE(), GETDATE()
      );
      
      SELECT SCOPE_IDENTITY() as Adjustment_ID;
    `;
    
    const result = await request.query(query);
    const adjustmentId = result.recordset[0].Adjustment_ID;
    
    logger.info(`Adjustment created with ID: ${adjustmentId}`);
    res.status(201).json({ adjustmentId });
    } catch (err) {
    logger.error('Error creating adjustment:', err);
    res.status(500).json({ 
      error: 'Error creating adjustment',
      details: err.message
    });
  }
});

// Region Uplift endpoints
app.get('/api/region-uplift', async (req, res) => {
  logger.debug('Received request for /api/region-uplift');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
        const result = await pool.request()
            .query(`
        SELECT [Region], [Percentage] 
        FROM [dbo].[Region_Percentage_Uplift]
        ORDER BY [Region];
      `);
    
        res.json(result.recordset);
    } catch (err) {
    logger.error('Error fetching region uplift data:', err);
    res.status(500).json({ 
      error: 'Error fetching region uplift data',
      details: err.message
    });
    }
});

app.post('/api/region-uplift', async (req, res) => {
  logger.debug('Received request to update region uplift data');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
    try {
        const regions = req.body;
    if (!Array.isArray(regions)) {
      return res.status(400).json({ error: 'Invalid request body. Expected an array of regions.' });
    }

    // Begin transaction
    const transaction = new sql.Transaction(pool);
        await transaction.begin();

    try {
      // Clear existing data
      await transaction.request().query('DELETE FROM [dbo].[Region_Percentage_Uplift]');

      // Insert new data
        for (const region of regions) {
        if (!region.Region || typeof region.Percentage !== 'number') {
          throw new Error('Invalid region data format');
        }

            // Keep the decimal precision as is
            await transaction.request()
          .input('Region', sql.NVarChar(100), region.Region)
          .input('Percentage', sql.Decimal(5, 2), region.Percentage)
                .query(`
                        INSERT INTO [dbo].[Region_Percentage_Uplift] ([Region], [Percentage])
            VALUES (@Region, @Percentage);
                `);
        }

      // Commit transaction
        await transaction.commit();
      res.json({ message: 'Region uplift data updated successfully' });
    } catch (err) {
      // Rollback transaction on error
        await transaction.rollback();
      throw err;
    }
  } catch (err) {
    logger.error('Error updating region uplift data:', err);
    res.status(500).json({ 
      error: 'Error updating region uplift data',
      details: err.message
    });
  }
});

// Adjustment Profiles endpoints
app.get('/api/adjustment-profiles', async (req, res) => {
  logger.debug('Received request for /api/adjustment-profiles');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Get all profile selections
    const selectionsResult = await pool.request()
            .query(`
        SELECT 
          s.Store_ID,
          s.Store_Name,
          s.SUNDAY,
          s.MONDAY,
          s.TUESDAY,
          s.WEDNESDAY,
          s.THURSDAY,
          s.FRIDAY,
          s.SATURDAY
        FROM Stores_Master s
        ORDER BY s.Store_Name;
      `);
    
    // Get available profile names
    const profilesResult = await pool.request()
      .query(`
        SELECT DISTINCT Profile_Name 
        FROM Adjustment_Profiles
        ORDER BY Profile_Name;
      `);
    
    const profileNames = profilesResult.recordset.map(r => r.Profile_Name);
    
    res.json({
      selections: selectionsResult.recordset,
      profileNames: profileNames
    });
    } catch (err) {
    logger.error('Error fetching adjustment profiles data:', err);
    res.status(500).json({ 
      error: 'Error fetching adjustment profiles data',
      details: err.message
    });
  }
});

app.post('/api/adjustment-profiles/update', async (req, res) => {
  logger.debug('Received request to update adjustment profile');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const { Store_ID, DayOfWeek, NewProfileName } = req.body;
    
    if (!Store_ID || !DayOfWeek) {
      return res.status(400).json({ error: 'Store ID and Day of Week are required' });
    }
    
    // Validate the day of week
    const validDays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    if (!validDays.includes(DayOfWeek)) {
      return res.status(400).json({ error: 'Invalid day of week' });
    }
    
    // Update the store's profile for the specified day
        const result = await pool.request()
      .input('Store_ID', sql.VarChar(50), Store_ID)
      .input('DayOfWeek', sql.VarChar(20), DayOfWeek)
      .input('ProfileName', sql.NVarChar(100), NewProfileName || null)
            .query(`
        UPDATE Stores_Master
        SET ${DayOfWeek} = @ProfileName
        WHERE Store_ID = @Store_ID;
        
        SELECT @@ROWCOUNT as UpdatedRows;
      `);
    
    const updatedRows = result.recordset[0].UpdatedRows;
    
    if (updatedRows === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    res.json({ 
      success: true,
      message: `Successfully updated ${DayOfWeek} profile for store ${Store_ID}`
    });
  } catch (err) {
    logger.error('Error updating adjustment profile:', err);
        res.status(500).json({ 
      error: 'Error updating adjustment profile',
      details: err.message
        });
    }
});

// Final Forecast endpoint
app.get('/api/final-forecast', async (req, res) => {
  logger.debug('Received request for /api/final-forecast');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Get the final forecast data
    const result = await pool.request()
            .query(`
        SELECT 
          [Store_ID]
          ,[Store_Name]
          ,[Region]
          ,[Product_ID]
          ,[Product_Description]
          ,[SUNDAY]
          ,[MONDAY]
          ,[TUESDAY]
          ,[WEDNESDAY]
          ,[THURSDAY]
          ,[FRIDAY]
          ,[SATURDAY]
          ,[WEEK TOTAL]
          ,[Date Created]
        FROM [dbo].[FinalForecastByDay]
        ORDER BY [Date Created] DESC, [Store_Name], [Product_Description];
      `);
    
    // Get unique regions for filtering
    const regionsResult = await pool.request()
            .query(`
        SELECT DISTINCT Region 
        FROM [dbo].[FinalForecastByDay]
        WHERE Region IS NOT NULL 
        ORDER BY Region;
      `);
    
    const regions = regionsResult.recordset.map(r => r.Region);

        res.json({
      forecasts: result.recordset,
      regions: regions,
      lastUpdated: new Date().toISOString()
        });
    } catch (err) {
    logger.error('Error fetching final forecast data:', err);
    res.status(500).json({ 
      error: 'Error fetching final forecast data',
      details: err.message
    });
  }
});

// Final Deliveries endpoint
app.get('/api/final-deliveries', async (req, res) => {
  logger.debug('Received request for /api/final-deliveries');
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
    }

    try {
    // Get the final delivery data
    const result = await pool.request()
      .query(`
        SELECT 
          [Store_ID]
          ,[Store_Name]
          ,[Region]
          ,[Product_ID]
          ,[Product_Description]
          ,[SUNDAY]
          ,[MONDAY]
          ,[TUESDAY]
          ,[WEDNESDAY]
          ,[THURSDAY]
          ,[FRIDAY]
          ,[SATURDAY]
          ,[WEEK TOTAL]
          ,[Date Created]
        FROM [dbo].[FinalDeliveries]
        ORDER BY [Date Created] DESC, [Store_Name], [Product_Description];
      `);
    
    // Get unique regions for filtering
    const regionsResult = await pool.request()
      .query(`
        SELECT DISTINCT Region 
        FROM [dbo].[FinalDeliveries]
        WHERE Region IS NOT NULL 
        ORDER BY Region;
      `);
    
    const regions = regionsResult.recordset.map(r => r.Region);
    
    res.json({
      deliveries: result.recordset,
      regions: regions,
      lastUpdated: new Date().toISOString()
    });
    } catch (err) {
    logger.error('Error fetching final deliveries data:', err);
    res.status(500).json({ 
      error: 'Error fetching final deliveries data',
      details: err.message
    });
  }
});

// Test database connection status
app.get('/api/test-db-connection', async (req, res) => {
  logger.info('Testing database connection status');
  
  try {
    // Test 1: Check if pool is connected
    if (!poolConnected) {
      return res.status(503).json({
        status: 'error',
        error: 'Database not connected',
        message: 'The database connection is not available'
      });
    }
    
    // Test 2: Try a simple query
    const result = await pool.request()
      .query('SELECT @@version as version');
    
    // Test 3: Check permissions on Stores_Master table
    const permissionCheck = await pool.request()
      .query(`
        SELECT HAS_PERMS_BY_NAME('Stores_Master', 'OBJECT', 'SELECT') as can_select,
               HAS_PERMS_BY_NAME('Stores_Master', 'OBJECT', 'UPDATE') as can_update,
               HAS_PERMS_BY_NAME('Stores_Master', 'OBJECT', 'INSERT') as can_insert,
               HAS_PERMS_BY_NAME('Stores_Master', 'OBJECT', 'DELETE') as can_delete
      `);
    
    res.json({
      status: 'success',
      connected: true,
      sqlVersion: result.recordset[0].version,
      permissions: permissionCheck.recordset[0],
      poolInfo: {
        max: pool.pool.max,
        min: pool.pool.min,
        size: pool.pool.size,
        available: pool.pool.available,
        pending: pool.pool.pending
      }
    });
    
  } catch (err) {
    logger.error('Database connection test error:', err);
    res.status(500).json({
      status: 'error',
      error: err.message,
      code: err.number,
      state: err.state
    });
  }
});

// Serve static files with cache busting
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Serve images directory
app.use('/images', express.static(path.join(__dirname, 'images')));

// Serve logo at both /logo and /images/logo.jpg paths
app.get('/logo', (req, res) => {
  const logoPath = path.join(__dirname, 'images', 'logo.jpg');
  if (fs.existsSync(logoPath)) {
    res.sendFile(logoPath);
  } else {
    // If logo doesn't exist, serve a default image or return 404
    res.status(404).send('Logo not found');
  }
});

// Manual adjustments endpoints
app.get('/api/manual-adjustments', async (req, res) => {
    try {
        const result = await pool.request()
            .query(`
                SELECT 
                    ma.Store_ID,
                    ma.Product_ID,
                    ma.Store_Name,
                    ma.Product_Name,
                    ma.SUNDAY,
                    ma.MONDAY,
                    ma.TUESDAY,
                    ma.WEDNESDAY,
                    ma.THURSDAY,
                    ma.FRIDAY,
                    ma.SATURDAY,
                    ma.[WEEK TOTAL],
                    ma.[Date Created]
                FROM Manual_Adjustments ma
                WHERE ma.SUNDAY <> 0 
                   OR ma.MONDAY <> 0 
                   OR ma.TUESDAY <> 0 
                   OR ma.WEDNESDAY <> 0 
                   OR ma.THURSDAY <> 0 
                   OR ma.FRIDAY <> 0 
                   OR ma.SATURDAY <> 0
                ORDER BY ma.Store_Name, ma.Product_Name;
            `);

        const adjustments = result.recordset.map(row => ({
            Store_ID: row.Store_ID,
            Product_ID: row.Product_ID,
            Store_Name: row.Store_Name,
            Product_Name: row.Product_Name,
            SUNDAY: row.SUNDAY,
            MONDAY: row.MONDAY,
            TUESDAY: row.TUESDAY,
            WEDNESDAY: row.WEDNESDAY,
            THURSDAY: row.THURSDAY,
            FRIDAY: row.FRIDAY,
            SATURDAY: row.SATURDAY,
            WEEK_TOTAL: row['WEEK TOTAL'],
            Date_Created: row['Date Created']
        }));

        res.json(adjustments);
    } catch (error) {
        console.error('Error fetching manual adjustments:', error);
        res.status(500).json({ 
            error: 'Error fetching manual adjustments',
            details: error.message
        });
    }
});

// Update a single manual adjustment
app.put('/api/manual-adjustments/:storeId/:productId', async (req, res) => {
    const { storeId, productId } = req.params;
    const updates = req.body;

    if (!poolConnected) {
        return res.status(503).json({
            error: 'Database not connected',
            message: 'The database connection is not available'
        });
    }

    try {
        const request = pool.request()
            .input('Store_ID', sql.VarChar(50), storeId)
            .input('Product_ID', sql.VarChar(50), productId)
            .input('SUNDAY', sql.Int, updates.SUNDAY || 0)
            .input('MONDAY', sql.Int, updates.MONDAY || 0)
            .input('TUESDAY', sql.Int, updates.TUESDAY || 0)
            .input('WEDNESDAY', sql.Int, updates.WEDNESDAY || 0)
            .input('THURSDAY', sql.Int, updates.THURSDAY || 0)
            .input('FRIDAY', sql.Int, updates.FRIDAY || 0)
            .input('SATURDAY', sql.Int, updates.SATURDAY || 0);

        const query = `
            MERGE INTO Manual_Adjustments AS target
            USING (VALUES (@Store_ID, @Product_ID)) AS source (Store_ID, Product_ID)
            ON target.Store_ID = source.Store_ID AND target.Product_ID = source.Product_ID
            WHEN MATCHED THEN
                UPDATE SET 
                    SUNDAY = @SUNDAY,
                    MONDAY = @MONDAY,
                    TUESDAY = @TUESDAY,
                    WEDNESDAY = @WEDNESDAY,
                    THURSDAY = @THURSDAY,
                    FRIDAY = @FRIDAY,
                    SATURDAY = @SATURDAY,
                    Updated_At = GETDATE()
            WHEN NOT MATCHED THEN
                INSERT (Store_ID, Product_ID, SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, Created_At, Updated_At)
                VALUES (@Store_ID, @Product_ID, @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY, GETDATE(), GETDATE());
        `;

        await request.query(query);
        res.json({ message: 'Adjustment updated successfully' });
    } catch (error) {
        console.error('Error updating manual adjustment:', error);
        res.status(500).json({ 
            error: 'Error updating manual adjustment',
            details: error.message
        });
    }
});

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