const Booking = require('../models/Booking');
const AttendeeTicket = require('../models/AttendeeTicket');
const pdfService = require('./pdfService');
const { generateTicketId } = require('../utils/idGenerator');

/** True for bookings that produce one ticket per attendee (every booking made under the current categories). */
function usesAttendeeTickets(booking) {
  return !!booking && !!booking.price_unit;
}

/** A ticket ID that exists in neither bookings nor attendee_tickets. */
function uniqueTicketId() {
  let id;
  do {
    id = generateTicketId();
  } while (Booking.getByTicketId(id) || AttendeeTicket.getByTicketId(id));
  return id;
}

/**
 * Issues every attendee ticket for a paid booking (all-or-nothing in one DB
 * transaction), then renders one PDF per attendee. Idempotent: re-running only
 * creates what is missing, so a failed PDF run can be retried safely.
 *
 * Attendee #1 reuses the booking's primary ticket ID, so the booking's main PDF
 * (bookings.ticket_pdf_path) is attendee #1's ticket.
 */
async function issueAttendeeTickets(booking, { regeneratePdfs = false } = {}) {
  const total = Number(booking.quantity);
  let tickets = AttendeeTicket.ensureForBooking(booking, total, uniqueTicketId);

  for (const t of tickets) {
    if (regeneratePdfs || !t.ticket_pdf_path) {
      const pdfPath = await pdfService.generateAttendeeTicketPdf(t, booking);
      AttendeeTicket.setPdfPath(t.ticket_id, pdfPath);
      if (t.attendee_number === 1) Booking.setTicketPdfPath(booking.booking_id, pdfPath);
    }
  }
  tickets = AttendeeTicket.listByBookingId(booking.booking_id);
  return tickets;
}

module.exports = { usesAttendeeTickets, issueAttendeeTickets, uniqueTicketId };
