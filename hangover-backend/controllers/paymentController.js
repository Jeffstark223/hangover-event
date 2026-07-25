const Booking = require('../models/Booking');
const TableModel = require('../models/Table');
const { ApiError, asyncHandler } = require('../utils/apiError');
const paystackService = require('../services/paystackService');
const pdfService = require('../services/pdfService');
const emailService = require('../services/emailService');
const logger = require('../utils/logger');
const config = require('../config/env');

/**
 * Paystack callback
 *
 * Handles:
 * - Browser redirect from Paystack (GET)
 * - Server callback from Paystack (POST)
 */
const paystackCallback = asyncHandler(async (req, res) => {
  const payload = req.method === 'GET' ? req.query : (req.body || {});

  const paymentReference =
    payload.reference ||
    payload.trxref ||
    payload.ClientReference ||
    payload.clientReference;

  const providerStatus =
    (payload.status || payload.Status || '').toString().toLowerCase();

  if (!paymentReference) {
    throw new ApiError(400, 'Callback missing payment reference.');
  }

  const booking = Booking.getByPaymentReference(paymentReference);

  if (!booking) {
    logger.warn(
      `Paystack callback for unknown payment reference: ${paymentReference}`
    );

    return res.redirect(
      `${config.appBaseUrl}/?payment=not-found`
    );
  }

  Booking.recordPaymentEvent(
    booking.booking_id,
    'callback',
    payload
  );

  if (booking.payment_status === 'Paid') {
    return res.redirect(
      `${config.appBaseUrl}/payment-success.html?bookingId=${booking.booking_id}`
    );
  }

  const verification = await paystackService.verifyTransaction({
    paymentReference,
  });

  Booking.recordPaymentEvent(
    booking.booking_id,
    'verified',
    verification
  );

  const paymentSucceeded =
    verification.verified === true ||
    providerStatus === 'success';


  if (!paymentSucceeded) {
    Booking.setPaymentStatus(
      booking.booking_id,
      'Failed'
    );

    if (booking.table_number) {
      TableModel.releaseTable(
        booking.table_number
      );
    }

    return res.redirect(
      `${config.appBaseUrl}/?payment=failed`
    );
  }


  const amountPaid =
    verification.amount ?? booking.amount_paid;

  Booking.setPaymentStatus(
    booking.booking_id,
    'Paid',
    amountPaid
  );


  const updatedBooking =
    Booking.getByBookingId(
      booking.booking_id
    );


  try {

    const pdfPath =
      await pdfService.generateTicketPdf(
        updatedBooking
      );

    Booking.setTicketPdfPath(
      booking.booking_id,
      pdfPath
    );


    const emailResult =
      await emailService.sendBookingConfirmation(
        updatedBooking,
        pdfPath
      );

    Booking.setEmailSent(
      booking.booking_id,
      emailResult.sent
    );


  } catch (err) {

    logger.error(
      `Ticket/email generation failed for ${booking.booking_id}:`,
      err.message
    );

  }


  return res.redirect(
    `${config.appBaseUrl}/payment-success.html?bookingId=${booking.booking_id}`
  );

});


/**
 * Check payment status
 */
const paymentStatus = asyncHandler(async (req, res) => {

  const booking =
    Booking.getByBookingId(
      req.params.bookingId
    );

  if (!booking) {
    throw new ApiError(
      404,
      'Booking not found.'
    );
  }

  res.json({
    success: true,
    bookingId: booking.booking_id,
    paymentStatus: booking.payment_status,
    ticketId: booking.ticket_id,
  });

});


module.exports = {
  paystackCallback,
  paymentStatus
};