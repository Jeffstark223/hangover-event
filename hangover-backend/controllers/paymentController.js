const Booking = require('../models/Booking');
const { ApiError, asyncHandler } = require('../utils/apiError');

const TRANSACTION_RE = /^[A-Za-z0-9._\-\/]{3,100}$/;

/**
 * Customer submits the Mobile Money transaction ID after paying manually.
 * This does NOT mark the booking as paid. An organizer must verify the
 * transaction in the appropriate MoMo account first.
 */
const submitMomoPayment = asyncHandler(async (req, res) => {
  const { bookingId, transactionId } = req.body;

  if (!bookingId || !transactionId) {
    throw new ApiError(400, 'Booking ID and Mobile Money transaction ID are required.');
  }

  const cleanTransactionId = String(transactionId).trim();

  if (!TRANSACTION_RE.test(cleanTransactionId)) {
    throw new ApiError(422, 'Enter a valid Mobile Money transaction ID.');
  }

  const booking = Booking.getByBookingId(String(bookingId).trim());

  if (!booking) throw new ApiError(404, 'Booking not found.');

  if (booking.payment_status === 'Paid') {
    return res.json({
      success: true,
      message: 'This booking has already been confirmed.',
      bookingId: booking.booking_id,
      paymentStatus: booking.payment_status,
      ticketId: booking.ticket_id,
    });
  }

  if (booking.payment_status === 'Cancelled') {
    throw new ApiError(409, 'This booking has been cancelled.');
  }

  Booking.submitMomoTransaction(booking.booking_id, cleanTransactionId);

  Booking.recordPaymentEvent(booking.booking_id, 'momo_submitted', {
    transactionId: cleanTransactionId,
    destinationType: booking.table_number ? 'table' : 'ticket',
  });

  res.json({
    success: true,
    message: 'Payment submitted. Your transaction will be verified by the event team before your ticket is issued.',
    bookingId: booking.booking_id,
    paymentStatus: 'Pending',
  });
});

/**
 * Customer-facing status check while waiting for manual verification.
 */
const paymentStatus = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);

  if (!booking) throw new ApiError(404, 'Booking not found.');

  res.json({
    success: true,
    bookingId: booking.booking_id,
    paymentStatus: booking.payment_status,
    ticketId: booking.ticket_id,
    ticketAvailable: booking.payment_status === 'Paid' && !!booking.ticket_pdf_path,
  });
});

module.exports = {
  submitMomoPayment,
  paymentStatus,
};
