const { db } = require('../database/db');

function getByEmail(email) {
  return db.prepare(`SELECT * FROM admins WHERE email = ?`).get(email.toLowerCase().trim());
}

function create({ name, email, passwordHash }) {
  const stmt = db.prepare(
    `INSERT INTO admins (name, email, password_hash) VALUES (?, ?, ?)`
  );
  const result = stmt.run(name, email.toLowerCase().trim(), passwordHash);
  return db.prepare(`SELECT id, name, email, created_at FROM admins WHERE id = ?`).get(result.lastInsertRowid);
}

function count() {
  return db.prepare(`SELECT COUNT(*) AS n FROM admins`).get().n;
}

module.exports = { getByEmail, create, count };
