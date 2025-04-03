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

app.use(express.static(path.join(__dirname)));

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK',
        timestamp: new Date().toISOString(),
        env: process.env.NODE_ENV,
        appName: process.env.APP_NAME
    });
});

// Root route (Main Menu)
app.get('/', (req, res) => {
    console.log('Serving index.html from:', path.join(__dirname, 'index.html'));
    console.log('Current directory:', __dirname);
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Static routes
const staticPages = [
    'stores-master.html',
    'products-master.html',
    'standing-orders.html',
    'adjustments.html',
    'final-production.html',
    'final-delivery.html',
    'region-uplift.html',
    'actual-sales.html',
    'regional-performance.html'
];

staticPages.forEach(page => {
    app.get(`/${page}`, (req, res) => {
        res.sendFile(path.join(__dirname, page));
    });
});

// Database configuration
const dbConfig = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true,
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    }
};

// Database connection pool
let pool;

async function initializeDatabase() {
    try {
        console.log('Connecting to database...');
        pool = await sql.connect(dbConfig);
        console.log('Connected to database successfully');
        return true;
    } catch (err) {
        console.error('Failed to connect to database:', err);
        if (appInsights.defaultClient) {
            appInsights.defaultClient.trackException({ exception: err });
        }
        return false;
    }
}

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

// Start the server
startServer().catch(err => {
    console.error('Failed to start application:', err);
    if (appInsights.defaultClient) {
        appInsights.defaultClient.trackException({ exception: err });
    }
    process.exit(1);
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

// Update store endpoint
app.post('/api/stores/update', async (req, res) => {
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
                UPDATE Stores_Master 
                SET Store_Name = @Store_Name,
                    Address = @Address,
                    Region = @Region,
                    State = @State,
                    SUNDAY = @SUNDAY,
                    MONDAY = @MONDAY,
                    TUESDAY = @TUESDAY,
                    WEDNESDAY = @WEDNESDAY,
                    THURSDAY = @THURSDAY,
                    FRIDAY = @FRIDAY,
                    SATURDAY = @SATURDAY,
                    SPECIAL_FRIDAY = @SPECIAL_FRIDAY,
                    SPECIAL_SUNDAY = @SPECIAL_SUNDAY
                WHERE Store_ID = @Store_ID
            `);
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
    try {
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

        const storesResult = await pool.request()
            .query('SELECT DISTINCT Store_ID, Store_Name FROM Stores_Master ORDER BY Store_ID');

        const productsResult = await pool.request()
            .query('SELECT DISTINCT Product_ID, Product_Description FROM Products_Master ORDER BY Product_Description');

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
    try {
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
        
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching final forecast:', err);
        res.status(500).json({ error: 'Error fetching final forecast data' });
    }
});

// Final Deliveries endpoint
app.get('/api/final-deliveries', async (req, res) => {
    try {
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
    try {
        const result = await pool.request()
            .query(`
                SELECT [Week_Label]
                    ,[Region]
                    ,[Sunday]
                    ,[Monday]
                    ,[Tuesday]
                    ,[Wednesday]
                    ,[Thursday]
                    ,[Friday]
                    ,[Saturday]
                    ,[Total_Week_Quantity]
                FROM [dbo].[vw_Cumulative_Weekly_Region_Sales]
                ORDER BY Week_Label DESC, Region
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error('Error fetching regional performance data:', err);
        res.status(500).json({ error: 'Error fetching regional performance data' });
    }
});

// Serve logo
app.get('/logo', (req, res) => {
    res.sendFile(path.join(__dirname, 'logo.jpg'));
}); 