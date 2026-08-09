const Booking = require('../models/Booking');
const TableModel = require('../models/Table');
const tablesConfig = require('../config/tables.config');
const FreeTicket = require('../models/FreeTicket');
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

  if (
    !body.guestName ||
    String(body.guestName).trim().length < 2
  ) {
    errors.push('guestName is required.');
  }

  if (
    !body.phoneNumber ||
    !PHONE_RE.test(body.phoneNumber)
  ) {
    errors.push('A valid phoneNumber is required.');
  }

  if (
    !body.email ||
    !EMAIL_RE.test(body.email)
  ) {
    errors.push('A valid email is required.');
  }

  if (
    !body.ticketType ||
    !tablesConfig.tickets[body.ticketType]
  ) {
    errors.push(
      'ticketType must be "regular" or "vip".'
    );
  }

  if (
    body.tablePackage &&
    !tablesConfig.packages.find(
      (p) => p.key === body.tablePackage
    )
  ) {
    errors.push('tablePackage is invalid.');
  }

  if (
    body.tablePackage &&
    !body.tableNumber
  ) {
    errors.push(
      'tableNumber is required when tablePackage is set.'
    );
  }

  return errors;
}

/**
 * POST /api/bookings
 *
 * Creates a pending booking, claims the table (if any)
 * atomically, generates the booking identifiers, and
 * returns the correct manual Mobile Money payment destination.
 *
 * The booking only becomes "Paid" after an organizer
 * verifies the customer's transaction ID.
 */
const createBooking = asyncHandler(async (req, res) => {
  const errors = validateBookingInput(req.body);

  if (errors.length) {
    throw new ApiError(
      422,
      'Invalid booking details.',
      errors
    );
  }

  const {
    guestName,
    phoneNumber,
    email,
    ticketType,
    quantity = 1,
    tablePackage,
    tableNumber,
    drinkChoice,
    seats,
  } = req.body;

  const ticketDef =
    tablesConfig.tickets[ticketType];

  let amount =
    ticketDef.price * Number(quantity || 1);

  let includedTickets = 0;

  let claimedTable = null;

  if (tablePackage && tableNumber) {
    const tableRow =
      TableModel.getTable(tableNumber);

    if (
      !tableRow ||
      tableRow.package !== tablePackage
    ) {
      throw new ApiError(
        404,
        `Table ${tableNumber} does not exist in the ${tablePackage} package.`
      );
    }

    if (tableRow.status !== 'Available') {
      throw new ApiError(
        409,
        `Table ${tableNumber} is no longer available. Please choose another table.`
      );
    }

    // Table reservation price already covers
    // the included free tickets.
    amount = Number(tableRow.price);

    includedTickets = Number(
      (
        tablesConfig.packages.find(
          (p) => p.key === tablePackage
        ) || {}
      ).freeTickets || 0
    );

    claimedTable = tableRow;
  }

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
      Booking.getByTicketId(ticketId);

    if (!clash) {
      break;
    }
  }

  // Reserve the table first.
  if (claimedTable) {
    const claimed =
      TableModel.reserveTable(
        tableNumber,
        {
          bookingId,
          guestName,
        }
      );

    if (!claimed) {
      throw new ApiError(
        409,
        `Table ${tableNumber} was just booked by someone else. Please choose another table.`
      );
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
      seats: seats
        ? Number(seats)
        : tablePackage
          ? includedTickets
          : Number(quantity || 1),
      amount_due: amount,
      amount_paid: 0,
      currency: 'GHS',
      payment_status: 'Pending',
      payment_reference: null,
      momo_transaction_id: null,
      payment_method: 'manual_momo',
    });
  } catch (err) {
    // Roll back table claim if booking creation failed.
    if (claimedTable) {
      TableModel.releaseTable(tableNumber);
    }

    throw err;
  }

  const destination =
    tablePackage
      ? tablesConfig.momo.table
      : tablesConfig.momo.ticket;

  const destinationType =
    tablePackage ? 'table' : 'ticket';

  Booking.recordPaymentEvent(
    bookingId,
    'initiated',
    {
      amount,
      destinationType,
    }
  );

  res.status(201).json({
    success: true,

    message:
      'Booking created. Complete the Mobile Money payment and submit the transaction ID for verification.',

    booking: {
      ...booking,
      amount_due: amount,
      included_free_tickets: includedTickets,
    },

    payment: {
      method: 'manual_momo',
      destinationType,
      amount,
      network: destination.network,
      number: destination.number,
      accountName: destination.name,
      includedFreeTickets: includedTickets,
    },
  });
});


/**
 * GET /api/bookings/:bookingId?phoneNumber=...
 */
const getBooking = asyncHandler(async (req, res) => {
  const booking =
    Booking.getByBookingId(
      String(req.params.bookingId).trim()
    );

  if (!booking) {
    throw new ApiError(
      404,
      'Booking not found.'
    );
  }

  const phoneNumber =
    String(
      req.query.phoneNumber || ''
    ).trim();

  if (!phoneNumber) {
    throw new ApiError(
      400,
      'Phone number is required.'
    );
  }

  const normalizePhone = (value) =>
    String(value).replace(
      /[\s-()]/g,
      ''
    );

  if (
    normalizePhone(phoneNumber) !==
    normalizePhone(booking.phone_number)
  ) {
    throw new ApiError(
      404,
      'No booking found with those details.'
    );
  }

  res.json({
    success: true,

    booking: {
      bookingId: booking.booking_id,
      ticketId: booking.ticket_id,
      guestName: booking.guest_name,
      ticketType: booking.ticket_type,
      quantity: booking.quantity,
      amountDue: booking.amount_due,
      amountPaid: booking.amount_paid,
      paymentStatus: booking.payment_status,

      ticketAvailable:
        booking.payment_status === 'Paid' &&
        !!booking.ticket_pdf_path,
    },
  });
});


/**
 * GET /api/bookings/verify/:ticketId
 *
 * Public verification for paid tickets and
 * included free tickets.
 */
const verifyTicket = asyncHandler(async (req, res) => {
  const id =
    String(req.params.ticketId).trim();

  const booking =
    Booking.getByTicketId(id);

  if (booking) {
    return res.json({
      success: true,

      ticket: {
        ticketId: booking.ticket_id,
        guestName: booking.guest_name,
        ticketType: booking.ticket_type,
        paymentStatus: booking.payment_status,
        checkedIn: !!booking.checked_in,
        freeTicket: false,
      },
    });
  }

  const freeTicket =
    FreeTicket.getByTicketId(id);

  if (!freeTicket) {
    throw new ApiError(
      404,
      'Ticket not found.'
    );
  }

  const parent =
    Booking.getByBookingId(
      freeTicket.booking_id
    );

  if (
    !parent ||
    parent.payment_status !== 'Paid'
  ) {
    throw new ApiError(
      409,
      'This free ticket is not active because its table reservation is not paid.'
    );
  }

  res.json({
    success: true,

    ticket: {
      ticketId: freeTicket.ticket_id,
      guestName: freeTicket.guest_name,
      ticketType: 'table_free',
      paymentStatus: parent.payment_status,
      checkedIn: !!freeTicket.checked_in,
      freeTicket: true,
      tableReservationId:
        parent.reservation_id,
    },
  });
});


/**
 * POST /api/bookings/retrieve
 *
 * Customer can retrieve a booking using
 * Booking ID or phone number.
 */
const retrieveBooking = asyncHandler(async (req, res) => {
  const identifier =
    String(
      req.body.identifier || ''
    ).trim();

  if (!identifier) {
    throw new ApiError(
      400,
      'Enter your Booking ID or phone number.'
    );
  }

  let booking = null;

  // Booking ID
  if (/^BK-/i.test(identifier)) {
    booking =
      Booking.getByBookingId(
        identifier
      );
  } else {
    // Phone number
    const cleanPhone =
      identifier.replace(
        /[^\d+]/g,
        ''
      );

    booking =
      Booking.getLatestByPhone(
        cleanPhone
      );
  }

  if (!booking) {
    throw new ApiError(
      404,
      'No booking was found with those details.'
    );
  }

  // Get all free tickets belonging
  // to this table reservation.
  const freeTickets =
    FreeTicket.listByBookingId(
      booking.booking_id
    );

  res.json({
    success: true,

    booking: {
      bookingId: booking.booking_id,
      ticketId: booking.ticket_id,
      guestName: booking.guest_name,
      ticketType: booking.ticket_type,
      quantity: booking.quantity,
      amountDue: booking.amount_due,
      paymentStatus: booking.payment_status,

      ticketAvailable:
        booking.payment_status === 'Paid' &&
        !!booking.ticket_pdf_path,

      freeTickets:
        freeTickets.map((ticket) => ({
          ticketId: ticket.ticket_id,
          ticketType: ticket.ticket_type,
          guestName: ticket.guest_name,

          ticketAvailable:
            booking.payment_status === 'Paid' &&
            !!ticket.ticket_pdf_path,
        })),
    },
  });
});


module.exports = {
  createBooking,
  getBooking,
  verifyTicket,
  retrieveBooking,
};