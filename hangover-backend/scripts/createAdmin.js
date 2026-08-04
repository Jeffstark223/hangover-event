// Bootstraps the first admin user from ADMIN_EMAIL / ADMIN_PASSWORD /
// ADMIN_NAME in .env. Run with: npm run create-admin
const bcrypt = require('bcryptjs');
const { initSchema } = require('../database/db');
const AdminModel = require('../models/Admin');
const config = require('../config/env');

async function main() {
  initSchema();

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || 'Event Admin';

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in your .env file before running this script.');
    process.exit(1);
  }

  const existing = AdminModel.getByEmail(email);
  if (existing) {
    console.log(`Admin already exists for ${email}. Nothing to do.`);
    process.exit(0);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = AdminModel.create({ name, email, passwordHash });
  console.log(`Admin created: ${admin.email} (id ${admin.id})`);
  console.log('You can now log in at /admin.html with this email and the password from your .env.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
