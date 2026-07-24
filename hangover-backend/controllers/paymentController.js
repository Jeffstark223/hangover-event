const Booking = require('../models/Booking');
const TableModel = require('../models/Table');
const { ApiError, asyncHandler } = require('../utils/apiError');
const paystackService = require('../services/paystackService');
const pdfService = require('../services/pdfService');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');

/**
 * POST /api/payments/paystack/callback
 *
 * paystack calls this URL after a payment attempt completes. We never
 * trust the callback body alone — we re-verify the transaction against
 * paystack's status API before marking a booking Paid. Until that
 * integration is live (see services/paystackService.js), this route
 * safely records the callback and leaves the booking Pending rather
 * than granting a free ticket.
 */
const paystackCallback = asyncHandler(async (req, res) => {
  const payload = req.body || {};

  // Field names below are placeholders — adjust to the real paystack
  // callback schema once confirmed against their docs/sandbox.
  const paymentReference = payload.ClientReference || payload.clientReference;
  const checkoutId = payload.CheckoutId || payload.checkoutId;
  const providerStatus = (payload.Status || payload.status || '').toString().toLowerCase();

  if (!paymentReference) {
    throw new ApiError(400, 'Callback missing client reference.');
  }

  const booking = Booking.getByPaymentReference(paymentReference);
  if (!booking) {
    logger.warn(`paystack callback for unknown payment reference: ${paymentReference}`);
    // Respond 200 so paystack doesn't endlessly retry a reference we'll never recognize.
    return res.status(200).json({ success: true, message: 'Acknowledged.' });
  }

  Booking.recordPaymentEvent(booking.booking_id, 'callback', payload);

  if (booking.payment_status === 'Paid') {
    // Already processed (paystack may retry callbacks) — acknowledge idempotently.
    return res.status(200).json({ success: true, message: 'Already processed.' });
  }

  const verification = await paystackService.verifyTransaction({ checkoutId, paymentReference });
  Booking.recordPaymentEvent(booking.booking_id, 'verified', verification);

  const paymentSucceeded = verification.verified === true || providerStatus === 'success';

  if (!paymentSucceeded) {
    Booking.setPaymentStatus(booking.booking_id, 'Failed');
    if (booking.table_number) TableModel.releaseTable(booking.table_number);
    return res.status(200).json({ success: true, message: 'Payment not confirmed; booking marked Failed.' });
  }

  const amountPaid = verification.amount ?? booking.amount_paid;
  Booking.setPaymentStatus(booking.booking_id, 'Paid', amountPaid);

  const updatedBooking = Booking.getByBookingId(booking.booking_id);

  try {
    const pdfPath = await pdfService.generateTicketPdf(updatedBooking);
    Booking.setTicketPdfPath(booking.booking_id, pdfPath);

    const emailResult = await emailService.sendBookingConfirmation(updatedBooking, pdfPath);
    Booking.setEmailSent(booking.booking_id, emailResult.sent);
  } catch (err) {
    // Payment already succeeded — never fail the callback response over
    // ticket/email generation issues. Log loudly so ops can regenerate
    // manually (see POST /api/admin/bookings/:bookingId/resend-ticket).
    logger.error(`Ticket/email generation failed for ${booking.booking_id}:`, err.message);
  }

  res.status(200).json({ success: true, message: 'Payment confirmed. Ticket generated.' });
});

/** GET /api/payments/status/:bookingId — lets the frontend poll for confirmation */
const paymentStatus = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  res.json({
    success: true,
    bookingId: booking.booking_id,
    paymentStatus: booking.payment_status,
    ticketId: booking.ticket_id,
  });
});

module.exports = { paystackCallback, paymentStatus };
