const app = require('./app');
const config = require('./config/env');
const { initSchema } = require('./database/db');
const logger = require('./utils/logger');

// Create the database tables (idempotent: CREATE TABLE IF NOT EXISTS), safe on every boot.
initSchema();

app.listen(config.port, () => {
  logger.info(`HANGOVER backend listening on port ${config.port} (${config.env})`);
});
