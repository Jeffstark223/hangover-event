const { db } = require('../database/db');

function create(data) {
  db.prepare(`
    INSERT INTO free_tickets (
      booking_id, ticket_id, ticket_type, guest_name
    ) VALUES (
      @booking_id, @ticket_id, @ticket_type, @guest_name
    )
  `).run({
    booking_id: data.booking_id,
    ticket_id: data.ticket_id,
    ticket_type: 'table_free',
    guest_name: data.guest_name || 'Table Guest',
  });
  return getByTicketId(data.ticket_id);
}

function getByTicketId(ticketId) {
  return db.prepare(`SELECT * FROM free_tickets WHERE ticket_id = ?`).get(ticketId);
}

function listByBookingId(bookingId) {
  return db.prepare(`
    SELECT * FROM free_tickets
    WHERE booking_id = ?
    ORDER BY id ASC
  `).all(bookingId);
}

function setPdfPath(ticketId, pdfPath) {
  db.prepare(`
    UPDATE free_tickets
    SET ticket_pdf_path = ?, updated_at = datetime('now')
    WHERE ticket_id = ?
  `).run(pdfPath, ticketId);
}

function setCheckedIn(ticketId) {
  db.prepare(`
    UPDATE free_tickets
    SET checked_in = 1, checked_in_at = datetime('now'), updated_at = datetime('now')
    WHERE ticket_id = ?
  `).run(ticketId);
}

module.exports = {
  create,
  getByTicketId,
  listByBookingId,
  setPdfPath,
  setCheckedIn,
};
