// Initialize Application Insights
const appInsights = require('applicationinsights');
if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
    appInsights.setup(process.env.APPINSIGHTS_INSTRUMENTATIONKEY)
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .setAutoCollectConsole(true)
        .setUseDiskRetryCaching(true)
        .setSendLiveMetrics(true);
    appInsights.start();
    console.log('Application Insights initialized');
}

// Load dependencies
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const sql = require('mssql');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Add detailed request logging middleware
app.use((req, res, next) => {
    const timestamp = new Date().toISOString();
    console.log('----------------------------------------');
    console.log(`[${timestamp}] Incoming Request:`);
    console.log(`Method: ${req.method}`);
    console.log(`URL: ${req.url}`);
    console.log(`Headers:`, req.headers);
    console.log('----------------------------------------');
    next();
});

// Serve static files with no caching
app.use((req, res, next) => {
    if (req.url.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Serve static files from the current directory
app.use(express.static(path.join(__dirname), {
    etag: false,
    lastModified: false,
    setHeaders: (res, path) => {
        if (path.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        }
    }
}));

// Explicit route for index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Explicit routes for HTML files
app.get('/:page.html', (req, res) => {
    const page = req.params.page;
    const filePath = path.join(__dirname, `${page}.html`);
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error(`Error serving ${page}.html:`, err);
            res.status(404).send('File not found');
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
        appName: process.env.APP_NAME
    });
});

// Database configuration
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true,
        connectTimeout: 60000,  // Increased to 60 seconds
        requestTimeout: 60000   // Increased to 60 seconds
    },
    pool: {
        max: parseInt(process.env.DB_MAX_POOL_SIZE) || 20,
        min: 0,
        idleTimeoutMillis: 60000,  // Increased to 60 seconds
        acquireTimeoutMillis: 60000,  // Added acquire timeout
        createTimeoutMillis: 30000,   // Added create timeout
        destroyTimeoutMillis: 5000,   // Added destroy timeout
        reapIntervalMillis: 1000,     // Added reap interval
        createRetryIntervalMillis: 200 // Added create retry interval
    }
};

// Database connection pool configuration
const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

// Handle pool errors
pool.on('error', err => {
    console.error('SQL Pool Error:', err);
    // Attempt to reconnect
    setTimeout(async () => {
        try {
            console.log('Attempting to reconnect to database...');
            await pool.close();
            await pool.connect();
            console.log('Successfully reconnected to database');
        } catch (reconnectErr) {
            console.error('Failed to reconnect to database:', reconnectErr);
        }
    }, 5000);  // Wait 5 seconds before attempting to reconnect
});

// Add connection pool monitoring with enhanced error handling
setInterval(async () => {
    try {
        await pool.request().query('SELECT 1'); // Simplified check
        console.log('Database connection pool is healthy:', {
            pool_size: pool.pool.size,
            available: pool.pool.available,
            pending: pool.pool.pending,
            borrowed: pool.pool.borrowed
        });
    } catch (err) {
        console.error('Database connection pool health check failed:', err);
        // Log details, but remove reconnection logic from here
        console.error('Error details:', {
            code: err.code,
            number: err.number,
            state: err.state,
            class: err.class,
            lineNumber: err.lineNumber,
            serverName: err.serverName,
            procName: err.procName
        });
        // // Try to reconnect  <-- REMOVED
        // try {            <-- REMOVED
        //     await pool.close(); <-- REMOVED
        //     await pool.connect(); <-- REMOVED
        //     console.log('Successfully reconnected to database'); <-- REMOVED
        // } catch (reconnectErr) { <-- REMOVED
        //     console.error('Failed to reconnect to database:', reconnectErr); <-- REMOVED
        // } <-- REMOVED
    }
}, 30000);  // Check every 30 seconds

// Middleware to ensure database connection with timeout
app.use(async (req, res, next) => {
    try {
        // Wait for pool connection with timeout
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Database connection timeout')), 30000);
        });
        await Promise.race([poolConnect, timeoutPromise]);
        next();
    } catch (err) {
        console.error('Database connection error in middleware:', err);
        res.status(503).json({ 
            error: 'Database connection error',
            message: 'The service is temporarily unavailable. Please try again later.'
        });
    }
});

// Start server only after database connection is established
async function startServer() {
    try {
        const dbConnected = await initializeDatabase();
        if (!dbConnected) {
            console.error('Could not start server due to database connection failure');
            process.exit(1);
        }

        const PORT = process.env.PORT || process.env.WEBSITES_PORT || 8080;
        
        app.listen(PORT, () => {
            console.log(`Server running on port ${PORT}`);
            if (appInsights.defaultClient) {
                appInsights.defaultClient.trackEvent({ name: 'serverStart', properties: { port: PORT } });
            }
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        if (appInsights.defaultClient) {
            appInsights.defaultClient.trackException({ exception: err });
        }
        process.exit(1);
    }
}

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    if (appInsights.defaultClient) {
        appInsights.defaultClient.trackException({ exception: err });
    }
    res.status(500).json({ error: 'Internal Server Error' });
});

// Add favicon handler to prevent 404s
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Start the server
startServer().catch(err => {
    console.error('Failed to start application:', err);
    if (appInsights.defaultClient) {
        appInsights.defaultClient.trackException({ exception: err });
    }
    process.exit(1);
});

// Global error handlers
// Trigger deployment sync
// Another sync trigger
// Sync trigger 3
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  if (appInsights.defaultClient) {
      appInsights.defaultClient.trackException({ 
          exception: reason instanceof Error ? reason : new Error(JSON.stringify(reason))
      });
  }
  // Optional: exit process, but consider if App Service handles restarts better
  // process.exit(1); 
});

process.on('uncaughtException', (err, origin) => {
  console.error(`Caught exception: ${err}\n` + `Exception origin: ${origin}`);
  if (appInsights.defaultClient) {
      appInsights.defaultClient.trackException({ exception: err });
  }
  // Optional: exit process
  // process.exit(1);
});

// API endpoints
app.get('/api/stores', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT * FROM Stores_Master ORDER BY Store_Name');
        const regions = await pool.request().query('SELECT DISTINCT Region FROM Stores_Master WHERE Region IS NOT NULL ORDER BY Region');
        const lastRun = await pool.request().query('SELECT MAX(Run_ID) as lastRunId FROM Stores_Master');

        res.json({
            stores: result.recordset,
            regions: regions.recordset.map(r => r.Region),
            lastRunDate: lastRun.recordset[0].lastRunId
        });
    } catch (err) {
        console.error('Error fetching stores:', err);
        res.status(500).json({ error: 'Error fetching stores' });
    }
});

// Update store endpoint (PUT)
app.put('/api/stores/:storeId', async (req, res) => {
    const storeId = req.params.storeId;
    const updates = req.body;
    try {
        const request = pool.request()
            .input('Store_ID', sql.VarChar(50), storeId);

        // Build dynamic update query based on provided fields
        const updateFields = [];
        for (const [key, value] of Object.entries(updates)) {
            if (key.endsWith('_OVERRIDE')) {
                // Handle override fields
                request.input(key, sql.VarChar(100), value);
                updateFields.push(`${key} = @${key}`);
            } else if (['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SPECIAL_FRIDAY', 'SPECIAL_SUNDAY'].includes(key)) {
                // Handle boolean fields
                request.input(key, sql.Bit, value === 'TRUE' ? 1 : 0);
                updateFields.push(`${key} = @${key}`);
            } else {
                // Handle other fields
                request.input(key, sql.VarChar(500), value);
                updateFields.push(`${key} = @${key}`);
            }
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const query = `
            UPDATE Stores_Master 
            SET ${updateFields.join(', ')}
            WHERE Store_ID = @Store_ID
        `;

        await request.query(query);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating store:', err);
        res.status(500).json({ error: 'Error updating store' });
    }
});

// Add new store endpoint
app.post('/api/stores/add', async (req, res) => {
    const store = req.body;
    try {
        await pool.request()
            .input('Store_ID', sql.VarChar(50), store.Store_ID)
            .input('Store_Name', sql.VarChar(255), store.Store_Name)
            .input('Address', sql.VarChar(500), store.Address)
            .input('Region', sql.VarChar(100), store.Region)
            .input('State', sql.VarChar(50), store.State)
            .input('SUNDAY', sql.Bit, store.SUNDAY === 'TRUE' ? 1 : 0)
            .input('MONDAY', sql.Bit, store.MONDAY === 'TRUE' ? 1 : 0)
            .input('TUESDAY', sql.Bit, store.TUESDAY === 'TRUE' ? 1 : 0)
            .input('WEDNESDAY', sql.Bit, store.WEDNESDAY === 'TRUE' ? 1 : 0)
            .input('THURSDAY', sql.Bit, store.THURSDAY === 'TRUE' ? 1 : 0)
            .input('FRIDAY', sql.Bit, store.FRIDAY === 'TRUE' ? 1 : 0)
            .input('SATURDAY', sql.Bit, store.SATURDAY === 'TRUE' ? 1 : 0)
            .input('SPECIAL_FRIDAY', sql.Bit, store.SPECIAL_FRIDAY === 'TRUE' ? 1 : 0)
            .input('SPECIAL_SUNDAY', sql.Bit, store.SPECIAL_SUNDAY === 'TRUE' ? 1 : 0)
            .query(`
                INSERT INTO Stores_Master (
                    Store_ID, Store_Name, Address, Region, State,
                    SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
                    SPECIAL_FRIDAY, SPECIAL_SUNDAY
                ) VALUES (
                    @Store_ID, @Store_Name, @Address, @Region, @State,
                    @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
                    @SPECIAL_FRIDAY, @SPECIAL_SUNDAY
                )
            `);
        res.json({ success: true });
    } catch (err) {
        console.error('Error adding store:', err);
        res.status(500).json({ error: 'Error adding store' });
    }
});

// Products endpoints
app.get('/api/products', async (req, res) => {
    try {
        const result = await pool.request()
            .query(`
                SELECT [Product_ID]
                    ,[Product_Description]
                    ,[Product_Family]
                    ,[WoolworthsCode]
                    ,[ColesCode]
                    ,[HarrisFarmCode]
                    ,[OtherCode]
                    ,[BakingUOM]
                    ,[BakingQuantity]
                    ,[UnitPerProduct]
                    ,[Wholesale_Cost_AUD]
                    ,[RRP_AUD]
                    ,[Product_Description_Production]
                FROM [dbo].[Products_Master]
                ORDER BY Product_Description
            `);
        
        const families = await pool.request()
            .query('SELECT DISTINCT Product_Family FROM Products_Master WHERE Product_Family IS NOT NULL ORDER BY Product_Family');

        res.json({
            products: result.recordset,
            families: families.recordset.map(f => f.Product_Family)
        });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ error: 'Error fetching products data' });
    }
});

// Update product endpoint
app.post('/api/products/update', async (req, res) => {
    const product = req.body;
    try {
        await pool.request()
            .input('Product_ID', sql.VarChar(50), product.Product_ID)
            .input('Product_Description', sql.VarChar(255), product.Product_Description)
            .input('Product_Family', sql.VarChar(100), product.Product_Family)
            .input('WoolworthsCode', sql.VarChar(50), product.WoolworthsCode)
            .input('ColesCode', sql.VarChar(50), product.ColesCode)
            .input('HarrisFarmCode', sql.VarChar(50), product.HarrisFarmCode)
            .input('OtherCode', sql.VarChar(50), product.OtherCode)
            .input('BakingUOM', sql.VarChar(50), product.BakingUOM)
            .input('BakingQuantity', sql.Decimal(10,2), parseFloat(product.BakingQuantity) || 0)
            .input('UnitPerProduct', sql.Int, parseInt(product.UnitPerProduct) || 0)
            .input('Wholesale_Cost_AUD', sql.Decimal(10,2), parseFloat(product.Wholesale_Cost_AUD) || 0)
            .input('RRP_AUD', sql.Decimal(10,2), parseFloat(product.RRP_AUD) || 0)
            .input('Product_Description_Production', sql.VarChar(255), product.Product_Description_Production)
            .query(`
                UPDATE Products_Master 
                SET Product_Description = @Product_Description,
                    Product_Family = @Product_Family,
                    WoolworthsCode = @WoolworthsCode,
                    ColesCode = @ColesCode,
                    HarrisFarmCode = @HarrisFarmCode,
                    OtherCode = @OtherCode,
                    BakingUOM = @BakingUOM,
                    BakingQuantity = @BakingQuantity,
                    UnitPerProduct = @UnitPerProduct,
                    Wholesale_Cost_AUD = @Wholesale_Cost_AUD,
                    RRP_AUD = @RRP_AUD,
                    Product_Description_Production = @Product_Description_Production
                WHERE Product_ID = @Product_ID
            `);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ error: 'Error updating product' });
    }
});

// Add new product endpoint
app.post('/api/products/add', async (req, res) => {
    const product = req.body;
    try {
        await pool.request()
            .input('Product_ID', sql.VarChar(50), product.Product_ID)
            .input('Product_Description', sql.VarChar(255), product.Product_Description)
            .input('Product_Family', sql.VarChar(100), product.Product_Family)
            .input('WoolworthsCode', sql.VarChar(50), product.WoolworthsCode)
            .input('ColesCode', sql.VarChar(50), product.ColesCode)
            .input('HarrisFarmCode', sql.VarChar(50), product.HarrisFarmCode)
            .input('OtherCode', sql.VarChar(50), product.OtherCode)
            .input('BakingUOM', sql.VarChar(50), product.BakingUOM)
            .input('BakingQuantity', sql.Decimal(10,2), parseFloat(product.BakingQuantity) || 0)
            .input('UnitPerProduct', sql.Int, parseInt(product.UnitPerProduct) || 0)
            .input('Wholesale_Cost_AUD', sql.Decimal(10,2), parseFloat(product.Wholesale_Cost_AUD) || 0)
            .input('RRP_AUD', sql.Decimal(10,2), parseFloat(product.RRP_AUD) || 0)
            .input('Product_Description_Production', sql.VarChar(255), product.Product_Description_Production)
            .query(`
                INSERT INTO Products_Master (
                    Product_ID, Product_Description, Product_Family,
                    WoolworthsCode, ColesCode, HarrisFarmCode, OtherCode,
                    BakingUOM, BakingQuantity, UnitPerProduct,
                    Wholesale_Cost_AUD, RRP_AUD, Product_Description_Production
                ) VALUES (
                    @Product_ID, @Product_Description, @Product_Family,
                    @WoolworthsCode, @ColesCode, @HarrisFarmCode, @OtherCode,
                    @BakingUOM, @BakingQuantity, @UnitPerProduct,
                    @Wholesale_Cost_AUD, @RRP_AUD, @Product_Description_Production
                )
            `);
        res.json({ success: true });
    } catch (err) {
        console.error('Error adding product:', err);
        res.status(500).json({ error: 'Error adding product' });
    }
});

// Standing Orders endpoints
app.get('/api/standing-orders', async (req, res) => {
    try {
        const result = await pool.request()
            .query(`
                SELECT [Store_ID]
                    ,[Product_ID]
                    ,[Store_Name]
                    ,[Product_Name]
                    ,[SUNDAY]
                    ,[MONDAY]
                    ,[TUESDAY]
                    ,[WEDNESDAY]
                    ,[THURSDAY]
                    ,[FRIDAY]
                    ,[SATURDAY]
                    ,[WEEK TOTAL]
                    ,[Date Created]
                FROM [dbo].[StandingOrders]
                ORDER BY Store_Name, Product_Name
            `);
        
        const stores = await pool.request()
            .query('SELECT DISTINCT Store_ID, Store_Name FROM Stores_Master ORDER BY Store_Name');
        
        const products = await pool.request()
            .query('SELECT DISTINCT Product_ID, Product_Name FROM StandingOrders ORDER BY Product_Name');

        res.json({
            standingOrders: result.recordset,
            stores: stores.recordset,
            products: products.recordset
        });
    } catch (err) {
        console.error('Error fetching standing orders:', err);
        res.status(500).json({ error: 'Error fetching standing orders data' });
    }
});

// Update standing order endpoint
app.post('/api/standing-orders/update', async (req, res) => {
    const order = req.body;
    try {
        await pool.request()
            .input('Store_ID', sql.VarChar(50), order.Store_ID)
            .input('Product_ID', sql.VarChar(50), order.Product_ID)
            .input('Store_Name', sql.VarChar(255), order.Store_Name)
            .input('Product_Name', sql.VarChar(255), order.Product_Name)
            .input('SUNDAY', sql.Int, parseInt(order.SUNDAY) || 0)
            .input('MONDAY', sql.Int, parseInt(order.MONDAY) || 0)
            .input('TUESDAY', sql.Int, parseInt(order.TUESDAY) || 0)
            .input('WEDNESDAY', sql.Int, parseInt(order.WEDNESDAY) || 0)
            .input('THURSDAY', sql.Int, parseInt(order.THURSDAY) || 0)
            .input('FRIDAY', sql.Int, parseInt(order.FRIDAY) || 0)
            .input('SATURDAY', sql.Int, parseInt(order.SATURDAY) || 0)
            .input('WEEK_TOTAL', sql.Int, parseInt(order['WEEK TOTAL']) || 0)
            .query(`
                UPDATE StandingOrders 
                SET Store_Name = @Store_Name,
                    Product_Name = @Product_Name,
                    SUNDAY = @SUNDAY,
                    MONDAY = @MONDAY,
                    TUESDAY = @TUESDAY,
                    WEDNESDAY = @WEDNESDAY,
                    THURSDAY = @THURSDAY,
                    FRIDAY = @FRIDAY,
                    SATURDAY = @SATURDAY,
                    [WEEK TOTAL] = @WEEK_TOTAL
                WHERE Store_ID = @Store_ID AND Product_ID = @Product_ID
            `);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating standing order:', err);
        res.status(500).json({ error: 'Error updating standing order' });
    }
});

// Add new standing order endpoint
app.post('/api/standing-orders/add', async (req, res) => {
    const order = req.body;
    try {
        await pool.request()
            .input('Store_ID', sql.VarChar(50), order.Store_ID)
            .input('Product_ID', sql.VarChar(50), order.Product_ID)
            .input('Store_Name', sql.VarChar(255), order.Store_Name)
            .input('Product_Name', sql.VarChar(255), order.Product_Name)
            .input('SUNDAY', sql.Int, parseInt(order.SUNDAY) || 0)
            .input('MONDAY', sql.Int, parseInt(order.MONDAY) || 0)
            .input('TUESDAY', sql.Int, parseInt(order.TUESDAY) || 0)
            .input('WEDNESDAY', sql.Int, parseInt(order.WEDNESDAY) || 0)
            .input('THURSDAY', sql.Int, parseInt(order.THURSDAY) || 0)
            .input('FRIDAY', sql.Int, parseInt(order.FRIDAY) || 0)
            .input('SATURDAY', sql.Int, parseInt(order.SATURDAY) || 0)
            .input('WEEK_TOTAL', sql.Int, parseInt(order['WEEK TOTAL']) || 0)
            .query(`
                INSERT INTO StandingOrders (
                    Store_ID, Product_ID, Store_Name, Product_Name,
                    SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
                    [WEEK TOTAL]
                ) VALUES (
                    @Store_ID, @Product_ID, @Store_Name, @Product_Name,
                    @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
                    @WEEK_TOTAL
                )
            `);
        res.json({ success: true });
    } catch (err) {
        console.error('Error adding standing order:', err);
        res.status(500).json({ error: 'Error adding standing order' });
    }
});

// Adjustments endpoints
app.get('/api/adjustments', async (req, res) => {
    console.log('Received request for /api/adjustments');
    try {
        console.log('Executing query for adjustments data...');
        const adjustmentsResult = await pool.request()
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
                ORDER BY Store_ID, Product_ID
            `);

        console.log(`Adjustments query returned ${adjustmentsResult.recordset.length} rows`);

        console.log('Executing query for stores data...');
        const storesResult = await pool.request()
            .query('SELECT DISTINCT Store_ID, Store_Name FROM Stores_Master ORDER BY Store_ID');
        console.log(`Stores query returned ${storesResult.recordset.length} rows`);

        console.log('Executing query for products data...');
        const productsResult = await pool.request()
            .query('SELECT DISTINCT Product_ID, Product_Description FROM Products_Master ORDER BY Product_Description');
        console.log(`Products query returned ${productsResult.recordset.length} rows`);

        res.json({
            adjustments: adjustmentsResult.recordset,
            stores: storesResult.recordset,
            products: productsResult.recordset
        });
    } catch (err) {
        console.error('Error fetching adjustments:', err);
        res.status(500).json({ error: 'Error fetching adjustments data' });
    }
});

// Update adjustment endpoint
app.post('/api/adjustments/update', async (req, res) => {
    try {
        const adjustment = req.body;
        
        const weekTotal = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
            .reduce((sum, day) => sum + (parseInt(adjustment[day]) || 0), 0);

        await pool.request()
            .input('Adjustment_ID', sql.Int, adjustment.Adjustment_ID)
            .input('Store_ID', sql.VarChar, adjustment.Store_ID)
            .input('Store_Name', sql.VarChar, adjustment.Store_Name)
            .input('Product_ID', sql.VarChar, adjustment.Product_ID)
            .input('Product_Description', sql.VarChar, adjustment.Product_Description)
            .input('SUNDAY', sql.Int, adjustment.SUNDAY || 0)
            .input('MONDAY', sql.Int, adjustment.MONDAY || 0)
            .input('TUESDAY', sql.Int, adjustment.TUESDAY || 0)
            .input('WEDNESDAY', sql.Int, adjustment.WEDNESDAY || 0)
            .input('THURSDAY', sql.Int, adjustment.THURSDAY || 0)
            .input('FRIDAY', sql.Int, adjustment.FRIDAY || 0)
            .input('SATURDAY', sql.Int, adjustment.SATURDAY || 0)
            .input('Week_Total', sql.Int, weekTotal)
            .query(`
                UPDATE [dbo].[Store_Product_Adjustments]
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
                    Week_Total = @Week_Total,
                    Updated_At = GETDATE()
                WHERE Adjustment_ID = @Adjustment_ID
            `);

        res.json({ message: 'Adjustment updated successfully' });
    } catch (err) {
        console.error('Error updating adjustment:', err);
        res.status(500).json({ error: 'Error updating adjustment' });
    }
});

// Add new adjustment endpoint
app.post('/api/adjustments/add', async (req, res) => {
    try {
        const adjustment = req.body;
        
        const weekTotal = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
            .reduce((sum, day) => sum + (parseInt(adjustment[day]) || 0), 0);

        await pool.request()
            .input('Store_ID', sql.VarChar, adjustment.Store_ID)
            .input('Store_Name', sql.VarChar, adjustment.Store_Name)
            .input('Product_ID', sql.VarChar, adjustment.Product_ID)
            .input('Product_Description', sql.VarChar, adjustment.Product_Description)
            .input('SUNDAY', sql.Int, adjustment.SUNDAY || 0)
            .input('MONDAY', sql.Int, adjustment.MONDAY || 0)
            .input('TUESDAY', sql.Int, adjustment.TUESDAY || 0)
            .input('WEDNESDAY', sql.Int, adjustment.WEDNESDAY || 0)
            .input('THURSDAY', sql.Int, adjustment.THURSDAY || 0)
            .input('FRIDAY', sql.Int, adjustment.FRIDAY || 0)
            .input('SATURDAY', sql.Int, adjustment.SATURDAY || 0)
            .input('Week_Total', sql.Int, weekTotal)
            .query(`
                INSERT INTO [dbo].[Store_Product_Adjustments]
                (Store_ID, Store_Name, Product_ID, Product_Description,
                 SUNDAY, MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY,
                 Week_Total, Created_At, Updated_At)
                VALUES
                (@Store_ID, @Store_Name, @Product_ID, @Product_Description,
                 @SUNDAY, @MONDAY, @TUESDAY, @WEDNESDAY, @THURSDAY, @FRIDAY, @SATURDAY,
                 @Week_Total, GETDATE(), GETDATE())
            `);

        res.json({ message: 'Adjustment added successfully' });
    } catch (err) {
        console.error('Error adding adjustment:', err);
        res.status(500).json({ error: 'Error adding adjustment' });
    }
});

// Final Forecast endpoint
app.get('/api/final-forecast', async (req, res) => {
    console.log('Received request for /api/final-forecast');
    try {
        console.log('Executing query for final forecast data...');
        const result = await pool.request()
            .query(`
                SELECT [Store_ID]
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
                ORDER BY Store_Name, Product_Description
            `);
        
        console.log(`Final forecast query returned ${result.recordset.length} rows`);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching final forecast:', err);
        res.status(500).json({ error: 'Error fetching final forecast data' });
    }
});

// Final Deliveries endpoint
app.get('/api/final-deliveries', async (req, res) => {
    console.log('Received request for /api/final-deliveries');
    try {
        console.log('Executing query for final deliveries data...');
        const result = await pool.request()
            .query(`
                SELECT [Store_ID]
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
                ORDER BY Store_Name, Product_Description
            `);
        
        console.log(`Final deliveries query returned ${result.recordset.length} rows`);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching final deliveries:', err);
        res.status(500).json({ error: 'Error fetching final deliveries data' });
    }
});

// Region Uplift endpoints
app.get('/api/region-uplift', async (req, res) => {
    try {
        const result = await pool.request()
            .query('SELECT [Region], [Percentage] FROM [dbo].[Region_Percentage_Uplift]');
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching region data:', err);
        res.status(500).json({ error: 'Error fetching region data' });
    }
});

app.post('/api/region-uplift', async (req, res) => {
    const transaction = new sql.Transaction(pool);
    try {
        const regions = req.body;
        await transaction.begin();

        for (const region of regions) {
            await transaction.request()
                .input('region', sql.NVarChar, region.Region)
                .input('percentage', sql.Decimal(5,2), region.Percentage)
                .query(`
                    IF EXISTS (SELECT 1 FROM [dbo].[Region_Percentage_Uplift] WHERE [Region] = @region)
                    BEGIN
                        UPDATE [dbo].[Region_Percentage_Uplift]
                        SET [Percentage] = @percentage
                        WHERE [Region] = @region
                    END
                    ELSE
                    BEGIN
                        INSERT INTO [dbo].[Region_Percentage_Uplift] ([Region], [Percentage])
                        VALUES (@region, @percentage)
                    END
                `);
        }

        await transaction.commit();
        res.json({ message: 'Changes saved successfully' });
    } catch (err) {
        await transaction.rollback();
        console.error('Error updating region data:', err);
        res.status(500).json({ error: 'Error updating region data' });
    }
});

// Actual Sales endpoint
app.get('/api/actual-sales', async (req, res) => {
    try {
        const { start, end } = req.query;
        
        if (!start || !end) {
            return res.status(400).json({ error: 'Start and end dates are required' });
        }

        const result = await pool.request()
            .input('startDate', sql.Date, start)
            .input('endDate', sql.Date, end)
            .query(`
                SELECT [Transaction_Date], [Store_ID], [Store_Name], [Location],
                       [Product_ID], [Description], [Quantity], [Dollars_Sold],
                       [Source], [Old_Store_ID], [Old_Product_ID]
                FROM [dbo].[Combined_Sales_Data_Final]
                WHERE Transaction_Date BETWEEN @startDate AND @endDate
                ORDER BY Transaction_Date DESC, Store_Name, Description
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching sales data:', err);
        res.status(500).json({ error: 'Error fetching sales data' });
    }
});

// Regional Performance endpoint
app.get('/api/regional-performance', async (req, res) => {
    console.log('Received request for /api/regional-performance');
    try {
        console.log('Checking database connection...');
        await pool.connect();
        
        // Query the regional performance data for the last 3 complete weeks
        // Using Sunday-to-Saturday week calculation for consistent reporting
        console.log('Executing regional performance query...');
        const result = await pool.request()
            .query(`
                WITH DateInfo AS (
                    SELECT 
                        GETDATE() as CurrentDate,
                        -- Get the most recent Saturday (end of last complete week)
                        DATEADD(day, 
                            -(DATEPART(weekday, GETDATE()) + (CASE WHEN DATEPART(weekday, GETDATE()) = 7 THEN 7 ELSE 0 END)), 
                            CAST(GETDATE() AS DATE)
                        ) as LastSaturday,
                        -- Get the Sunday that started that week
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
                        DATEPART(weekday, Transaction_Date) AS DayOfWeek,
                        SUM(Quantity) AS Daily_Quantity,
                        Transaction_Date
                    FROM dbo.Combined_Sales_Data_Final
                    WHERE Location IS NOT NULL
                    GROUP BY 
                        Transaction_Date,
                        DATEADD(day, -(DATEPART(weekday, Transaction_Date) - 1), CAST(Transaction_Date AS DATE)),
                        DATEADD(day, 7-(DATEPART(weekday, Transaction_Date)), CAST(Transaction_Date AS DATE)),
                        Location,
                        DATEPART(weekday, Transaction_Date)
                )
                SELECT 
                    Week_Label,
                    Region,
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
                GROUP BY Week_Label, Region, Week_Start, Week_End
                ORDER BY Week_End DESC, Region;
            `);
        
        console.log(`Regional performance query returned ${result.recordset.length} rows`);
        if (result.recordset.length > 0) {
            console.log('Sample row:', result.recordset[0]);
        } else {
            console.log('No data returned from query');
            return res.status(404).json({
                error: 'No regional performance data',
                message: 'No data was returned from the regional performance query'
            });
        }
        
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching regional performance data:', err);
        console.error('Error details:', {
            message: err.message,
            code: err.code,
            state: err.state,
            number: err.number,
            lineNumber: err.lineNumber,
            serverName: err.serverName,
            procName: err.procName,
            stack: err.stack
        });

        res.status(500).json({ 
            error: 'Error fetching regional performance data',
            details: err.message,
            errorCode: err.number
        });
    }
});

// Adjustment Profile Selections endpoints
app.get('/api/adjustment-profiles', async (req, res) => {
    console.log('Received request for /api/adjustment-profiles');
    try {
        // Fetch profile selections
        const selectionsResult = await pool.request()
            .query(`
                SELECT [Store_ID], [Store_Name], [SUNDAY], [MONDAY], [TUESDAY], 
                       [WEDNESDAY], [THURSDAY], [FRIDAY], [SATURDAY]
                FROM [dbo].[Adjustment_Profile_Selections]
                ORDER BY Store_Name;
            `);
        console.log(`Profile selections query returned ${selectionsResult.recordset.length} rows`);

        // Fetch available profile names (column names from Products_Standard_Baskets)
        const profileNamesResult = await pool.request()
            .query(`
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = 'Products_Standard_Baskets'
                  AND TABLE_SCHEMA = 'dbo' 
                  AND ORDINAL_POSITION >= (
                      SELECT ORDINAL_POSITION 
                      FROM INFORMATION_SCHEMA.COLUMNS 
                      WHERE TABLE_NAME = 'Products_Standard_Baskets' AND TABLE_SCHEMA = 'dbo' AND COLUMN_NAME = 'All_Small'
                  )
                ORDER BY ORDINAL_POSITION;
            `);
        const profileNames = profileNamesResult.recordset.map(row => row.COLUMN_NAME);
        console.log(`Found ${profileNames.length} available profile names:`, profileNames);

        res.json({
            selections: selectionsResult.recordset,
            profileNames: profileNames
        });

    } catch (err) {
        console.error('Error fetching adjustment profiles:', err);
        res.status(500).json({ error: 'Error fetching adjustment profile data' });
    }
});

app.post('/api/adjustment-profiles/update', async (req, res) => {
    const { Store_ID, DayOfWeek, NewProfileName } = req.body;
    console.log(`Received update request for Store_ID: ${Store_ID}, Day: ${DayOfWeek}, Profile: ${NewProfileName}`);

    // Validate DayOfWeek to prevent SQL injection
    const validDays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    if (!validDays.includes(DayOfWeek)) {
        console.error('Invalid DayOfWeek received:', DayOfWeek);
        return res.status(400).json({ error: 'Invalid DayOfWeek specified' });
    }

    try {
        // We need to construct the query carefully as the column name is dynamic
        // The mssql library handles parameterization for values, protecting against injection there.
        const request = pool.request();
        request.input('Store_ID', sql.VarChar, Store_ID);
        request.input('NewProfileName', sql.VarChar, NewProfileName); 

        // Construct the dynamic part of the SET clause safely
        const updateQuery = `UPDATE [dbo].[Adjustment_Profile_Selections] SET [${DayOfWeek}] = @NewProfileName WHERE [Store_ID] = @Store_ID;`;
        
        console.log('Executing update query:', updateQuery);
        await request.query(updateQuery);
        
        console.log(`Successfully updated profile for Store_ID: ${Store_ID}, Day: ${DayOfWeek}`);
        res.json({ success: true, message: 'Profile updated successfully' });

    } catch (err) {
        console.error('Error updating adjustment profile:', err);
        res.status(500).json({ error: 'Error updating adjustment profile' });
    }
});

// Serve logo
app.get('/logo', (req, res) => {
    res.sendFile(path.join(__dirname, 'logo.jpg'));
}); 