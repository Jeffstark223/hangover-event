const { db } = require('../database/db');
const tablesConfig = require('../config/tables.config');

/** Generates the full table number list for a package, e.g. P01..P10. */
function numbersForPackage(pkg) {
  const width = String(pkg.count).length >= 2 ? 2 : 2;
  return Array.from({ length: pkg.count }, (_, i) =>
    `${pkg.prefix}${String(i + 1).padStart(width, '0')}`
  );
}

/** Idempotently inserts every configured table into tables_inventory. */
function seedTables() {
  const insert = db.prepare(`
    INSERT INTO tables_inventory (table_number, package, price, status)
    VALUES (?, ?, ?, 'Available')
    ON CONFLICT(table_number) DO NOTHING
  `);

  const seedAll = db.transaction(() => {
    for (const pkg of tablesConfig.packages) {
      for (const number of numbersForPackage(pkg)) {
        insert.run(number, pkg.key, pkg.price);
      }
    }
  });

  seedAll();
}

function getAllTables() {
  return db.prepare(`SELECT * FROM tables_inventory ORDER BY package, table_number`).all();
}

function getAvailableTables(packageKey) {
  if (packageKey) {
    return db
      .prepare(`SELECT * FROM tables_inventory WHERE package = ? AND status = 'Available' ORDER BY table_number`)
      .all(packageKey);
  }
  return db
    .prepare(`SELECT * FROM tables_inventory WHERE status = 'Available' ORDER BY package, table_number`)
    .all();
}

function getTable(tableNumber) {
  return db.prepare(`SELECT * FROM tables_inventory WHERE table_number = ?`).get(tableNumber);
}

/**
 * Atomically claims a table for a booking. Returns true if the table
 * was available and is now reserved; false if it was already taken
 * (e.g. a race between two guests booking simultaneously).
 */
function reserveTable(tableNumber, { bookingId, guestName }) {
  const result = db
    .prepare(
      `UPDATE tables_inventory
       SET status = 'Reserved', booking_id = ?, reserved_by = ?, updated_at = datetime('now')
       WHERE table_number = ? AND status = 'Available'`
    )
    .run(bookingId, guestName, tableNumber);
  return result.changes === 1;
}

function releaseTable(tableNumber) {
  db.prepare(
    `UPDATE tables_inventory
     SET status = 'Available', booking_id = NULL, reserved_by = NULL, updated_at = datetime('now')
     WHERE table_number = ?`
  ).run(tableNumber);
}

module.exports = {
  seedTables,
  getAllTables,
  getAvailableTables,
  getTable,
  reserveTable,
  releaseTable,
};
