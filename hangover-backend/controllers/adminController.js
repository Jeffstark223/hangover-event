const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const AdminModel = require('../models/Admin');
const Booking = require('../models/Booking');
const TableModel = require('../models/Table');
const pdfService = require('../services/pdfService');
const emailService = require('../services/emailService');
const excelService = require('../services/excelService');
const config = require('../config/env');
const { ApiError, asyncHandler } = require('../utils/apiError');

/** POST /api/admin/auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new ApiError(400, 'Email and password are required.');

  const admin = AdminModel.getByEmail(email);
  if (!admin) throw new ApiError(401, 'Invalid email or password.');

  const valid = await bcrypt.compare(password, admin.password_hash);
  if (!valid) throw new ApiError(401, 'Invalid email or password.');

  const token = jwt.sign({ sub: admin.id, email: admin.email, name: admin.name }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

  res.json({ success: true, token, admin: { id: admin.id, name: admin.name, email: admin.email } });
});

/** GET /api/admin/auth/me — lets the admin panel confirm the current session */
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, admin: req.admin });
});

/** GET /api/admin/dashboard */
const dashboard = asyncHandler(async (req, res) => {
  const stats = Booking.stats();
  res.json({ success: true, stats });
});

/** GET /api/admin/bookings?limit=&offset=&q= */
const listBookings = asyncHandler(async (req, res) => {
  const { q, limit, offset } = req.query;
  const bookings = q
    ? Booking.search(String(q))
    : Booking.listBookings({ limit: Number(limit) || 100, offset: Number(offset) || 0 });
  res.json({ success: true, count: bookings.length, bookings });
});

/** GET /api/admin/bookings/:bookingId */
const getBooking = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  res.json({ success: true, booking });
});

/** POST /api/admin/verify — search by ticket ID, guest name, or phone number */
const verifyTicket = asyncHandler(async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) throw new ApiError(400, 'ticketId is required.');

  const booking = Booking.getByTicketId(ticketId.trim());
  if (!booking) throw new ApiError(404, `No booking found for ticket "${ticketId}".`);

  if (booking.payment_status !== 'Paid') {
    throw new ApiError(409, `Ticket found but payment status is "${booking.payment_status}", not Paid.`, { booking });
  }

  res.json({ success: true, booking });
});

/** POST /api/admin/bookings/:bookingId/confirm-payment
 * Manually confirms a Mobile Money transaction after the organizer has
 * checked the appropriate MoMo account. Ticket generation happens only here.
 */
const confirmPayment = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);

  if (!booking) throw new ApiError(404, 'Booking not found.');

  if (booking.payment_status === 'Paid') {
    return res.json({
      success: true,
      message: 'Payment has already been confirmed.',
      booking,
    });
  }

  if (!booking.momo_transaction_id) {
    throw new ApiError(409, 'The customer has not submitted a Mobile Money transaction ID yet.');
  }

  if (booking.payment_status === 'Cancelled') {
    throw new ApiError(409, 'This booking has been cancelled.');
  }

  const expectedAmount = Number(booking.amount_due || 0);
  if (!expectedAmount) {
    throw new ApiError(409, 'This booking has no valid amount due.');
  }

  Booking.confirmManualPayment(booking.booking_id, expectedAmount);
  Booking.recordPaymentEvent(booking.booking_id, 'verified', {
    method: 'manual_momo',
    transactionId: booking.momo_transaction_id,
    amount: expectedAmount,
    verifiedBy: req.admin?.email || 'admin',
  });

  const updatedBooking = Booking.getByBookingId(booking.booking_id);

  let ticketGenerated = false;
  let emailSent = false;

  try {
    const pdfPath = await pdfService.generateTicketPdf(updatedBooking);
    Booking.setTicketPdfPath(updatedBooking.booking_id, pdfPath);
    ticketGenerated = true;

    const emailResult = await emailService.sendBookingConfirmation(updatedBooking, pdfPath);
    Booking.setEmailSent(updatedBooking.booking_id, emailResult.sent);
    emailSent = emailResult.sent;
  } catch (err) {
    // Payment stays Paid. The admin can use "Resend Ticket" later if
    // PDF/email generation needs another attempt.
    console.error(`Ticket generation failed for ${updatedBooking.booking_id}:`, err.message);
  }

  res.json({
    success: true,
    message: ticketGenerated
      ? (emailSent ? 'Payment confirmed and ticket emailed.' : 'Payment confirmed and ticket generated.')
      : 'Payment confirmed, but ticket generation needs another attempt.',
    booking: Booking.getByBookingId(updatedBooking.booking_id),
  });
});

/** POST /api/admin/checkin — marks a ticket as checked in */
const checkIn = asyncHandler(async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) throw new ApiError(400, 'ticketId is required.');

  const booking = Booking.getByTicketId(ticketId.trim());
  if (!booking) throw new ApiError(404, `No booking found for ticket "${ticketId}".`);
  if (booking.payment_status !== 'Paid') throw new ApiError(409, 'Cannot check in a ticket that has not been paid.');
  if (booking.checked_in) throw new ApiError(409, 'This ticket has already been checked in.', { booking });

  Booking.setCheckedIn(ticketId.trim());
  res.json({ success: true, booking: Booking.getByTicketId(ticketId.trim()) });
});

/** GET /api/admin/tables — full floor plan for the admin dashboard */
const tableFloor = asyncHandler(async (req, res) => {
  const tables = TableModel.getAllTables();
  res.json({ success: true, tables });
});

/** GET /api/admin/export/guest-list — streams a fresh .xlsx download */
const exportGuestList = asyncHandler(async (req, res) => {
  const filePath = await excelService.generateGuestListExcel();
  res.download(filePath, path.basename(filePath));
});

/** POST /api/admin/bookings/:bookingId/resend-ticket — regenerate PDF + resend email */
const resendTicket = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  if (booking.payment_status !== 'Paid') throw new ApiError(409, 'Booking has not been paid; no ticket to send.');

  const pdfPath = await pdfService.generateTicketPdf(booking);
  Booking.setTicketPdfPath(booking.booking_id, pdfPath);
  const result = await emailService.sendBookingConfirmation(booking, pdfPath);
  Booking.setEmailSent(booking.booking_id, result.sent);

  res.json({ success: true, message: result.sent ? 'Ticket resent.' : 'Ticket regenerated but SMTP is not configured.' });
});

module.exports = {
  login,
  me,
  dashboard,
  listBookings,
  getBooking,
  verifyTicket,
  checkIn,
  tableFloor,
  exportGuestList,
  resendTicket,
  confirmPayment,
};
