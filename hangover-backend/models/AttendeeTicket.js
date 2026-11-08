const { db } = require('../database/db');

function getByTicketId(ticketId) {
  return db.prepare(`SELECT * FROM attendee_tickets WHERE ticket_id = ?`).get(ticketId);
}

function listByBookingId(bookingId) {
  return db
    .prepare(`SELECT * FROM attendee_tickets WHERE booking_id = ? ORDER BY attendee_number ASC`)
    .all(bookingId);
}

/** { total, checkedIn } for one booking — used by admin lists and exports. */
function summaryForBooking(bookingId) {
  return db
    .prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(checked_in), 0) AS checkedIn
       FROM attendee_tickets WHERE booking_id = ?`
    )
    .get(bookingId);
}

/**
 * Creates every missing attendee ticket for a booking in ONE transaction, so a
 * group is always issued all-or-nothing. `ticketIds` is a function that returns a
 * fresh globally-unique ticket ID. Attendee #1 re-uses the booking's primary
 * ticket ID; all others get new IDs. Safe to call repeatedly (idempotent).
 */
const ensureForBooking = db.transaction((booking, total, ticketIds) => {
  const existing = listByBookingId(booking.booking_id);
  const have = new Set(existing.map((t) => t.attendee_number));
  const insert = db.prepare(`
    INSERT INTO attendee_tickets
      (booking_id, ticket_id, attendee_number, attendee_total, ticket_category, guest_name)
    VALUES (@booking_id, @ticket_id, @attendee_number, @attendee_total, @ticket_category, @guest_name)
  `);
  for (let n = 1; n <= total; n++) {
    if (have.has(n)) continue;
    insert.run({
      booking_id: booking.booking_id,
      ticket_id: n === 1 ? booking.ticket_id : ticketIds(),
      attendee_number: n,
      attendee_total: total,
      ticket_category: booking.ticket_type,
      guest_name: booking.guest_name,
    });
  }
  return listByBookingId(booking.booking_id);
});

function setPdfPath(ticketId, pdfPath) {
  db.prepare(
    `UPDATE attendee_tickets SET ticket_pdf_path = ?, updated_at = datetime('now') WHERE ticket_id = ?`
  ).run(pdfPath, ticketId);
}

/**
 * Atomic check-in: returns true only for the single request that flips the
 * ticket from not-checked-in to checked-in (protects against double scans).
 */
function checkIn(ticketId) {
  const r = db
    .prepare(
      `UPDATE attendee_tickets
       SET checked_in = 1, checked_in_at = datetime('now'), updated_at = datetime('now')
       WHERE ticket_id = ? AND checked_in = 0`
    )
    .run(ticketId);
  return r.changes === 1;
}

module.exports = { getByTicketId, listByBookingId, summaryForBooking, ensureForBooking, setPdfPath, checkIn };
