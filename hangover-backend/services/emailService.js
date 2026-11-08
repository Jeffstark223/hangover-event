const nodemailer = require('nodemailer');
const config = require('../config/env');
const logger = require('../utils/logger');
const { getLocationText } = require('./locationService');
const { labelFor } = require('./pricingService');

// Escape anything customer-supplied before it goes into the HTML email.
const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!config.email.host || !config.email.user) {
    logger.warn('SMTP is not configured — emails will be skipped. Set SMTP_* vars in .env.');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: { user: config.email.user, pass: config.email.password },
  });
  return transporter;
}

function confirmationHtml(booking, ticketCount = 0) {
  const intro = `Your booking for <strong>HANGOVER</strong> is confirmed. ${ticketCount} separate ticket${ticketCount === 1 ? ' is' : 's are'} attached as PDF${ticketCount === 1 ? '' : 's'} — one per person. Each ticket has its own unique ID and admits one person only.`;
  return `
  <div style="font-family:Arial,sans-serif;background:#0b0a0d;color:#ede8e2;padding:32px;">
    <h1 style="color:#e8562c;margin-bottom:0;">HANGOVER</h1>
    <p style="color:#a79e96;letter-spacing:1px;font-size:12px;text-transform:uppercase;">Booking Confirmed</p>
    <p>Hi ${esc(booking.guest_name)},</p>
    <p>${intro}</p>
    <table style="width:100%;border-collapse:collapse;margin-top:16px;">
      <tr><td style="padding:6px 0;color:#a79e96;">Booking ID</td><td style="padding:6px 0;">${booking.booking_id}</td></tr>
      <tr><td style="padding:6px 0;color:#a79e96;">Reservation ID</td><td style="padding:6px 0;">${booking.reservation_id}</td></tr>
      <tr><td style="padding:6px 0;color:#a79e96;">Ticket ID</td><td style="padding:6px 0;">${booking.ticket_id}</td></tr>
      <tr><td style="padding:6px 0;color:#a79e96;">Ticket Type</td><td style="padding:6px 0;">${esc(labelFor(booking.ticket_type))}(${ticketCount} ticket${ticketCount === 1 ? '' : 's'})</td></tr>
      <tr><td style="padding:6px 0;color:#a79e96;">Amount Paid</td><td style="padding:6px 0;">GHS ${Number(booking.amount_paid).toFixed(2)}</td></tr>
    </table>
    <p style="margin-top:24px;color:#a79e96;font-size:13px;">Sat, 28th Nov 2026 · 9:00 PM — Till Sunrise · ${esc(getLocationText())}</p>
    <p style="color:#a79e96;font-size:12px;">Present your ticket (digital or printed) at entry.</p>
  </div>`;
}

/**
 * Emails the booking confirmation with the PDF ticket attached.
 * Silently no-ops (with a warning) if SMTP isn't configured yet, so
 * local development / early integration doesn't hard-fail.
 */
async function sendBookingConfirmation(booking, ticketPdfPaths = []) {
  const t = getTransporter();
  if (!t) return { sent: false, reason: 'smtp_not_configured' };

  await t.sendMail({
    from: config.email.from,
    to: booking.email,
    subject: `Your HANGOVER Ticket — Booking ${booking.booking_id}`,
    html: confirmationHtml(booking, ticketPdfPaths.length),
    attachments: ticketPdfPaths.map((filePath, index) => ({
      filename: `HANGOVER-Ticket-${index + 1}-of-${ticketPdfPaths.length}.pdf`,
      path: filePath,
    })),
  });

  return { sent: true };
}

module.exports = { sendBookingConfirmation };
