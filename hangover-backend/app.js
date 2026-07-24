const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');

const config = require('./config/env');
const { apiLimiter } = require('./middleware/rateLimiters');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const bookingRoutes = require('./routes/bookingRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const tableRoutes = require('./routes/tableRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false, // the static frontend loads Google Fonts/Unsplash; tighten this once assets are finalized
  })
);

app.use(
  cors({
    origin: config.allowedOrigins.includes('*') ? true : config.allowedOrigins,
    credentials: true,
  })
);

app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', apiLimiter);

app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', env: config.env }));

app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/tables', tableRoutes);
app.use('/api/admin', adminRoutes);

// Serve the existing frontend (index.html / admin.html) as static files.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', notFoundHandler);
app.use(errorHandler);

module.exports = app;
