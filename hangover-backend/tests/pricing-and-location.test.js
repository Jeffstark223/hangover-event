// ============================================================================
// HANGOVER — pricing, ticket issuance, manual payment, check-in, venue tests
//
// Run:  npm test        (from hangover-backend/, after `npm install`)
//
// Uses a throw-away SQLite database and temp folders. Nothing in the real
// database, tickets/ or config/ is touched. Email is faked so sends can be
// inspected; no real SMTP or network is used.
// ============================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const BACKEND = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hangover-test-'));
process.chdir(tmp); // PDFs and exports are written relative to cwd

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(tmp, 'test.db');
process.env.JWT_SECRET = 'test-secret';
process.env.ALLOWED_ORIGINS = '*';
process.env.SMTP_HOST = 'smtp.fake.test';
process.env.SMTP_USER = 'fake';

const LOCATION_FILE = path.join(tmp, 'event-location.json');
fs.copyFileSync(path.join(BACKEND, 'config', 'event-location.json'), LOCATION_FILE);
process.env.EVENT_LOCATION_FILE = LOCATION_FILE;

// ---- test doubles: fake mailer, no log noise, no rate limiting -------------
const sentEmails = [];
const realLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'nodemailer') {
    return { createTransport: () => ({ sendMail: async (opts) => (sentEmails.push(opts), {}) }) };
  }
  if (request === 'morgan') return () => (req, res, next) => next();
  if (request === 'express-rate-limit') return () => (req, res, next) => next();
  return realLoad.call(this, request, ...rest);
};

const bcrypt = require(path.join(BACKEND, 'node_modules', 'bcryptjs'));
const { initSchema, db } = require(path.join(BACKEND, 'database', 'db'));
const AdminModel = require(path.join(BACKEND, 'models', 'Admin'));
const app = require(path.join(BACKEND, 'app'));
const ticketsConfig = require(path.join(BACKEND, 'config', 'tickets.config'));
const paymentConfig = require(path.join(BACKEND, 'config', 'payment.config'));

let server;
let base;
let token;
const HAVE_PDFTOTEXT = (() => {
  try { execFileSync('pdftotext', ['-v'], { stdio: 'ignore' }); return true; } catch (e) { return false; }
})();

async function call(method, url, body, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) json = await res.json();
  return { status: res.status, json, res };
}

const person = (n = 1) => ({ guestName: `Test Guest ${n}`, phoneNumber: '0241234567', email: `guest${n}@example.com` });
const create = (extra) => call('POST', '/api/bookings', { ...person(), ...extra }, false);

async function submitAndConfirm(bookingId, extraConfirmBody) {
  const sub = await call('POST', '/api/payments/momo/submit', { bookingId, transactionId: `MP${Date.now()}${Math.floor(Math.random() * 1e4)}` }, false);
  assert.equal(sub.status, 200);
  return call('POST', `/api/admin/bookings/${bookingId}/confirm-payment`, extraConfirmBody || {});
}

function pdfText(file) {
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

test.before(async () => {
  initSchema();
  AdminModel.create({ name: 'Test Admin', email: 'admin@test.local', passwordHash: await bcrypt.hash('pw-12345', 4) });
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await call('POST', '/api/admin/auth/login', { email: 'admin@test.local', password: 'pw-12345' }, false);
  assert.equal(login.status, 200);
  token = login.json.token;
});

test.after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Group of 6 = exactly GHS 300
// ---------------------------------------------------------------------------
test('1. Group of 6 costs exactly GHS 300 in total (not per person)', async () => {
  const r = await create({ ticketType: 'group_of_6' });
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.amount_due, 300);
  assert.equal(r.json.payment.amount, 300);
  assert.equal(r.json.payment.attendees, 6);
  assert.equal(r.json.booking.quantity, 6);          // six people admitted
  assert.equal(r.json.booking.price_unit, 'group');
  assert.equal(r.json.booking.unit_price, 300);

  // A group is always exactly one group: nobody can order "2 groups for 300" or "6 groups".
  for (const quantity of [2, 6, 0, -1]) {
    const bad = await create({ ticketType: 'group_of_6', quantity });
    assert.equal(bad.status, 422, `quantity ${quantity} must be rejected for a group`);
  }
  // quantity 1 / omitted is fine and still 300
  const ok = await create({ ticketType: 'group_of_6', quantity: 1 });
  assert.equal(ok.json.booking.amount_due, 300);

  // Public price list shows 300 TOTAL for the group
  const cat = await call('GET', '/api/tickets', undefined, false);
  const g = cat.json.tickets.find((t) => t.key === 'group_of_6');
  assert.equal(g.price, 300);
  assert.equal(g.pricingUnit, 'group');
  assert.equal(g.attendeesPerUnit, 6);
});

// ---------------------------------------------------------------------------
// 2. Six tickets for a confirmed group payment
// ---------------------------------------------------------------------------
let groupBooking; // reused by the verification / check-in tests
let groupTickets;

test('2. A confirmed Group of 6 payment generates six separate tickets with six PDFs', async () => {
  const r = await create({ ticketType: 'group_of_6' });
  const id = r.json.booking.booking_id;

  // Nothing is issued before payment is confirmed
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendee_tickets WHERE booking_id=?').get(id).n, 0);

  const before = sentEmails.length;
  const c = await submitAndConfirm(id);
  assert.equal(c.status, 200);
  assert.equal(c.json.booking.payment_status, 'Paid');
  assert.equal(c.json.booking.amount_paid, 300);
  assert.equal(c.json.attendeeTickets.length, 6);
  assert.deepEqual(c.json.attendeeTickets.map((t) => t.attendee_number), [1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(c.json.attendeeTickets.map((t) => t.ticket_id)).size, 6);

  for (const t of c.json.attendeeTickets) {
    assert.ok(t.ticket_pdf_path && fs.existsSync(t.ticket_pdf_path), `PDF missing for ${t.ticket_id}`);
    assert.ok(fs.statSync(t.ticket_pdf_path).size > 500);
    assert.equal(t.attendee_total, 6);
    assert.equal(t.ticket_category, 'group_of_6');
    assert.equal(t.checked_in, 0);
    assert.equal(path.basename(t.ticket_pdf_path), `${t.ticket_id}.pdf`);
  }
  // Attendee #1 is the booking's main ticket (so existing download links keep working)
  assert.equal(c.json.attendeeTickets[0].ticket_id, c.json.booking.ticket_id);
  assert.equal(c.json.booking.ticket_pdf_path, c.json.attendeeTickets[0].ticket_pdf_path);

  // Email carries all six PDFs
  assert.equal(sentEmails.length, before + 1);
  const mail = sentEmails[sentEmails.length - 1];
  assert.equal(mail.attachments.length, 6);
  assert.match(mail.html, /Group of 6/);

  if (HAVE_PDFTOTEXT) {
    const txt = pdfText(c.json.attendeeTickets[2].ticket_pdf_path);
    assert.match(txt, /3 of 6/);
    assert.ok(txt.includes(c.json.attendeeTickets[2].ticket_id));
    assert.match(txt, /GHS 300\.00 total for the group of 6/);
  }

  // Confirming again or resending never creates extra tickets or changes IDs
  const again = await call('POST', `/api/admin/bookings/${id}/confirm-payment`, {});
  assert.equal(again.json.attendeeTickets.length, 6);
  const resend = await call('POST', `/api/admin/bookings/${id}/resend-ticket`, {});
  assert.equal(resend.status, 200);
  const after = db.prepare('SELECT ticket_id FROM attendee_tickets WHERE booking_id=? ORDER BY attendee_number').all(id).map((x) => x.ticket_id);
  assert.deepEqual(after, c.json.attendeeTickets.map((t) => t.ticket_id));

  // Customer retrieval lists all six, each downloadable
  const ret = await call('POST', '/api/bookings/retrieve', { identifier: id }, false);
  assert.equal(ret.json.booking.attendeeTickets.length, 6);
  assert.ok(ret.json.booking.attendeeTickets.every((t) => t.ticketAvailable));
  assert.equal(ret.json.booking.ticketLabel, 'Group of 6');

  groupBooking = c.json.booking;
  groupTickets = c.json.attendeeTickets;
});

// ---------------------------------------------------------------------------
// 3-5. Guys 80, Girls 65, Late Bird 100 (per person, one ticket each)
// ---------------------------------------------------------------------------
for (const [num, key, price] of [[3, 'guys', 80], [4, 'girls', 65], [5, 'late_bird', 100]]) {
  test(`${num}. ${key} tickets cost GHS ${price} each and issue one ticket per person`, async () => {
    const one = await create({ ticketType: key });
    assert.equal(one.json.booking.amount_due, price);
    assert.equal(one.json.booking.price_unit, 'person');

    const three = await create({ ticketType: key, quantity: 3 });
    assert.equal(three.json.booking.amount_due, price * 3);
    assert.equal(three.json.payment.amount, price * 3);

    const c = await submitAndConfirm(three.json.booking.booking_id);
    assert.equal(c.json.booking.amount_paid, price * 3);
    assert.equal(c.json.attendeeTickets.length, 3);
    assert.equal(new Set(c.json.attendeeTickets.map((t) => t.ticket_id)).size, 3);
    c.json.attendeeTickets.forEach((t) => assert.equal(t.attendee_total, 3));
    if (HAVE_PDFTOTEXT) assert.match(pdfText(c.json.attendeeTickets[0].ticket_pdf_path), new RegExp(`GHS ${price}\\.00 per person`));

    const single = await submitAndConfirm(one.json.booking.booking_id);
    assert.equal(single.json.attendeeTickets.length, 1);
    assert.equal(single.json.attendeeTickets[0].ticket_id, single.json.booking.ticket_id);
  });
}

// ---------------------------------------------------------------------------
// 6. Backend calculation + tamper resistance
// ---------------------------------------------------------------------------
test('6a. Backend amount always equals category price x quantity (full matrix)', async () => {
  const expected = { guys: 80, girls: 65, late_bird: 100 };
  for (const [key, price] of Object.entries(expected)) {
    for (const qty of [1, 2, 3, 5, 20]) {
      const r = await create({ ticketType: key, quantity: qty });
      assert.equal(r.status, 201, `${key} x${qty}`);
      assert.equal(r.json.booking.amount_due, price * qty, `${key} x${qty}`);
      assert.equal(r.json.payment.amount, price * qty);
      assert.equal(r.json.booking.quantity, qty);
    }
  }
});

test('6b. A browser cannot change the price: price/amount fields in the request are ignored', async () => {
  const r = await create({
    ticketType: 'guys', quantity: 2,
    amount: 1, price: 1, unitPrice: 1, unit_price: 1, amount_due: 1, amountDue: 1, total: 1, amount_paid: 160, pricingUnit: 'group', price_unit: 'group',
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.booking.amount_due, 160);
  assert.equal(r.json.booking.unit_price, 80);
  assert.equal(r.json.booking.price_unit, 'person');
  assert.equal(r.json.booking.amount_paid, 0);
  assert.equal(r.json.booking.payment_status, 'Pending');
});

test('6c. Invalid ticket types and quantities are rejected', async () => {
  for (const ticketType of ['regular', 'vip', 'vvip', 'VIP', 'table', 'REGULAR', 'bogus', '__proto__', 'constructor', 'toString', '', undefined, null, 5, {}, []]) {
    const r = await create({ ticketType });
    assert.equal(r.status, 422, `ticketType ${JSON.stringify(ticketType)} must be rejected`);
  }
  for (const quantity of [0, -1, 1.5, 'abc', '1e3', 21, 1000000000, {}, [], true]) {
    const r = await create({ ticketType: 'guys', quantity });
    assert.equal(r.status, 422, `quantity ${JSON.stringify(quantity)} must be rejected`);
  }
  const r = await create({ ticketType: 'guys', quantity: '3' }); // plain digit string is tolerated
  assert.equal(r.json.booking.amount_due, 240);
});

test('6d. Regular, VIP and VVIP are gone: rejected by the API and absent from config and catalogue', async () => {
  for (const old of ['regular', 'vip', 'vvip']) {
    const r = await create({ ticketType: old });
    assert.equal(r.status, 422, `${old} must be rejected`);
    assert.match(r.json.details.join(' '), /no longer available/i);
  }
  const cat = (await call('GET', '/api/tickets', undefined, false)).json.tickets;
  assert.deepEqual(
    Object.fromEntries(cat.map((t) => [t.key, t.price])),
    { group_of_6: 300, guys: 80, girls: 65, late_bird: 100 }
  );
  assert.deepEqual(Object.keys(ticketsConfig.tickets).sort(), ['girls', 'group_of_6', 'guys', 'late_bird']);
  assert.ok(!fs.existsSync(path.join(BACKEND, 'config', 'tables.config.js')), 'old tables.config.js (with old prices) must not exist');

  // none of the old price points (200 / 300-per-person VIP / 800 / table packages) appear in any config or code
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (!['node_modules', 'tests', 'database', 'tickets', 'exports', 'uploads'].includes(f.name)) walk(p); }
      else if (/\.(js|html)$/.test(f.name)) {
        const src = fs.readFileSync(p, 'utf8');
        if (/GHS\s*(5,?000|3,?500|2,?500|200|800)\b/i.test(src) || /price:\s*(5000|3500|2500|200|800)\b/.test(src)) offenders.push(path.relative(BACKEND, p));
      }
    }
  };
  walk(BACKEND); walk(path.join(BACKEND, '..', 'public'));
  assert.deepEqual(offenders, [], `old prices found in: ${offenders.join(', ')}`);
});

test('6e. Payment confirmation re-validates the amount (tampered DB amount, wrong amount received)', async () => {
  // Stored amount no longer matches category x quantity -> confirmation refused, nothing issued
  const g = await create({ ticketType: 'group_of_6' });
  const gid = g.json.booking.booking_id;
  db.prepare('UPDATE bookings SET amount_due = 1 WHERE booking_id = ?').run(gid);
  const bad = await submitAndConfirm(gid);
  assert.equal(bad.status, 409);
  assert.match(bad.json.message, /amount mismatch/i);
  const row = db.prepare('SELECT payment_status, amount_paid FROM bookings WHERE booking_id=?').get(gid);
  assert.equal(row.payment_status, 'Pending');
  assert.equal(row.amount_paid, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendee_tickets WHERE booking_id=?').get(gid).n, 0);

  // Admin states the amount actually received: wrong amount -> refused; right amount -> accepted
  const s = await create({ ticketType: 'guys', quantity: 2 });
  const sid = s.json.booking.booking_id;
  const wrong = await submitAndConfirm(sid, { amountReceived: 100 });
  assert.equal(wrong.status, 409);
  assert.match(wrong.json.message, /amount mismatch/i);
  const right = await call('POST', `/api/admin/bookings/${sid}/confirm-payment`, { amountReceived: 160 });
  assert.equal(right.status, 200);
  assert.equal(right.json.booking.amount_paid, 160);
  assert.equal(right.json.attendeeTickets.length, 2);
});

// ---------------------------------------------------------------------------
// 7. Unique IDs
// ---------------------------------------------------------------------------
test('7. Every ticket in the system has a unique ID (and its own PDF file)', async () => {
  const attendee = db.prepare('SELECT ticket_id, ticket_pdf_path FROM attendee_tickets').all();
  assert.ok(attendee.length >= 6 + 3 + 3 + 3);
  const ids = attendee.map((t) => t.ticket_id);
  assert.equal(new Set(ids).size, ids.length, 'attendee ticket IDs must be unique');
  ids.forEach((id) => assert.match(id, /^TCK-[2-9A-HJKMNP-Z]{10}$/));
  assert.equal(new Set(attendee.map((t) => t.ticket_pdf_path)).size, attendee.length, 'each ticket has its own PDF');

  // Unique across every ticket table combined (attendee #1 deliberately equals its booking's main ID)
  const all = [
    ...ids,
    ...db.prepare("SELECT ticket_id FROM bookings WHERE booking_id NOT IN (SELECT booking_id FROM attendee_tickets)").all().map((x) => x.ticket_id),
  ];
  assert.equal(new Set(all).size, all.length, 'ticket IDs must be unique across all ticket types');
});

// ---------------------------------------------------------------------------
// 8. Independent verification and check-in
// ---------------------------------------------------------------------------
test('8. Each attendee ticket verifies and checks in independently, exactly once', async () => {
  assert.equal(groupTickets.length, 6);

  // Public + admin verification works for every one of the six IDs
  for (const t of groupTickets) {
    const pub = await call('GET', `/api/bookings/verify/${t.ticket_id}`, undefined, false);
    assert.equal(pub.status, 200);
    assert.equal(pub.json.ticket.ticketId, t.ticket_id);
    assert.equal(pub.json.ticket.checkedIn, false);
    assert.equal(pub.json.ticket.attendeeNumber, t.attendee_number);
    assert.equal(pub.json.ticket.attendeeTotal, 6);
    assert.equal(pub.json.ticket.ticketLabel, 'Group of 6');

    const adm = await call('POST', '/api/admin/verify', { ticketId: t.ticket_id });
    assert.equal(adm.status, 200);
    assert.equal(adm.json.ticketType, 'attendee');
    assert.equal(adm.json.attendeeTicket.ticket_id, t.ticket_id);
  }

  // Check in ONLY ticket 3
  const third = groupTickets[2].ticket_id;
  const ci = await call('POST', '/api/admin/checkin', { ticketId: third });
  assert.equal(ci.status, 200);
  assert.equal(ci.json.attendeeTicket.checked_in, 1);
  assert.equal(ci.json.attendeeSummary.checkedIn, 1);
  assert.equal(ci.json.attendeeSummary.total, 6);

  for (const t of groupTickets) {
    const v = await call('GET', `/api/bookings/verify/${t.ticket_id}`, undefined, false);
    assert.equal(v.json.ticket.checkedIn, t.ticket_id === third, `only ticket 3 may be checked in (${t.attendee_number})`);
  }

  // The same ticket cannot be used twice
  const dup = await call('POST', '/api/admin/checkin', { ticketId: third });
  assert.equal(dup.status, 409);
  assert.match(dup.json.message, /already been checked in/i);

  // Two simultaneous scans of the same ticket: exactly one succeeds
  const fourth = groupTickets[3].ticket_id;
  const race = await Promise.all([
    call('POST', '/api/admin/checkin', { ticketId: fourth }),
    call('POST', '/api/admin/checkin', { ticketId: fourth }),
  ]);
  assert.deepEqual(race.map((x) => x.status).sort(), [200, 409]);

  // Ticket #1 (shares its ID with the booking's main ticket) behaves like the others
  const first = groupTickets[0].ticket_id;
  const c1 = await call('POST', '/api/admin/checkin', { ticketId: first });
  assert.equal(c1.status, 200);
  assert.equal(c1.json.ticketType, 'attendee');
  assert.equal((await call('POST', '/api/admin/checkin', { ticketId: first })).status, 409);

  // Unknown ticket / unauthenticated check-in are refused
  assert.equal((await call('POST', '/api/admin/checkin', { ticketId: 'TCK-NOPE000000' })).status, 404);
  assert.equal((await call('POST', '/api/admin/checkin', { ticketId: groupTickets[4].ticket_id }, false)).status, 401);
  assert.equal((await call('GET', '/api/bookings/verify/TCK-NOPE000000', undefined, false)).status, 404);

  // Admin booking list reports progress; check in the rest -> 6/6
  for (const t of [groupTickets[1], groupTickets[4], groupTickets[5]]) {
    assert.equal((await call('POST', '/api/admin/checkin', { ticketId: t.ticket_id })).status, 200);
  }
  const list = await call('GET', `/api/admin/bookings?q=${groupBooking.booking_id}`);
  const row = list.json.bookings.find((b) => b.booking_id === groupBooking.booking_id);
  assert.equal(row.ticket_label, 'Group of 6');
  assert.equal(row.attendee_total, 6);
  assert.equal(row.attendee_checked_in, 6);
  assert.equal((await call('GET', '/api/admin/dashboard')).json.stats.checkedIn >= 6, true);

  // Each ticket's PDF can be downloaded and is a distinct file
  const bodies = new Set();
  for (const t of groupTickets) {
    const dl = await fetch(`${base}/api/bookings/attendee-ticket/${t.ticket_id}`);
    assert.equal(dl.status, 200);
    const buf = Buffer.from(await dl.arrayBuffer());
    assert.equal(buf.slice(0, 4).toString(), '%PDF');
    bodies.add(buf.toString('base64'));
  }
  assert.equal(bodies.size, 6);

  // Pending (unpaid) bookings have no admittable tickets
  const p = await create({ ticketType: 'girls', quantity: 2 });
  const adminVerifyPending = await call('POST', '/api/admin/verify', { ticketId: p.json.booking.ticket_id });
  assert.equal(adminVerifyPending.status, 409);
  const adminCheckinPending = await call('POST', '/api/admin/checkin', { ticketId: p.json.booking.ticket_id });
  assert.equal(adminCheckinPending.status, 409);
});

// ---------------------------------------------------------------------------
// 9. Table reservations are removed
// ---------------------------------------------------------------------------
test('9. Table reservations are completely removed (API, code, database, pages)', async () => {
  // endpoints are gone
  for (const [m, u] of [['GET', '/api/tables'], ['GET', '/api/admin/tables'], ['GET', '/api/bookings/free-ticket/FREE-AAAAAAAAAA']]) {
    const r = await call(m, u, undefined, m === 'GET' && u.includes('admin') ? true : false);
    assert.equal(r.status, 404, `${u} must not exist`);
  }
  // a booking request that still carries table fields is just an ordinary ticket booking, priced by the ticket catalogue
  const withTable = await create({ ticketType: 'guys', tablePackage: 'premium', tableNumber: 'P1', drinkChoice: 'Hennessy', seats: 9 });
  assert.equal(withTable.status, 201);
  assert.equal(withTable.json.booking.amount_due, 80);
  assert.equal(withTable.json.booking.price_unit, 'person');
  assert.equal(withTable.json.booking.table_package, undefined);
  // table-only requests (no ticket category) are refused
  const tableOnly = await create({ tablePackage: 'premium', tableNumber: 'P1' });
  assert.equal(tableOnly.status, 422);

  // fresh databases create no table / free-ticket structures
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
  assert.ok(!names.includes('tables_inventory'));
  assert.ok(!names.includes('free_tickets'));
  const cols = db.prepare('PRAGMA table_info(bookings)').all().map((c) => c.name);
  for (const c of ['table_package', 'table_number', 'drink_choice', 'seats']) assert.ok(!cols.includes(c), `${c} column must not exist`);

  // dashboard has no table stat
  const stats = (await call('GET', '/api/admin/dashboard')).json.stats;
  assert.ok(!('totalTablesReserved' in stats));

  // no table / free-ticket code or UI anywhere
  for (const gone of ['models/Table.js', 'models/FreeTicket.js', 'controllers/tableController.js', 'routes/tableRoutes.js', 'scripts/seedTables.js']) {
    assert.ok(!fs.existsSync(path.join(BACKEND, gone)), `${gone} must be deleted`);
  }
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (!['node_modules', 'tests', 'database', 'tickets', 'exports', 'uploads'].includes(f.name)) walk(p); continue; }
      if (!/\.(js|html|json)$/.test(f.name) || f.name === 'package-lock.json') continue;
      const src = fs.readFileSync(p, 'utf8').replace(/\/\/ NOTE \(table reservations removed\)[\s\S]*?never create them\.\n/, '');
      if (/tablePackage|table_package|tableNumber|table_number|tables_inventory|free_tickets|FreeTicket|tableFloor|Reserve a Table|table reservation|data-table-package|id="tables"|href="#tables"/i.test(src)) offenders.push(path.relative(BACKEND, p));
    }
  };
  walk(BACKEND); walk(path.join(BACKEND, '..', 'public'));
  // the only allowed mentions: the migration note in db.js and the 'retired' display label for old records
  assert.deepEqual(offenders.filter((f) => !/(database[\\/]db|config[\\/]tickets\.config)\.js$/.test(f)), [], `table/free-ticket references remain in: ${offenders.join(', ')}`);
});

test('9b. Payment stays manual: no ticket or "Paid" status until an administrator confirms', async () => {
  const r = await create({ ticketType: 'group_of_6' });
  const id = r.json.booking.booking_id;
  assert.equal(r.json.payment.method, 'manual_momo');
  assert.equal(r.json.payment.number, paymentConfig.momo.ticket.number);
  assert.equal(r.json.booking.payment_status, 'Pending');
  assert.equal(r.json.booking.ticket_pdf_path, null);

  const noTickets = () => db.prepare('SELECT COUNT(*) n FROM attendee_tickets WHERE booking_id=?').get(id).n;
  const status = () => db.prepare('SELECT payment_status, amount_paid, ticket_pdf_path FROM bookings WHERE booking_id=?').get(id);

  // 1. admin cannot confirm before the customer submits a MoMo reference
  assert.equal((await call('POST', `/api/admin/bookings/${id}/confirm-payment`, {})).status, 409);
  assert.equal(noTickets(), 0);

  // 2. the customer submitting a reference does NOT mark it paid or generate anything
  const sub = await call('POST', '/api/payments/momo/submit', { bookingId: id, transactionId: 'MP5551234' }, false);
  assert.equal(sub.status, 200);
  assert.equal(status().payment_status, 'Pending');
  assert.equal(status().amount_paid, 0);
  assert.equal(status().ticket_pdf_path, null);
  assert.equal(noTickets(), 0);
  const ps = await call('GET', `/api/payments/status/${id}`, undefined, false);
  assert.notEqual(ps.json && ps.json.paymentStatus, 'Paid');

  // 3. tickets cannot be downloaded / verified / checked in while unpaid
  const dl = await fetch(`${base}/api/bookings/ticket/${id}`);
  assert.notEqual(dl.status, 200);
  assert.equal((await call('POST', '/api/admin/verify', { ticketId: r.json.booking.ticket_id })).status, 409);
  assert.equal((await call('POST', '/api/admin/checkin', { ticketId: r.json.booking.ticket_id })).status, 409);

  // 4. a customer cannot approve their own payment (admin endpoint needs a login)
  assert.equal((await call('POST', `/api/admin/bookings/${id}/confirm-payment`, {}, false)).status, 401);
  assert.equal(status().payment_status, 'Pending');
  assert.equal(noTickets(), 0);

  // 5. only the administrator's confirmation flips it to Paid and issues the six tickets
  const ok = await call('POST', `/api/admin/bookings/${id}/confirm-payment`, { amountReceived: 300 });
  assert.equal(ok.status, 200);
  assert.equal(status().payment_status, 'Paid');
  assert.equal(noTickets(), 6);

  // no payment provider integration was introduced
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies || {}).join(' ');
  assert.ok(!/paystack|flutterwave|stripe|hubtel|moolre/i.test(deps), 'no payment provider package must be added');
});

test('9c. No QR-code functionality exists anywhere', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(' ');
  assert.ok(!/qr|barcode|jsqr|zxing/i.test(deps), 'no QR dependency');
  const offenders = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) { if (!['node_modules', 'tests', 'database', 'tickets', 'exports', 'uploads'].includes(f.name)) walk(p); continue; }
      if (!/\.(js|html)$/.test(f.name)) continue;
      if (/qrcode|qr[-_ ]?code|\bqr\b|getUserMedia|BarcodeDetector|jsQR/i.test(fs.readFileSync(p, 'utf8'))) offenders.push(path.relative(BACKEND, p));
    }
  };
  walk(BACKEND); walk(path.join(BACKEND, '..', 'public'));
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// 10. Central, configurable event location
// ---------------------------------------------------------------------------
const original = fs.readFileSync(LOCATION_FILE, 'utf8');
const writeLocation = (obj) => fs.writeFileSync(LOCATION_FILE, JSON.stringify(obj));
const getLocation = async () => (await call('GET', '/api/event/location', undefined, false)).json.location;
const mailHtmlFor = async (ticketType = 'guys') => {
  const r = await create({ ticketType });
  await submitAndConfirm(r.json.booking.booking_id);
  return { mail: sentEmails[sentEmails.length - 1], booking: db.prepare('SELECT * FROM bookings WHERE booking_id=?').get(r.json.booking.booking_id) };
};

test('10a. Written venue says "behind Beirut Cafe" while the map pin and directions target Beirut Cafe itself', async () => {
  const loc = await getLocation();
  assert.equal(loc.confirmed, true);
  // written description
  assert.equal(loc.venueName, 'Adjirigano, behind Beirut Cafe');
  assert.equal(loc.displayText, 'Adjirigano, behind Beirut Cafe, Accra, Ghana');
  assert.match(loc.displayText, /behind Beirut Cafe/);
  // map pin + directions: the landmark itself, never "behind ..."
  const pinQuery = (u) => decodeURIComponent(u).replace(/.*[?&](q|query)=/, '').replace(/&output=embed$/, '');
  assert.equal(pinQuery(loc.embedUrl), 'Beirut Cafe, Adjirigano, Accra, Ghana');
  assert.equal(pinQuery(loc.directionsUrl), 'Beirut Cafe, Adjirigano, Accra, Ghana');
  assert.ok(!/behind/i.test(decodeURIComponent(loc.embedUrl)), 'the map pin must not target the "behind" description');
  assert.ok(!/behind/i.test(decodeURIComponent(loc.directionsUrl)));
  assert.ok(loc.directionsUrl.startsWith('https://www.google.com/maps/search/?api=1&query='));
  assert.match(loc.mapNote, /Beirut Cafe/);
  // no invented coordinates anywhere in the response
  assert.ok(!/-?\d{1,2}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/.test(JSON.stringify(loc)));
});

test('10b. Changing ONE file changes the venue everywhere (API, directions, PDFs, emails) with no restart', async () => {
  writeLocation({ confirmed: true, venueName: 'Zenith Rooftop', address: 'Osu, Accra', mapQuery: '', directionsUrl: '', embedUrl: '' });
  try {
    const loc = await getLocation();
    assert.equal(loc.venueName, 'Zenith Rooftop');
    assert.equal(loc.address, 'Osu, Accra');
    assert.ok(decodeURIComponent(loc.directionsUrl).includes('Zenith Rooftop, Osu, Accra'));
    assert.ok(decodeURIComponent(loc.embedUrl).includes('Zenith Rooftop, Osu, Accra'));
    assert.ok(!JSON.stringify(loc).includes('Adjirigano'));

    const { mail, booking } = await mailHtmlFor('guys');
    assert.ok(mail.html.includes('Zenith Rooftop, Osu, Accra'));
    assert.ok(!mail.html.includes('Adjirigano'));
    if (HAVE_PDFTOTEXT) {
      const t = db.prepare('SELECT ticket_pdf_path FROM attendee_tickets WHERE booking_id=?').get(booking.booking_id);
      const txt = pdfText(t.ticket_pdf_path).replace(/\s+/g, ' ');
      assert.ok(txt.includes('Zenith Rooftop, Osu, Accra'));
      assert.ok(!txt.includes('Adjirigano'));
    }
    // explicit link overrides are honoured only when they are https links
    writeLocation({ confirmed: true, venueName: 'Zenith Rooftop', address: 'Osu', directionsUrl: 'https://maps.app.goo.gl/abc123', embedUrl: 'https://www.google.com/maps/embed?pb=XYZ' });
    const o = await getLocation();
    assert.equal(o.directionsUrl, 'https://maps.app.goo.gl/abc123');
    assert.equal(o.embedUrl, 'https://www.google.com/maps/embed?pb=XYZ');
    writeLocation({ confirmed: true, venueName: 'Zenith Rooftop', address: 'Osu', directionsUrl: 'javascript:alert(1)', embedUrl: 'http://insecure.example' });
    const s = await getLocation();
    assert.ok(s.directionsUrl.startsWith('https://www.google.com/maps/search/'));
    assert.ok(s.embedUrl.startsWith('https://www.google.com/maps?q='));
  } finally {
    fs.writeFileSync(LOCATION_FILE, original);
  }
});

test('10c. An unconfirmed venue shows "Venue details coming soon." and no map / directions / address', async () => {
  writeLocation({ confirmed: false, venueName: 'Adjirigano, behind Beirut Cafe', address: 'Accra, Ghana' });
  try {
    const loc = await getLocation();
    assert.equal(loc.confirmed, false);
    assert.equal(loc.message, 'Venue details coming soon.');
    assert.equal(loc.displayText, 'Venue details coming soon.');
    assert.equal(loc.directionsUrl, null);
    assert.equal(loc.embedUrl, null);
    assert.equal(loc.venueName, '');
    assert.ok(!JSON.stringify(loc).includes('Adjirigano'), 'an unconfirmed venue must not leak to the public');

    const { mail, booking } = await mailHtmlFor('girls');
    assert.ok(mail.html.includes('Venue details coming soon.'));
    assert.ok(!mail.html.includes('Adjirigano'));
    if (HAVE_PDFTOTEXT) {
      const t = db.prepare('SELECT ticket_pdf_path FROM attendee_tickets WHERE booking_id=?').get(booking.booking_id);
      const txt = pdfText(t.ticket_pdf_path).replace(/\s+/g, ' ');
      assert.ok(txt.includes('Venue details coming soon.'));
      assert.ok(!txt.includes('Adjirigano'));
    }
    // custom message
    writeLocation({ confirmed: false, comingSoonMessage: 'Venue announced next week.' });
    assert.equal((await getLocation()).message, 'Venue announced next week.');
  } finally {
    fs.writeFileSync(LOCATION_FILE, original);
  }
});

test('10d. A missing or broken location file fails safe (coming soon), never a stale or wrong venue', async () => {
  fs.writeFileSync(LOCATION_FILE, '{ not valid json');
  try {
    assert.equal((await getLocation()).confirmed, false);
    fs.rmSync(LOCATION_FILE);
    assert.equal((await getLocation()).confirmed, false);
    writeLocation({ confirmed: true, venueName: '', address: '' }); // "confirmed" but nothing to show
    assert.equal((await getLocation()).confirmed, false);
  } finally {
    fs.writeFileSync(LOCATION_FILE, original);
  }
  assert.equal((await getLocation()).confirmed, true);
});

test('10e. The venue is not hardcoded anywhere in the website or backend code', () => {
  const offenders = [];
  const scan = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) {
        if (['node_modules', 'tests', 'database', 'tickets', 'exports', 'uploads'].includes(f.name)) continue;
        scan(p);
      } else if (/\.(js|html)$/.test(f.name)) {
        const src = fs.readFileSync(p, 'utf8');
        if (/Adjirigano|Beirut|Pera\s+lounge|East\s*legon/i.test(src)) offenders.push(path.relative(BACKEND, p));
      }
    }
  };
  scan(BACKEND);
  scan(path.join(BACKEND, '..', 'public'));
  assert.deepEqual(offenders, [], `venue text found outside config/event-location.json: ${offenders.join(', ')}`);
});

test('10f. Public pages carry no hardcoded ticket prices for the new categories', () => {
  const html = fs.readFileSync(path.join(BACKEND, '..', 'public', 'index.html'), 'utf8');
  assert.ok(!/TICKET_PRICES\s*=/.test(html), 'the old hardcoded price table must be gone from the browser code');
});

// ---------------------------------------------------------------------------
// Extra: older (pre-update) databases migrate cleanly and keep working
// ---------------------------------------------------------------------------
test('11. Bookings made under the retired categories can no longer be confirmed at old prices, but already-issued tickets still verify', async () => {
  // a pending "VIP" booking from the old system (no price snapshot)
  db.prepare(`INSERT INTO bookings (booking_id, reservation_id, ticket_id, guest_name, phone_number, email, ticket_type, quantity, amount_due, payment_status, momo_transaction_id, payment_reference)
              VALUES ('BK-LEGACY0001','RSV-LEGACY0001','TCK-LEGACY0001','Old Customer','0240000000','old@example.com','vip',1,300,'Pending','MPOLD1','MPOLD1')`).run();
  const c = await call('POST', '/api/admin/bookings/BK-LEGACY0001/confirm-payment', {});
  assert.equal(c.status, 409);
  assert.match(c.json.message, /retired/i);
  assert.equal(db.prepare("SELECT payment_status FROM bookings WHERE booking_id='BK-LEGACY0001'").get().payment_status, 'Pending');

  // an already-paid old ticket keeps working at the door and shows a readable label
  db.prepare(`INSERT INTO bookings (booking_id, reservation_id, ticket_id, guest_name, phone_number, email, ticket_type, quantity, amount_due, amount_paid, payment_status, momo_transaction_id, payment_reference)
              VALUES ('BK-LEGACY0002','RSV-LEGACY0002','TCK-LEGACY0002','Paid Old','0240000001','old2@example.com','regular',1,200,200,'Paid','MPOLD2','MPOLD2')`).run();
  const list = await call('GET', '/api/admin/bookings?q=BK-LEGACY0002');
  assert.equal(list.json.bookings[0].ticket_label, 'Regular Ticket (retired)');
  const ci = await call('POST', '/api/admin/checkin', { ticketId: 'TCK-LEGACY0002' });
  assert.equal(ci.status, 200);
  assert.equal(ci.json.ticketType, 'primary');
});

test('12. An existing (older) database upgrades in place without losing data', () => {
  const Database = require(path.join(BACKEND, 'node_modules', 'better-sqlite3'));
  const oldPath = path.join(tmp, 'old.db');
  const old = new Database(oldPath);
  // minimal copy of the OLD schema, including the table columns and foreign key
  old.exec(`
    CREATE TABLE tables_inventory (table_number TEXT PRIMARY KEY, package TEXT, price REAL, status TEXT);
    CREATE TABLE bookings (id INTEGER PRIMARY KEY AUTOINCREMENT, booking_id TEXT UNIQUE NOT NULL, reservation_id TEXT UNIQUE NOT NULL, ticket_id TEXT UNIQUE NOT NULL,
      guest_name TEXT NOT NULL, phone_number TEXT NOT NULL, email TEXT NOT NULL, ticket_type TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1,
      table_package TEXT, table_number TEXT, drink_choice TEXT, seats INTEGER, amount_due REAL NOT NULL DEFAULT 0, amount_paid REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GHS', payment_status TEXT NOT NULL DEFAULT 'Pending', payment_reference TEXT, momo_transaction_id TEXT,
      payment_method TEXT NOT NULL DEFAULT 'manual_momo', checked_in INTEGER NOT NULL DEFAULT 0, ticket_pdf_path TEXT, email_sent INTEGER NOT NULL DEFAULT 0,
      booking_date TEXT NOT NULL DEFAULT (datetime('now')), created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (table_number) REFERENCES tables_inventory (table_number));
    INSERT INTO bookings (booking_id,reservation_id,ticket_id,guest_name,phone_number,email,ticket_type,quantity,amount_due,amount_paid,payment_status)
      VALUES ('BK-OLD','RSV-OLD','TCK-OLD','Old Guest','0240000009','o@example.com','regular',2,400,400,'Paid');
  `);
  old.close();
  // run the real migration against it in a child process with its own DATABASE_PATH
  const out = execFileSync(process.execPath, ['-e', `
    process.env.DATABASE_PATH=${JSON.stringify(oldPath)};
    const { db, initSchema } = require(${JSON.stringify(path.join(BACKEND, 'database', 'db'))});
    initSchema();
    const cols = db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name);
    const row = db.prepare("SELECT guest_name, amount_paid, ticket_type FROM bookings WHERE booking_id='BK-OLD'").get();
    console.log(JSON.stringify({ cols: ['price_unit','unit_price'].every(c => cols.includes(c)), attendee: !!db.prepare("SELECT 1 FROM sqlite_master WHERE name='attendee_tickets'").get(), row }));
    // a new booking must insert fine even though the old FK/columns exist
    const B = require(${JSON.stringify(path.join(BACKEND, 'models', 'Booking'))});
    B.createBooking({ booking_id:'BK-NEW', reservation_id:'RSV-NEW', ticket_id:'TCK-NEW', guest_name:'New', phone_number:'0240000010', email:'n@example.com', ticket_type:'guys', quantity:1, amount_due:80, amount_paid:0, currency:'GHS', payment_status:'Pending', payment_reference:null, momo_transaction_id:null, payment_method:'manual_momo', price_unit:'person', unit_price:80 });
    console.log('INSERT_OK');
  `], { encoding: 'utf8', env: { ...process.env } });
  assert.match(out, /"cols":true/);
  assert.match(out, /"attendee":true/);
  assert.match(out, /"guest_name":"Old Guest","amount_paid":400/);
  assert.match(out, /INSERT_OK/);
});
