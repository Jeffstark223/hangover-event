const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const AdminModel = require('../models/Admin');
const Booking = require('../models/Booking');
const AttendeeTicket = require('../models/AttendeeTicket');
const attendeeService = require('../services/attendeeService');
const pricingService = require('../services/pricingService');
const { present, presentAll } = require('../services/bookingPresenter');
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
  res.json({ success: true, count: bookings.length, bookings: presentAll(bookings) });
});

/** GET /api/admin/bookings/:bookingId — booking plus every individual ticket ID */
const getBooking = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  res.json({
    success: true,
    booking: present(booking),
    attendeeTickets: AttendeeTicket.listByBookingId(booking.booking_id),
  });
});

/** POST /api/admin/verify — look up any ticket by its own ticket ID */
const verifyTicket = asyncHandler(async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) throw new ApiError(400, 'ticketId is required.');
  const id = String(ticketId).trim();

  // Individual attendee tickets first (attendee #1 shares its ID with the booking's main ticket).
  const attendee = AttendeeTicket.getByTicketId(id);
  if (attendee) {
    const parent = Booking.getByBookingId(attendee.booking_id);
    if (!parent || parent.payment_status !== 'Paid') {
      throw new ApiError(409, 'This ticket is linked to a booking that has not been paid.');
    }
    return res.json({
      success: true,
      ticketType: 'attendee',
      booking: present(parent),
      attendeeTicket: attendee,
      attendeeSummary: AttendeeTicket.summaryForBooking(parent.booking_id),
    });
  }

  // Single tickets issued by older versions of the site.
  const booking = Booking.getByTicketId(id);
  if (!booking) throw new ApiError(404, `No ticket found for "${id}".`);
  if (booking.payment_status !== 'Paid') {
    throw new ApiError(409, `Ticket found but payment status is "${booking.payment_status}", not Paid.`, { booking: present(booking) });
  }
  res.json({ success: true, ticketType: 'primary', booking: present(booking) });
});

/** POST /api/admin/bookings/:bookingId/confirm-payment
 * Manually confirms a Mobile Money transaction after the organizer has
 * checked the MoMo account. Ticket generation happens ONLY here, after the
 * payment has been verified by an administrator.
 */
const confirmPayment = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');

  if (booking.payment_status === 'Paid') {
    return res.json({
      success: true,
      message: 'Payment has already been confirmed.',
      booking: present(booking),
      attendeeTickets: AttendeeTicket.listByBookingId(booking.booking_id),
    });
  }

  if (!booking.momo_transaction_id) {
    throw new ApiError(409, 'The customer has not submitted a Mobile Money transaction ID yet.');
  }
  if (booking.payment_status === 'Cancelled') {
    throw new ApiError(409, 'This booking has been cancelled.');
  }

  // Bookings created under the retired categories (Regular / VIP / VVIP / tables)
  // carry no price snapshot and can no longer be confirmed at their old price.
  if (!booking.price_unit || booking.unit_price == null) {
    throw new ApiError(
      409,
      'This booking was made under the retired ticket categories and prices and cannot be confirmed. Ask the customer to make a new booking and refund or reconcile the old payment manually.'
    );
  }

  const expectedAmount = Number(booking.amount_due || 0);
  if (!expectedAmount) throw new ApiError(409, 'This booking has no valid amount due.');

  // ---- Payment amount validation ---------------------------------------
  // Recompute the price from the snapshot saved at booking time and make sure
  // the stored amount still matches it.
  const recomputed = pricingService.expectedAmountForBooking(booking);
  if (recomputed !== pricingService.round2(expectedAmount)) {
    throw new ApiError(
      409,
      `Amount mismatch: this ${pricingService.labelFor(booking.ticket_type)} booking should cost GHS ${recomputed}, but the amount due is GHS ${expectedAmount}. Payment was not confirmed.`
    );
  }

  // Optional: the admin may state the amount actually received in the MoMo account.
  const received = req.body ? req.body.amountReceived : undefined;
  if (received !== undefined && received !== null && received !== '') {
    const receivedNum = Number(received);
    if (!Number.isFinite(receivedNum) || pricingService.round2(receivedNum) !== pricingService.round2(expectedAmount)) {
      throw new ApiError(
        409,
        `Amount mismatch: GHS ${received} was reported received, but this booking requires exactly GHS ${expectedAmount}. Payment was not confirmed.`
      );
    }
  }

  Booking.confirmManualPayment(booking.booking_id, expectedAmount);
  Booking.recordPaymentEvent(booking.booking_id, 'verified', {
    method: 'manual_momo',
    transactionId: booking.momo_transaction_id,
    amount: expectedAmount,
    verifiedBy: req.admin?.email || 'admin',
  });

  let updatedBooking = Booking.getByBookingId(booking.booking_id);
  let attendeeTickets = [];
  let ticketGenerated = false;
  let emailSent = false;

  // One ticket (own unique ID, own PDF) per admitted person, issued only now.
  try {
    attendeeTickets = await attendeeService.issueAttendeeTickets(updatedBooking);
    updatedBooking = Booking.getByBookingId(updatedBooking.booking_id);
    ticketGenerated = attendeeTickets.length > 0 && attendeeTickets.every((t) => t.ticket_pdf_path);

    if (ticketGenerated) {
      const emailResult = await emailService.sendBookingConfirmation(
        updatedBooking,
        attendeeTickets.map((t) => t.ticket_pdf_path)
      );
      Booking.setEmailSent(updatedBooking.booking_id, emailResult.sent);
      emailSent = emailResult.sent;
    }
  } catch (err) {
    console.error(`Ticket generation failed for ${updatedBooking.booking_id}:`, err.message);
    attendeeTickets = AttendeeTicket.listByBookingId(updatedBooking.booking_id);
  }

  res.json({
    success: true,
    message: ticketGenerated
      ? (emailSent
          ? `Payment confirmed and ${attendeeTickets.length} ticket(s) emailed.`
          : `Payment confirmed and ${attendeeTickets.length} ticket(s) generated.`)
      : 'Payment confirmed, but ticket generation needs another attempt (use Resend Ticket).',
    booking: present(Booking.getByBookingId(updatedBooking.booking_id)),
    attendeeTickets,
  });
});

/** POST /api/admin/checkin — marks one ticket as checked in */
const checkIn = asyncHandler(async (req, res) => {
  const { ticketId } = req.body;
  if (!ticketId) throw new ApiError(400, 'ticketId is required.');
  const id = String(ticketId).trim();

  // Each attendee is checked in on their own, atomically, so a ticket can never be
  // admitted twice even if scanned at two gates at once.
  const attendee = AttendeeTicket.getByTicketId(id);
  if (attendee) {
    const parent = Booking.getByBookingId(attendee.booking_id);
    if (!parent || parent.payment_status !== 'Paid') {
      throw new ApiError(409, 'Cannot check in a ticket whose booking has not been paid.');
    }
    if (!AttendeeTicket.checkIn(id)) {
      throw new ApiError(409, 'This ticket has already been checked in.', { attendeeTicket: AttendeeTicket.getByTicketId(id) });
    }
    return res.json({
      success: true,
      ticketType: 'attendee',
      booking: present(parent),
      attendeeTicket: AttendeeTicket.getByTicketId(id),
      attendeeSummary: AttendeeTicket.summaryForBooking(parent.booking_id),
    });
  }

  // Single tickets issued by older versions of the site.
  const booking = Booking.getByTicketId(id);
  if (!booking) throw new ApiError(404, `No ticket found for "${id}".`);
  if (booking.payment_status !== 'Paid') throw new ApiError(409, 'Cannot check in a ticket that has not been paid.');
  if (booking.checked_in) throw new ApiError(409, 'This ticket has already been checked in.', { booking: present(booking) });
  Booking.setCheckedIn(id);
  res.json({ success: true, ticketType: 'primary', booking: present(Booking.getByTicketId(id)) });
});

/** GET /api/admin/export/guest-list — streams a fresh .xlsx download */
const exportGuestList = asyncHandler(async (req, res) => {
  const filePath = await excelService.generateGuestListExcel();
  res.download(filePath, path.basename(filePath));
});

/** POST /api/admin/bookings/:bookingId/resend-ticket — regenerate PDFs + resend email */
const resendTicket = asyncHandler(async (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);
  if (!booking) throw new ApiError(404, 'Booking not found.');
  if (booking.payment_status !== 'Paid') throw new ApiError(409, 'Booking has not been paid; no ticket to send.');

  if (attendeeService.usesAttendeeTickets(booking)) {
    const tickets = await attendeeService.issueAttendeeTickets(booking, { regeneratePdfs: true });
    const refreshed = Booking.getByBookingId(booking.booking_id);
    const sent = await emailService.sendBookingConfirmation(refreshed, tickets.map((t) => t.ticket_pdf_path));
    Booking.setEmailSent(booking.booking_id, sent.sent);
    return res.json({
      success: true,
      message: sent.sent ? `${tickets.length} ticket(s) resent.` : `${tickets.length} ticket(s) regenerated but SMTP is not configured.`,
    });
  }

  // Older single-ticket booking.
  const pdfPath = await pdfService.generateTicketPdf(booking);
  Booking.setTicketPdfPath(booking.booking_id, pdfPath);
  const result = await emailService.sendBookingConfirmation(booking, [pdfPath]);
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
  exportGuestList,
  resendTicket,
  confirmPayment,
};
