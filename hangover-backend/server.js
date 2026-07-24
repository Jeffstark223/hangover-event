const app = require('./app');
const config = require('./config/env');
const { initSchema } = require('./database/db');
const { seedTables } = require('./models/Table');
const logger = require('./utils/logger');

// Create tables + seed the venue's table inventory on every boot.
// Both operations are idempotent (CREATE TABLE IF NOT EXISTS / ON
// CONFLICT DO NOTHING), so this is safe to run on every restart.
initSchema();
seedTables();

app.listen(config.port, () => {
  logger.info(`HANGOVER backend listening on port ${config.port} (${config.env})`);
});
