const Booking = require('../models/Booking');
const TableModel = require('../models/Table');
const tablesConfig = require('../config/tables.config');
const { generateBookingId, generateReservationId, generateTicketId, generatePaymentReference } = require('../utils/idGenerator');
const { ApiError, asyncHandler } = require('../utils/apiError');
const paystackService = require('../services/paystackService');

const PHONE_RE = /^[0-9+\-\s()]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateBookingInput(body) {
  const errors = [];
  if (!body.guestName || String(body.guestName).trim().length < 2) errors.push('guestName is required.');
  if (!body.phoneNumber || !PHONE_RE.test(body.phoneNumber)) errors.push('A valid phoneNumber is required.');
  if (!body.email || !EMAIL_RE.test(body.email)) errors.push('A valid email is required.');
  if (!body.ticketType || !tablesConfig.tickets[body.ticketType]) errors.push('ticketType must be "regular" or "vip".');
  if (body.tablePackage && !tablesConfig.packages.find((p) => p.key === body.tablePackage)) {
    errors.push('tablePackage is invalid.');
  }
  if (body.tablePackage && !body.tableNumber) errors.push('tableNumber is required when tablePackage is set.');
  return errors;
}

/**
 * POST /api/bookings
 * Creates a pending booking, claims the table (if any) atomically,
 * generates the three booking identifiers, and kicks off a paystack
 * checkout session. The booking only becomes "Paid" once the paystack
 * callback confirms payment (see paymentController).
 */
const createBooking = asyncHandler(async (req, res) => {
  const errors = validateBookingInput(req.body);
  if (errors.length) throw new ApiError(422, 'Invalid booking details.', errors);

  const { guestName, phoneNumber, email, ticketType, quantity = 1, tablePackage, tableNumber, drinkChoice, seats } = req.body;

  const ticketDef = tablesConfig.tickets[ticketType];
  let amount = ticketDef.price * Number(quantity || 1);

  let claimedTable = null;
  if (tablePackage && tableNumber) {
    const tableRow = TableModel.getTable(tableNumber);
    if (!tableRow || tableRow.package !== tablePackage) {
      throw new ApiError(404, `Table ${tableNumber} does not exist in the ${tablePackage} package.`);
    }
    if (tableRow.status !== 'Available') {
      throw new ApiError(409, `Table ${tableNumber} is no longer available. Please choose another table.`);
    }
    amount += Number(tableRow.price);
    claimedTable = tableRow;
  }

  // Generate unique IDs, retrying on the extremely unlikely event of collision.
  let bookingId, reservationId, ticketId;
  for (let attempt = 0; attempt < 5; attempt++) {
    bookingId = generateBookingId();
    reservationId = generateReservationId();
    ticketId = generateTicketId();
    const clash =
      Booking.getByBookingId(bookingId) || Booking.getByReservationId(reservationId) || Booking.getByTicketId(ticketId);
    if (!clash) break;
  }

  const paymentReference = generatePaymentReference();

  // Reserve the table first (atomic) so two guests can never win the
  // same table, then create the booking row.
  if (claimedTable) {
    const claimed = TableModel.reserveTable(tableNumber, { bookingId, guestName });
    if (!claimed) {
      throw new ApiError(409, `Table ${tableNumber} was just booked by someone else. Please choose another table.`);
    }
  }

  let booking;
  try {
    booking = Booking.createBooking({
      booking_id: bookingId,
      reservation_id: reservationId,
      ticket_id: ticketId,
      guest_name: guestName.trim(),
      phone_number: phoneNumber.trim(),
      email: email.trim().toLowerCase(),
      ticket_type: ticketType,
      quantity: Number(quantity || 1),
      table_package: tablePackage || null,
      table_number: tableNumber || null,
      drink_choice: drinkChoice || null,
      seats: seats ? Number(seats) : tablePackage ? 1 : Number(quantity || 1),
      amount_paid: 0,
      currency: 'GHS',
      payment_status: 'Pending',
      payment_reference: paymentReference,
    });
  } catch (err) {
    // Roll back the table claim if booking creation somehow failed.
    if (claimedTable) TableModel.releaseTable(tableNumber);
    throw err;
  }

  Booking.recordPaymentEvent(bookingId, 'initiated', { amount, paymentReference });

  // Attempt to start the paystack checkout. If paystack isn't configured
  // yet, we still return the booking so the frontend can show a
  // "payment temporarily unavailable" state instead of a hard crash.
  let checkout = null;
  try {
    checkout = await paystackService.initiateCheckout({
      paymentReference,
      amount,
      description: `HANGOVER — ${ticketDef.label}${tableNumber ? ` + Table ${tableNumber}` : ''}`,
      customerName: guestName,
      customerPhone: phoneNumber,
      customerEmail: email,
    });
  } catch (err) {
    checkout = { error: err.message };
  }

  res.status(201).json({
    success: true,
    message: 'Booking created. Redirect the guest to the paystack checkout URL to complete payment.',
    booking: { ...booking, amount_due: amount },
    payment: checkout,
  });
});

/** GET /api/bookings/:bookingId */
const getBooking = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  res.json({ success: true, booking });
});

/** GET /api/bookings/verify/:ticketId — public ticket lookup (no sensitive admin actions) */
const verifyTicket = asyncHandler(async (req, res) => {
  const booking = Booking.getByTicketId(req.params.ticketId);
  if (!booking) throw new ApiError(404, 'Ticket not found.');
  res.json({
    success: true,
    ticket: {
      ticketId: booking.ticket_id,
      guestName: booking.guest_name,
      ticketType: booking.ticket_type,
      paymentStatus: booking.payment_status,
      checkedIn: !!booking.checked_in,
    },
  });
});

module.exports = { createBooking, getBooking, verifyTicket };
