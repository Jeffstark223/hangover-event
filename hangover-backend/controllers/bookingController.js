const path = require('path');
const Booking = require('../models/Booking');
const AttendeeTicket = require('../models/AttendeeTicket');
const pricingService = require('../services/pricingService');
const paymentConfig = require('../config/payment.config');
const {
  generateBookingId,
  generateReservationId,
  generateTicketId,
} = require('../utils/idGenerator');
const { ApiError, asyncHandler } = require('../utils/apiError');

const PHONE_RE = /^[0-9+-\s()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBookingInput(body) {
  const errors = [];

  if (typeof body.guestName !== 'string' || body.guestName.trim().length < 2) {
    errors.push('guestName is required.');
  }
  if (typeof body.phoneNumber !== 'string' || !PHONE_RE.test(body.phoneNumber)) {
    errors.push('A valid phoneNumber is required.');
  }
  if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) {
    errors.push('A valid email is required.');
  }
  // ticketType + quantity are validated and priced by pricingService.quote().
  return errors;
}

/**
 * POST /api/bookings
 *
 * Creates a pending booking and returns the manual Mobile Money payment
 * instructions. The amount is calculated ONLY on the server from the ticket
 * category and quantity (config/tickets.config.js); any price sent by the
 * browser is ignored. The booking becomes "Paid" only after an administrator
 * confirms the transaction, and tickets are generated only at that point.
 */
const createBooking = asyncHandler(async (req, res) => {
  const errors = validateBookingInput(req.body);
  if (errors.length) {
    throw new ApiError(422, 'Invalid booking details.', errors);
  }

  const { guestName, phoneNumber, email, ticketType, quantity } = req.body;
  const pricing = pricingService.quote(ticketType, quantity);

  // Generate unique IDs.
  let bookingId;
  let reservationId;
  let ticketId;
  for (let attempt = 0; attempt < 5; attempt++) {
    bookingId = generateBookingId();
    reservationId = generateReservationId();
    ticketId = generateTicketId();

    const clash =
      Booking.getByBookingId(bookingId) ||
      Booking.getByReservationId(reservationId) ||
      Booking.getByTicketId(ticketId) ||
      AttendeeTicket.getByTicketId(ticketId);
    if (!clash) break;
  }

  const booking = Booking.createBooking({
    booking_id: bookingId,
    reservation_id: reservationId,
    ticket_id: ticketId,
    guest_name: guestName.trim(),
    phone_number: phoneNumber.trim(),
    email: email.trim().toLowerCase(),
    ticket_type: pricing.ticketType,
    // quantity = number of people admitted (6 for a Group of 6).
    quantity: pricing.attendees,
    amount_due: pricing.amount,
    amount_paid: 0,
    currency: 'GHS',
    payment_status: 'Pending',
    payment_reference: null,
    momo_transaction_id: null,
    payment_method: 'manual_momo',
    // Price snapshot: lets the backend re-validate the amount at confirmation.
    price_unit: pricing.pricingUnit,
    unit_price: pricing.unitPrice,
  });

  const destination = paymentConfig.momo.ticket;

  Booking.recordPaymentEvent(bookingId, 'initiated', {
    amount: pricing.amount,
    ticketType: pricing.ticketType,
    pricingUnit: pricing.pricingUnit,
    unitPrice: pricing.unitPrice,
    attendees: pricing.attendees,
  });

  res.status(201).json({
    success: true,
    message:
      'Booking created. Complete the Mobile Money payment and submit the transaction ID for verification.',
    booking,
    payment: {
      method: 'manual_momo',
      amount: pricing.amount,
      network: destination.network,
      number: destination.number,
      accountName: destination.name,
      ticketCategory: pricing.ticketType,
      ticketLabel: pricing.label,
      pricingUnit: pricing.pricingUnit,
      unitPrice: pricing.unitPrice,
      attendees: pricing.attendees,
    },
  });
});

/**
 * GET /api/bookings/:bookingId?phoneNumber=...
 */
const getBooking = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(String(req.params.bookingId).trim());
  if (!booking) throw new ApiError(404, 'Booking not found.');

  const phoneNumber = String(req.query.phoneNumber || '').trim();
  if (!phoneNumber) throw new ApiError(400, 'Phone number is required.');

  const normalizePhone = (value) => String(value).replace(/[\s-()]/g, '');
  if (normalizePhone(phoneNumber) !== normalizePhone(booking.phone_number)) {
    throw new ApiError(404, 'No booking found with those details.');
  }

  res.json({
    success: true,
    booking: {
      bookingId: booking.booking_id,
      ticketId: booking.ticket_id,
      guestName: booking.guest_name,
      ticketType: booking.ticket_type,
      ticketLabel: pricingService.labelFor(booking.ticket_type),
      quantity: booking.quantity,
      amountDue: booking.amount_due,
      amountPaid: booking.amount_paid,
      paymentStatus: booking.payment_status,
      ticketAvailable: booking.payment_status === 'Paid' && !!booking.ticket_pdf_path,
    },
  });
});

/**
 * GET /api/bookings/verify/:ticketId
 * Public verification of one ticket by its own ID.
 */
const verifyTicket = asyncHandler(async (req, res) => {
  const id = String(req.params.ticketId).trim();

  // Individual attendee tickets first (attendee #1 shares its ID with the booking's main ticket).
  const attendee = AttendeeTicket.getByTicketId(id);
  if (attendee) {
    const parent = Booking.getByBookingId(attendee.booking_id);
    if (!parent || parent.payment_status !== 'Paid') {
      throw new ApiError(409, 'This ticket is not active because its booking is not paid.');
    }
    return res.json({
      success: true,
      ticket: {
        ticketId: attendee.ticket_id,
        guestName: attendee.guest_name,
        ticketType: attendee.ticket_category,
        ticketLabel: pricingService.labelFor(attendee.ticket_category),
        paymentStatus: parent.payment_status,
        checkedIn: !!attendee.checked_in,
        attendeeNumber: attendee.attendee_number,
        attendeeTotal: attendee.attendee_total,
      },
    });
  }

  // Tickets issued by older versions (single ticket per booking).
  const booking = Booking.getByTicketId(id);
  if (!booking) throw new ApiError(404, 'Ticket not found.');

  res.json({
    success: true,
    ticket: {
      ticketId: booking.ticket_id,
      guestName: booking.guest_name,
      ticketType: booking.ticket_type,
      ticketLabel: pricingService.labelFor(booking.ticket_type),
      paymentStatus: booking.payment_status,
      checkedIn: !!booking.checked_in,
    },
  });
});

/**
 * POST /api/bookings/retrieve
 * A customer retrieves a booking using the Booking ID or phone number.
 */
const retrieveBooking = asyncHandler(async (req, res) => {
  const identifier = String(req.body.identifier || '').trim();
  if (!identifier) throw new ApiError(400, 'Enter your Booking ID or phone number.');

  let booking = null;
  if (/^BK-/i.test(identifier)) {
    booking = Booking.getByBookingId(identifier);
  } else {
    booking = Booking.getLatestByPhone(identifier.replace(/[^\d+]/g, ''));
  }
  if (!booking) throw new ApiError(404, 'No booking was found with those details.');

  const attendeeTickets = AttendeeTicket.listByBookingId(booking.booking_id);

  res.json({
    success: true,
    booking: {
      bookingId: booking.booking_id,
      ticketId: booking.ticket_id,
      guestName: booking.guest_name,
      ticketType: booking.ticket_type,
      ticketLabel: pricingService.labelFor(booking.ticket_type),
      pricingUnit: booking.price_unit || null,
      unitPrice: booking.unit_price ?? null,
      quantity: booking.quantity,
      amountDue: booking.amount_due,
      paymentStatus: booking.payment_status,
      ticketAvailable: booking.payment_status === 'Paid' && !!booking.ticket_pdf_path,
      attendeeTickets: attendeeTickets.map((ticket) => ({
        ticketId: ticket.ticket_id,
        attendeeNumber: ticket.attendee_number,
        attendeeTotal: ticket.attendee_total,
        ticketAvailable: booking.payment_status === 'Paid' && !!ticket.ticket_pdf_path,
      })),
    },
  });
});

/**
 * GET /api/bookings/attendee-ticket/:ticketId
 * Downloads one attendee's ticket PDF (only once the booking is paid).
 */
const downloadAttendeeTicket = asyncHandler(async (req, res) => {
  const ticket = AttendeeTicket.getByTicketId(String(req.params.ticketId).trim());
  if (!ticket) return res.status(404).send('Ticket not found');

  const parent = Booking.getByBookingId(ticket.booking_id);
  if (!parent || parent.payment_status !== 'Paid') {
    return res.status(409).send('This ticket is not active because its booking is not paid');
  }
  if (!ticket.ticket_pdf_path) return res.status(404).send('Ticket has not been generated yet');

  res.download(path.resolve(ticket.ticket_pdf_path));
});

module.exports = {
  createBooking,
  getBooking,
  verifyTicket,
  retrieveBooking,
  downloadAttendeeTicket,
};
