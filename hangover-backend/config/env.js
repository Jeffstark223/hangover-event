// Central place that loads and validates environment configuration.
// Every other module should read config through this file instead of
// touching process.env directly.
require('dotenv').config();

function required(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    // We do not throw in development to make local setup easier, but we
    // log loudly so a missing production secret is never silent.
    console.warn(`[config] WARNING: environment variable ${name} is not set.`);
  }
  return value;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:4000',

  database: {
    path: process.env.DATABASE_PATH || './database/hangover.db',
  },

  jwt: {
    secret: required('JWT_SECRET', 'dev_insecure_secret_change_me'),
    expiresIn: process.env.JWT_EXPIRES_IN || '12h',
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    callbackUrl: process.env.PAYSTACK_CALLBACK_URL || '',
  },

  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.EMAIL_FROM || 'HANGOVER Events <tickets@hangoverevents.gh>',
  },

  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

module.exports = config;
