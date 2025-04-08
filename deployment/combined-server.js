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
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const result = await pool.request()
      .query(`
        WITH DateInfo AS (
          SELECT 
            GETDATE() as CurrentDate,
            DATEADD(day, 
              -(DATEPART(weekday, GETDATE()) + (CASE WHEN DATEPART(weekday, GETDATE()) = 7 THEN 7 ELSE 0 END)), 
              CAST(GETDATE() AS DATE)
            ) as LastSaturday,
            DATEADD(day, -6,
              DATEADD(day, 
                -(DATEPART(weekday, GETDATE()) + (CASE WHEN DATEPART(weekday, GETDATE()) = 7 THEN 7 ELSE 0 END)), 
                CAST(GETDATE() AS DATE)
              )
            ) as LastWeekSunday
        ),
        WeekRanges AS (
          SELECT
            LastSaturday,
            LastWeekSunday,
            DATEADD(day, -7, LastWeekSunday) as PreviousWeekSunday,
            DATEADD(day, -14, LastWeekSunday) as TwoWeeksAgoSunday,
            DATEADD(day, -7, LastSaturday) as PreviousWeekSaturday,
            DATEADD(day, -14, LastSaturday) as TwoWeeksAgoSaturday
          FROM DateInfo
        ),
        WeeklySales AS (
          SELECT 
            DATEADD(day, 
              -(DATEPART(weekday, Transaction_Date) - 1), 
              CAST(Transaction_Date AS DATE)
            ) AS Week_Start,
            DATEADD(day, 
              7-(DATEPART(weekday, Transaction_Date)), 
              CAST(Transaction_Date AS DATE)
            ) AS Week_End,
            CONVERT(varchar, DATEADD(day, 
              -(DATEPART(weekday, Transaction_Date) - 1), 
              CAST(Transaction_Date AS DATE)
            ), 23) + ' - ' + 
            CONVERT(varchar, DATEADD(day, 
              7-(DATEPART(weekday, Transaction_Date)), 
              CAST(Transaction_Date AS DATE)
            ), 23) AS Week_Label,
            Location AS Region,
            Description AS Product_Description,
            DATEPART(weekday, Transaction_Date) AS DayOfWeek,
            SUM(Quantity) AS Daily_Quantity,
            Transaction_Date
          FROM dbo.Combined_Sales_Data_Final WITH (NOLOCK)
          WHERE Location IS NOT NULL
            AND Transaction_Date >= DATEADD(day, -21, GETDATE())
          GROUP BY 
            Transaction_Date,
            DATEADD(day, -(DATEPART(weekday, Transaction_Date) - 1), CAST(Transaction_Date AS DATE)),
            DATEADD(day, 7-(DATEPART(weekday, Transaction_Date)), CAST(Transaction_Date AS DATE)),
            Location,
            Description,
            DATEPART(weekday, Transaction_Date)
        )
        SELECT 
          Week_Label,
          Region,
          Product_Description,
          SUM(CASE WHEN DayOfWeek = 1 THEN Daily_Quantity ELSE 0 END) AS Sunday,
          SUM(CASE WHEN DayOfWeek = 2 THEN Daily_Quantity ELSE 0 END) AS Monday,
          SUM(CASE WHEN DayOfWeek = 3 THEN Daily_Quantity ELSE 0 END) AS Tuesday,
          SUM(CASE WHEN DayOfWeek = 4 THEN Daily_Quantity ELSE 0 END) AS Wednesday,
          SUM(CASE WHEN DayOfWeek = 5 THEN Daily_Quantity ELSE 0 END) AS Thursday,
          SUM(CASE WHEN DayOfWeek = 6 THEN Daily_Quantity ELSE 0 END) AS Friday,
          SUM(CASE WHEN DayOfWeek = 7 THEN Daily_Quantity ELSE 0 END) AS Saturday,
          SUM(Daily_Quantity) AS Total_Week_Quantity
        FROM WeeklySales ws
        CROSS JOIN WeekRanges wr
        WHERE Transaction_Date <= wr.LastSaturday
          AND Transaction_Date >= wr.TwoWeeksAgoSunday
        GROUP BY Week_Label, Region, Product_Description, Week_Start, Week_End
        ORDER BY Week_End DESC, Region, Product_Description;
      `);
    
    logger.debug(`Regional performance query returned ${result.recordset.length} rows`);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        message: 'No regional performance data found'
      });
    }
    
    res.json(result.recordset);
  } catch (err) {
    logger.error('Error fetching regional performance data:', err);
    res.status(500).json({ 
      error: 'Error fetching regional performance data',
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
    const result = await pool.request()
      .query(`
        SELECT * FROM Stores_Master
        ORDER BY Store_Name;
      `);
    
    res.json(result.recordset);
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
  
  // Validate field lengths
  if (store.Store_Name && store.Store_Name.length > 255) {
    return res.status(400).json({ error: 'Store Name exceeds maximum length of 255 characters' });
  }
  if (store.Region && store.Region.length > 255) {
    return res.status(400).json({ error: 'Region exceeds maximum length of 255 characters' });
  }
  
  try {
    // Get next store ID
    const idResult = await pool.request()
      .query(`SELECT MAX(CAST(Store_ID AS INT)) + 1 AS NextID FROM Stores_Master;`);
    const storeId = (idResult.recordset[0].NextID || 1).toString();
    
    // Insert the new store
    const request = pool.request()
      .input('Store_ID', sql.NVarChar(50), storeId)
      .input('Store_Name', sql.NVarChar(255), store.Store_Name)
      .input('Region', sql.NVarChar(255), store.Region)
      .input('State', sql.NVarChar(50), store.State || null)
      .input('Active', sql.NVarChar(50), store.Active || 'Active')
      .input('Address', sql.NVarChar(255), store.Address || null)
      .input('Supplier_Code', sql.NVarChar(50), store.Supplier_Code || null)
      .input('Run_ID', sql.NVarChar(255), store.Run_ID || null)
      .input('Shelf_Limit', sql.NVarChar(255), store.Shelf_Limit || null)
      .input('Latitude', sql.NVarChar(255), store.Latitude || null)
      .input('Longitude', sql.NVarChar(255), store.Longitude || null)
      .input('INVOICED', sql.NVarChar(50), store.INVOICED || null)
      .input('XERO_CODE', sql.NVarChar(50), store.XERO_CODE || null)
      .input('XERO_CUSTOMERID', sql.NVarChar(50), store.XERO_CUSTOMERID || null);
    
    // Add boolean fields as nvarchar(50)
    ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
     'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY'].forEach(day => {
      request.input(day, sql.NVarChar(50), store[day] === 'TRUE' ? 'TRUE' : 'FALSE');
    });
    
    // Add override fields
    ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'].forEach(day => {
      request.input(`${day}_OVERRIDE`, sql.NVarChar(50), store[`${day}_OVERRIDE`] || null);
    });
    
    const query = `
      INSERT INTO Stores_Master (
        Store_ID, Store_Name, Region, State, Active, Address, Supplier_Code,
        Run_ID, Shelf_Limit, Latitude, Longitude,
        SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
        SPECIAL_FRIDAY, SPECIAL_SUNDAY,
        INVOICED, XERO_CODE, XERO_CUSTOMERID,
        SUN_OVERRIDE, MON_OVERRIDE, TUE_OVERRIDE, WED_OVERRIDE,
        THU_OVERRIDE, FRI_OVERRIDE, SAT_OVERRIDE
      )
      VALUES (
        @Store_ID, @Store_Name, @Region, @State, @Active, @Address, @Supplier_Code,
        @Run_ID, @Shelf_Limit, @Latitude, @Longitude,
        @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
        @SPECIAL_FRIDAY, @SPECIAL_SUNDAY,
        @INVOICED, @XERO_CODE, @XERO_CUSTOMERID,
        @SUN_OVERRIDE, @MON_OVERRIDE, @TUE_OVERRIDE, @WED_OVERRIDE,
        @THU_OVERRIDE, @FRI_OVERRIDE, @SAT_OVERRIDE
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
  logger.debug(`Update payload:`, updates);

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

    const request = pool.request()
      .input('Store_ID', sql.VarChar(50), storeId);

    // Build dynamic update query based on provided fields
    const updateFields = [];
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'Store_ID') continue; // Skip Store_ID as it's the identifier
      // Skip Created_At and Updated_At fields as they don't exist in table
      if (key === 'Created_At' || key === 'Updated_At') continue;

      if (['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY'].includes(key)) {
        // Handle boolean fields
        request.input(key, sql.VarChar(50), value === 'TRUE' ? 'TRUE' : 'FALSE');
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
      SET ${updateFields.join(', ')}
      WHERE Store_ID = @Store_ID;
      
      SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID;
    `;

    logger.debug('Executing query:', query);
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
      details: err.message,
      query: err.procName
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

// Add a diagnostic endpoint for store updates
app.post('/api/stores/:storeId/diagnostic-update', async (req, res) => {
  const storeId = req.params.storeId;
  const updates = req.body;
  logger.info(`=== DIAGNOSTIC UPDATE FOR STORE ${storeId} ===`);
  logger.info(`Update payload: ${JSON.stringify(updates)}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Get DB schema info for Stores_Master
    const schemaResult = await pool.request()
      .query(`
        SELECT 
          COLUMN_NAME, 
          DATA_TYPE, 
          CHARACTER_MAXIMUM_LENGTH
        FROM 
          INFORMATION_SCHEMA.COLUMNS 
        WHERE 
          TABLE_NAME = 'Stores_Master'
        ORDER BY 
          ORDINAL_POSITION
      `);
    
    const schemaInfo = schemaResult.recordset;
    logger.info(`Table schema: ${JSON.stringify(schemaInfo)}`);
    
    // Get current store data
    const storeResult = await pool.request()
      .input('Store_ID', sql.NVarChar(50), storeId)
      .query('SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID');
    
    if (storeResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const store = storeResult.recordset[0];
    logger.info(`Current store data: ${JSON.stringify(store)}`);
    
    // Try updating with provided fields
    const request = pool.request()
      .input('Store_ID', sql.NVarChar(50), storeId);
    
    const updateFields = [];
    const typeMapping = {};
    
    // Build type mapping from schema
    schemaInfo.forEach(col => {
      typeMapping[col.COLUMN_NAME] = {
        type: col.DATA_TYPE,
        length: col.CHARACTER_MAXIMUM_LENGTH
      };
    });
    
    // Process each field with exact schema type matching
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'Store_ID' || !typeMapping[key]) continue;
      
      const fieldInfo = typeMapping[key];
      logger.info(`Processing field ${key} with type ${fieldInfo.type}, length ${fieldInfo.length}`);
      
      let sqlType;
      let processedValue = value;
      
      // Match SQL type exactly based on schema
      switch(fieldInfo.type.toLowerCase()) {
        case 'nvarchar':
        case 'varchar':
          sqlType = fieldInfo.type === 'nvarchar' ? 
                   sql.NVarChar(fieldInfo.length === -1 ? 'max' : fieldInfo.length) : 
                   sql.VarChar(fieldInfo.length === -1 ? 'max' : fieldInfo.length);
          
          // Handle null and string conversion carefully
          if (value === null || value === undefined) {
            processedValue = null;
          } else if (typeof value !== 'string') {
            processedValue = String(value);
          }
          break;
          
        case 'bit':
          sqlType = sql.Bit;
          // Convert boolean-like values to bit
          if (value === null || value === undefined) {
            processedValue = null;
          } else if (typeof value === 'boolean') {
            processedValue = value ? 1 : 0;
          } else if (typeof value === 'string') {
            const normalized = value.toUpperCase().trim();
            processedValue = (normalized === 'TRUE' || normalized === '1' || normalized === 'YES') ? 1 : 0;
          } else {
            processedValue = value ? 1 : 0;
          }
          break;
          
        case 'datetime':
        case 'datetime2':
          sqlType = sql.DateTime2;
          if (value === null || value === undefined) {
            processedValue = null;
          } else if (value instanceof Date) {
            processedValue = value;
          } else if (typeof value === 'string') {
            try {
              processedValue = new Date(value);
            } catch (e) {
              processedValue = null;
            }
          } else {
            processedValue = null;
          }
          break;
          
        default:
          // For other types, use generic conversion
          sqlType = sql.NVarChar(fieldInfo.length === -1 ? 'max' : fieldInfo.length);
          if (value === null || value === undefined) {
            processedValue = null;
          } else if (typeof value !== 'string') {
            processedValue = String(value);
          }
      }
      
      // Add parameter with exact type from schema
      logger.info(`Adding parameter ${key} with value: ${processedValue}, SQL type: ${sqlType.name}`);
      request.input(key, sqlType, processedValue);
      updateFields.push(`${key} = @${key}`);
    }
    
    if (updateFields.length === 0) {
      return res.status(400).json({ 
        success: true,
        message: 'Simple timestamp update successful, but no valid fields in payload to update',
        timestamp: new Date().toISOString()
      });
    }
    
    const updateQuery = `
      UPDATE Stores_Master 
      SET ${updateFields.join(', ')}
      WHERE Store_ID = @Store_ID;
      
      SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID;
    `;
    
    logger.info(`Diagnostic update query: ${updateQuery}`);
    
    const result = await request.query(updateQuery);
    
    res.json({
      success: true,
      message: 'Diagnostic update successful',
      updatedFields: updateFields,
      data: result.recordset[0]
    });
  } catch (err) {
    logger.error(`Error in diagnostic update for store ${storeId}:`, err);
    res.status(500).json({ 
      success: false,
      error: 'Error in diagnostic update',
      details: err.message,
      stack: err.stack
    });
  }
});

// Add a test endpoint for store updates
app.get('/api/stores/:storeId/test-update', async (req, res) => {
  const storeId = req.params.storeId;
  logger.info(`=== TEST UPDATE FOR STORE ${storeId} ===`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Get current store data
    const storeData = await pool.request()
      .input('Store_ID', sql.NVarChar(50), storeId)
      .query('SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID');
    
    if (storeData.recordset.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }
    
    const store = storeData.recordset[0];
    
    // Try a simple update with just one field
    try {
      const result = await pool.request()
        .input('Store_ID', sql.NVarChar(50), storeId)
        .input('Address', sql.NVarChar(255), store.Address || 'Test Address ' + Date.now())
        .query(`
          UPDATE Stores_Master 
          SET Address = @Address
          WHERE Store_ID = @Store_ID;
          
          SELECT * FROM Stores_Master WHERE Store_ID = @Store_ID;
        `);
      
      logger.info(`Test update successful for store ${storeId}`);
      res.json({
        success: true,
        message: 'Test update successful',
        store: result.recordset[0]
      });
    } catch (sqlErr) {
      logger.error(`=== TEST UPDATE SQL ERROR ===`);
      logger.error(`Message: ${sqlErr.message}`);
      logger.error(`Number: ${sqlErr.number}, State: ${sqlErr.state}`);
      return res.status(500).json({ 
        error: 'Test update failed',
        message: sqlErr.message,
        errorNumber: sqlErr.number
      });
    }
  } catch (err) {
    logger.error(`Error in test update for store ${storeId}:`, err);
    res.status(500).json({ 
      error: 'Error in test update',
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

// Verify Stores_Master schema
app.get('/api/verify-schema', async (req, res) => {
  logger.info('Verifying Stores_Master schema');
  
  try {
    // Get schema info
    const schemaResult = await pool.request()
      .query(`
        SELECT 
          COLUMN_NAME,
          DATA_TYPE,
          CHARACTER_MAXIMUM_LENGTH,
          IS_NULLABLE
        FROM 
          INFORMATION_SCHEMA.COLUMNS 
        WHERE 
          TABLE_NAME = 'Stores_Master'
        ORDER BY 
          ORDINAL_POSITION;
      `);
    
    // Expected columns from the actual database schema
    const expectedColumns = [
      'Store_ID', 'Store_Name', 'Region', 'State', 'Active',
      'Run_ID', 'Shelf_Limit', 'Latitude', 'Longitude',
      'Address', 'Supplier_Code',
      'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY',
      'INVOICED', 'XERO_CODE', 'XERO_CUSTOMERID',
      'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY',
      'SUN_OVERRIDE', 'MON_OVERRIDE', 'TUE_OVERRIDE', 'WED_OVERRIDE',
      'THU_OVERRIDE', 'FRI_OVERRIDE', 'SAT_OVERRIDE'
    ];

    // Check which expected columns exist and which are missing
    const existingColumns = schemaResult.recordset.map(col => col.COLUMN_NAME);
    const missingColumns = expectedColumns.filter(col => !existingColumns.includes(col));
    const extraColumns = existingColumns.filter(col => !expectedColumns.includes(col));

    res.json({
      status: 'success',
      schemaDetails: schemaResult.recordset,
      analysis: {
        expectedColumns,
        existingColumns,
        missingColumns,
        extraColumns,
        allColumnsPresent: missingColumns.length === 0
      }
    });
    
  } catch (err) {
    logger.error('Schema verification error:', err);
    res.status(500).json({
      status: 'error',
      error: err.message,
      code: err.number,
      state: err.state
    });
  }
});

// Adjustments endpoints
// Get all adjustments
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
    
    res.json(result.recordset);
  } catch (err) {
    logger.error('Error fetching adjustments data:', err);
    res.status(500).json({ 
      error: 'Error fetching adjustments data',
      details: err.message
    });
  }
});

// Get adjustment by ID
app.get('/api/adjustments/:adjustmentId', async (req, res) => {
  const adjustmentId = req.params.adjustmentId;
  logger.debug(`Received request for adjustment ID: ${adjustmentId}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const result = await pool.request()
      .input('Adjustment_ID', sql.Int, adjustmentId)
      .query(`
        SELECT * FROM Store_Product_Adjustments
        WHERE Adjustment_ID = @Adjustment_ID;
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Adjustment not found' });
    }
    
    res.json(result.recordset[0]);
  } catch (err) {
    logger.error(`Error fetching adjustment ${adjustmentId}:`, err);
    res.status(500).json({ 
      error: 'Error fetching adjustment data',
      details: err.message
    });
  }
});

// Create a new adjustment
app.post('/api/adjustments', async (req, res) => {
  logger.debug('Received request to create a new adjustment');
  const adjustment = req.body;
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    const request = pool.request()
      .input('Store_ID', sql.VarChar(50), adjustment.Store_ID)
      .input('Store_Name', sql.NVarChar(255), adjustment.Store_Name)
      .input('Product_ID', sql.VarChar(50), adjustment.Product_ID)
      .input('Product_Description', sql.NVarChar(255), adjustment.Product_Description)
      .input('SUNDAY', sql.Int, adjustment.SUNDAY || 0)
      .input('MONDAY', sql.Int, adjustment.MONDAY || 0)
      .input('TUESDAY', sql.Int, adjustment.TUESDAY || 0)
      .input('WEDNESDAY', sql.Int, adjustment.WEDNESDAY || 0)
      .input('THURSDAY', sql.Int, adjustment.THURSDAY || 0)
      .input('FRIDAY', sql.Int, adjustment.FRIDAY || 0)
      .input('SATURDAY', sql.Int, adjustment.SATURDAY || 0)
      .input('Week_Total', sql.Int, adjustment.Week_Total || 0);
    
    const query = `
      INSERT INTO Store_Product_Adjustments (
        Store_ID, Store_Name, Product_ID, Product_Description,
        SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
        Week_Total, Created_At, Updated_At
      )
      VALUES (
        @Store_ID, @Store_Name, @Product_ID, @Product_Description,
        @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
        @Week_Total, GETDATE(), GETDATE()
      );
      
      SELECT SCOPE_IDENTITY() AS Adjustment_ID;
    `;
    
    const result = await request.query(query);
    const adjustmentId = result.recordset[0].Adjustment_ID;
    
    // Fetch and return the created adjustment
    const newAdjustment = await pool.request()
      .input('Adjustment_ID', sql.Int, adjustmentId)
      .query('SELECT * FROM Store_Product_Adjustments WHERE Adjustment_ID = @Adjustment_ID');
    
    logger.info(`Adjustment created with ID: ${adjustmentId}`);
    res.status(201).json(newAdjustment.recordset[0]);
  } catch (err) {
    logger.error('Error creating adjustment:', err);
    res.status(500).json({ 
      error: 'Error creating adjustment',
      details: err.message
    });
  }
});

// Update an adjustment
app.put('/api/adjustments/:adjustmentId', async (req, res) => {
  const adjustmentId = req.params.adjustmentId;
  const updates = req.body;
  logger.debug(`Received request to update adjustment ID: ${adjustmentId}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Validate adjustment exists
    const adjustmentCheck = await pool.request()
      .input('Adjustment_ID', sql.Int, adjustmentId)
      .query('SELECT Adjustment_ID FROM Store_Product_Adjustments WHERE Adjustment_ID = @Adjustment_ID');
    
    if (adjustmentCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'Adjustment not found' });
    }
    
    const request = pool.request()
      .input('Adjustment_ID', sql.Int, adjustmentId)
      .input('Store_ID', sql.VarChar(50), updates.Store_ID)
      .input('Store_Name', sql.NVarChar(255), updates.Store_Name)
      .input('Product_ID', sql.VarChar(50), updates.Product_ID)
      .input('Product_Description', sql.NVarChar(255), updates.Product_Description)
      .input('SUNDAY', sql.Int, updates.SUNDAY || 0)
      .input('MONDAY', sql.Int, updates.MONDAY || 0)
      .input('TUESDAY', sql.Int, updates.TUESDAY || 0)
      .input('WEDNESDAY', sql.Int, updates.WEDNESDAY || 0)
      .input('THURSDAY', sql.Int, updates.THURSDAY || 0)
      .input('FRIDAY', sql.Int, updates.FRIDAY || 0)
      .input('SATURDAY', sql.Int, updates.SATURDAY || 0)
      .input('Week_Total', sql.Int, updates.Week_Total || 0);
    
    const query = `
      UPDATE Store_Product_Adjustments 
      SET Store_ID = @Store_ID,
          Store_Name = @Store_Name,
          Product_ID = @Product_ID,
          Product_Description = @Product_Description,
          SUNDAY = @SUNDAY,
          MONDAY = @MONDAY,
          TUESDAY = @TUESDAY,
          WEDNESDAY = @WEDNESDAY,
          THURSDAY = @THURSDAY,
          FRIDAY = @FRIDAY,
          SATURDAY = @SATURDAY,
          Week_Total = @Week_Total
      WHERE Adjustment_ID = @Adjustment_ID;
      
      SELECT * FROM Store_Product_Adjustments WHERE Adjustment_ID = @Adjustment_ID;
    `;
    
    const result = await request.query(query);
    logger.info(`Adjustment ${adjustmentId} updated successfully`);
    
    if (result.recordset.length > 0) {
      res.json(result.recordset[0]);
    } else {
      res.json({ message: 'Adjustment updated successfully' });
    }
  } catch (err) {
    logger.error(`Error updating adjustment ${adjustmentId}:`, err);
    res.status(500).json({ 
      error: 'Error updating adjustment',
      details: err.message
    });
  }
});

// Delete an adjustment
app.delete('/api/adjustments/:adjustmentId', async (req, res) => {
  const adjustmentId = req.params.adjustmentId;
  logger.debug(`Received request to delete adjustment ID: ${adjustmentId}`);
  
  if (!poolConnected) {
    return res.status(503).json({
      error: 'Database not connected',
      message: 'The database connection is not available'
    });
  }
  
  try {
    // Check if the adjustment exists
    const adjustmentCheck = await pool.request()
      .input('Adjustment_ID', sql.Int, adjustmentId)
      .query('SELECT Adjustment_ID FROM Store_Product_Adjustments WHERE Adjustment_ID = @Adjustment_ID');
    
    if (adjustmentCheck.recordset.length === 0) {
      return res.status(404).json({ error: 'Adjustment not found' });
    }
    
    // Delete the adjustment
    await pool.request()
      .input('Adjustment_ID', sql.Int, adjustmentId)
      .query('DELETE FROM Store_Product_Adjustments WHERE Adjustment_ID = @Adjustment_ID');
    
    logger.info(`Adjustment ${adjustmentId} deleted successfully`);
    res.json({ message: 'Adjustment deleted successfully' });
  } catch (err) {
    logger.error(`Error deleting adjustment ${adjustmentId}:`, err);
    res.status(500).json({ 
      error: 'Error deleting adjustment',
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

// Serve logo at both /logo and /images/logo.jpg paths
app.get('/logo', (req, res) => {
  const logoPath = path.join(__dirname, 'images', 'logo.jpg');
  
  try {
    if (fs.existsSync(logoPath)) {
      // Use Sharp library to resize image if available
      try {
        // Check if Sharp is available
        const sharp = require('sharp');
        
        // Set max width to 50 pixels and resize while maintaining aspect ratio
        sharp(logoPath)
          .resize({ width: 50, withoutEnlargement: true })
          .toBuffer()
          .then(data => {
            res.set('Content-Type', 'image/jpeg');
            res.send(data);
          })
          .catch(err => {
            logger.error('Error resizing logo:', err);
            // Fallback to sending original file
            res.sendFile(logoPath);
          });
      } catch (moduleErr) {
        // Sharp not available, use HTML/CSS resize instead by sending the file directly
        res.sendFile(logoPath);
      }
    } else {
      // If logo doesn't exist, serve a default image or return 404
      res.status(404).send('Logo not found');
    }
  } catch (err) {
    logger.error('Error serving logo:', err);
    res.status(500).send('Error serving logo');
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