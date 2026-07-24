const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const config = require('../config/env');

// Ensure the folder that will hold the .db file exists (SQLite will
// create the file itself, but not the parent directory).
const dbPath = path.resolve(process.cwd(), config.database.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// Sensible production pragmas for a single-writer Node/Express app.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

/**
 * Creates every table the application needs if it does not already
 * exist. Safe to call on every server start.
 */
function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tables_inventory (
      table_number TEXT PRIMARY KEY,
      package TEXT NOT NULL,
      price REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'Available'
        CHECK (status IN ('Available', 'Reserved', 'Held')),
      booking_id TEXT,
      reserved_by TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id TEXT NOT NULL UNIQUE,
      reservation_id TEXT NOT NULL UNIQUE,
      ticket_id TEXT NOT NULL UNIQUE,

      guest_name TEXT NOT NULL,
      phone_number TEXT NOT NULL,
      email TEXT NOT NULL,

      ticket_type TEXT NOT NULL,          -- 'regular' | 'vip'
      quantity INTEGER NOT NULL DEFAULT 1,

      table_package TEXT,                 -- 'premium' | 'luxury' | 'standard' | NULL
      table_number TEXT,
      drink_choice TEXT,
      seats INTEGER,

      amount_paid REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GHS',
      payment_status TEXT NOT NULL DEFAULT 'Pending'
        CHECK (payment_status IN ('Pending', 'Paid', 'Failed', 'Cancelled')),
      payment_reference TEXT,             -- Hubtel transaction / client reference

      checked_in INTEGER NOT NULL DEFAULT 0, -- 0/1 boolean
      checked_in_at TEXT,

      ticket_pdf_path TEXT,
      email_sent INTEGER NOT NULL DEFAULT 0,

      booking_date TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (table_number) REFERENCES tables_inventory (table_number)
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_ticket_id ON bookings (ticket_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON bookings (booking_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_reservation_id ON bookings (reservation_id);
    CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings (phone_number);
    CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings (email);
    CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings (payment_status);

    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id TEXT NOT NULL,
      event_type TEXT NOT NULL,          -- 'initiated' | 'callback' | 'verified' | 'failed'
      raw_payload TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (booking_id) REFERENCES bookings (booking_id)
    );
  `);
}

module.exports = { db, initSchema, dbPath };
