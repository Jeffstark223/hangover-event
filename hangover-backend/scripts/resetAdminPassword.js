// Resets (or creates) the admin login using ADMIN_EMAIL / ADMIN_PASSWORD
// from .env. Safe to run anytime — updates the password if the admin
// already exists, or creates it if it doesn't.
const bcrypt = require('bcryptjs');
const { initSchema, db } = require('../database/db');
const AdminModel = require('../models/Admin');

async function main() {
  initSchema();

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Event Admin';

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file before running this script.');
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = AdminModel.getByEmail(email);

  if (existing) {
    db.prepare(`UPDATE admins SET password_hash = ?, name = ? WHERE email = ?`)
      .run(passwordHash, name, email.toLowerCase().trim());
    console.log(`Password reset for ${email}.`);
  } else {
    const admin = AdminModel.create({ name, email, passwordHash });
    console.log(`Admin created: ${admin.email} (id ${admin.id})`);
  }

  console.log('You can now log in at /admin.html with this email and the password from your .env.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});