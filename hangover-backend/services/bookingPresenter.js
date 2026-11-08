const AttendeeTicket = require('../models/AttendeeTicket');
const { labelFor } = require('./pricingService');

/**
 * Adds display helpers to a raw bookings row for the admin panel and exports:
 *   ticket_label            readable ticket category (e.g. "Group of 6")
 *   attendee_total          number of individual attendee tickets issued (0 if none yet / legacy)
 *   attendee_checked_in     how many of those are checked in
 */
function present(booking) {
  if (!booking) return booking;
  const s = AttendeeTicket.summaryForBooking(booking.booking_id);
  return {
    ...booking,
    ticket_label: labelFor(booking.ticket_type),
    attendee_total: s.total,
    attendee_checked_in: s.checkedIn,
  };
}

const presentAll = (rows) => rows.map(present);

module.exports = { present, presentAll };
