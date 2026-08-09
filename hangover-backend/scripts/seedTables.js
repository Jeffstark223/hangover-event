// Standalone script to (re)sync the table inventory with
// config/tables.config.js. Run with: npm run seed-tables
const { initSchema } = require('../database/db');
const { seedTables, getAllTables } = require('../models/Table');

initSchema();
seedTables();
const tables = getAllTables();
console.log(`Table inventory synced. ${tables.length} tables in database.`);
