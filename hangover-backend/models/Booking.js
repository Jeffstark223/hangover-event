const { db } = require('../database/db');

function createBooking(data) {
  const stmt = db.prepare(`
    INSERT INTO bookings (
      booking_id, reservation_id, ticket_id,
      guest_name, phone_number, email,
      ticket_type, quantity,
      table_package, table_number, drink_choice, seats,
      amount_due, amount_paid, currency, payment_status, payment_reference,
      momo_transaction_id, payment_method
    ) VALUES (
      @booking_id, @reservation_id, @ticket_id,
      @guest_name, @phone_number, @email,
      @ticket_type, @quantity,
      @table_package, @table_number, @drink_choice, @seats,
      @amount_due, @amount_paid, @currency, @payment_status, @payment_reference,
      @momo_transaction_id, @payment_method
    )
  `);
  stmt.run(data);
  return getByBookingId(data.booking_id);
}

function getByBookingId(bookingId) {
  return db.prepare(`SELECT * FROM bookings WHERE booking_id = ?`).get(bookingId);
}

function getByTicketId(ticketId) {
  return db.prepare(`SELECT * FROM bookings WHERE ticket_id = ?`).get(ticketId);
}

function getFreeTickets(bookingId) {
  return db.prepare(`
    SELECT * FROM free_tickets
    WHERE booking_id = ?
    ORDER BY id ASC
  `).all(bookingId);
}

function getByReservationId(reservationId) {
  return db.prepare(`SELECT * FROM bookings WHERE reservation_id = ?`).get(reservationId);
}

function getByPaymentReference(reference) {
  return db.prepare(`SELECT * FROM bookings WHERE payment_reference = ?`).get(reference);
}

function submitMomoTransaction(bookingId, transactionId) {
  db.prepare(
    `UPDATE bookings
     SET momo_transaction_id = ?,
         payment_reference = ?,
         updated_at = datetime('now')
     WHERE booking_id = ?`
  ).run(transactionId, transactionId, bookingId);
}

function confirmManualPayment(bookingId, amountPaid) {
  db.prepare(
    `UPDATE bookings
     SET payment_status = 'Paid',
         amount_paid = ?,
         updated_at = datetime('now')
     WHERE booking_id = ?`
  ).run(amountPaid, bookingId);
}

function setPaymentStatus(bookingId, status, amountPaid) {
  db.prepare(
    `UPDATE bookings
     SET payment_status = @status,
         amount_paid = COALESCE(@amount_paid, amount_paid),
         updated_at = datetime('now')
     WHERE booking_id = @booking_id`
  ).run({ booking_id: bookingId, status, amount_paid: amountPaid ?? null });
}

function setTicketPdfPath(bookingId, ticketPdfPath) {
  db.prepare(
    `UPDATE bookings SET ticket_pdf_path = ?, updated_at = datetime('now') WHERE booking_id = ?`
  ).run(ticketPdfPath, bookingId);
}

function setEmailSent(bookingId, sent = true) {
  db.prepare(
    `UPDATE bookings SET email_sent = ?, updated_at = datetime('now') WHERE booking_id = ?`
  ).run(sent ? 1 : 0, bookingId);
}

function setCheckedIn(ticketId) {
  db.prepare(
    `UPDATE bookings
     SET checked_in = 1, checked_in_at = datetime('now'), updated_at = datetime('now')
     WHERE ticket_id = ?`
  ).run(ticketId);
}

function listBookings({ limit = 100, offset = 0 } = {}) {
  return db
    .prepare(`SELECT * FROM bookings ORDER BY datetime(booking_date) DESC LIMIT ? OFFSET ?`)
    .all(limit, offset);
}

function search(query) {
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT * FROM bookings
       WHERE guest_name LIKE ?
          OR phone_number LIKE ?
          OR email LIKE ?
          OR ticket_id LIKE ?
          OR booking_id LIKE ?
          OR reservation_id LIKE ?
       ORDER BY datetime(booking_date) DESC
       LIMIT 200`
    )
    .all(like, like, like, like, like, like);
}

function getLatestByPhone(phoneNumber) {
  return db
    .prepare(`
      SELECT * FROM bookings
      WHERE phone_number = ?
      ORDER BY datetime(booking_date) DESC, rowid DESC
      LIMIT 1
    `)
    .get(phoneNumber);
}

function stats() {
  const totalTickets = db
    .prepare(`SELECT COALESCE(SUM(quantity),0) AS n FROM bookings WHERE payment_status = 'Paid'`)
    .get().n;
  const totalTablesReserved = db
    .prepare(`SELECT COUNT(*) AS n FROM tables_inventory WHERE status = 'Reserved'`)
    .get().n;
  const totalRevenue = db
    .prepare(`SELECT COALESCE(SUM(amount_paid),0) AS n FROM bookings WHERE payment_status = 'Paid'`)
    .get().n;
  const checkedIn = db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE checked_in = 1`).get().n;

  return { totalTickets, totalTablesReserved, totalRevenue, checkedIn };
}

function recordPaymentEvent(bookingId, eventType, rawPayload) {
  db.prepare(
    `INSERT INTO payment_events (booking_id, event_type, raw_payload) VALUES (?, ?, ?)`
  ).run(bookingId, eventType, typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload || {}));
}

module.exports = {
  createBooking,
  getByBookingId,
  getByTicketId,
  getFreeTickets,
  getByReservationId,
  getByPaymentReference,
  setPaymentStatus,
  submitMomoTransaction,
  confirmManualPayment,
  setTicketPdfPath,
  setEmailSent,
  setCheckedIn,
  listBookings,
  search,
  stats,
  recordPaymentEvent,
  getLatestByPhone,
};
