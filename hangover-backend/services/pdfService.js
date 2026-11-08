const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { getLocationText } = require('./locationService');
const { labelFor } = require('./pricingService');

const TICKETS_DIR = path.resolve(process.cwd(), 'tickets');
if (!fs.existsSync(TICKETS_DIR)) fs.mkdirSync(TICKETS_DIR, { recursive: true });

const INK = '#0b0a0d';
const GOLD = '#d4af6a';
const EMBER = '#e8562c';
const DIM = '#5c564f';

// Event line printed on every ticket. The venue comes from the central
// config/event-location.json (or "Venue details coming soon." if unconfirmed).
function eventLine() {
  return `HANGOVER — Sat, 28th Nov 2026 · ${getLocationText()}`;
}

function row(doc, label, value, x, y, width) {
  doc.font('Helvetica').fontSize(8).fillColor(DIM).text(label.toUpperCase(), x, y, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(value || '—', x, y + 12, { width });
}

/**
 * Single-ticket PDF used only to re-issue tickets from older (pre-update) bookings.
 * New bookings use generateAttendeeTicketPdf (one ticket per person).
 * Saved to /tickets/<ticketId>.pdf. Returns the absolute file path.
 */
function generateTicketPdf(booking) {
  const filePath = path.join(TICKETS_DIR, `${booking.ticket_id}.pdf`);
  const doc = new PDFDocument({ size: [420, 620], margin: 0 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  // ---- Header band ----
  doc.rect(0, 0, 420, 130).fill(INK);
  doc.font('Helvetica-Bold').fontSize(30).fillColor('#ede8e2').text('HANGOVER', 30, 38, { characterSpacing: 1 });
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(GOLD)
    .text('GHANA’S PREMIUM NIGHT OUT · ADMIT ONE', 30, 76, { characterSpacing: 2 });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(EMBER)
    .text(String(labelFor(booking.ticket_type) || '').toUpperCase(), 30, 96, { characterSpacing: 2 });

  // ---- Guest / event body ----
  let y = 150;
  doc.fillColor(INK);
  row(doc, 'Guest Name', booking.guest_name, 30, y, 360);
  y += 40;
  row(doc, 'Event', eventLine(), 30, y, 360);
  y += 40;

  row(doc, 'Booking ID', booking.booking_id, 30, y, 170);
  row(doc, 'Reservation ID', booking.reservation_id, 220, y, 170);
  y += 40;

  row(doc, 'Ticket ID', booking.ticket_id, 30, y, 170);
  row(doc, 'Ticket Type', labelFor(booking.ticket_type), 220, y, 170);
  y += 40;

  row(doc, 'Phone Number', booking.phone_number, 30, y, 170);
  row(doc, 'Email', booking.email, 220, y, 170);
  y += 40;

  row(doc, 'Amount Paid', `GHS ${Number(booking.amount_paid).toFixed(2)}`, 30, y, 170);
  row(doc, 'Payment Status', booking.payment_status, 220, y, 170);
  y += 40;

  row(doc, 'Booking Date', booking.booking_date, 30, y, 360);

  // ---- Perforation + stub footer ----
  const perfY = 430;
  doc.save();
  doc.dash(4, { space: 4 }).moveTo(0, perfY).lineTo(420, perfY).strokeColor('#d9d3ca').lineWidth(1).stroke();
  doc.undash();
  doc.restore();

  doc.rect(0, perfY, 420, 620 - perfY).fill('#151217');
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#a79e96')
    .text('PRESENT THIS TICKET (DIGITAL OR PRINTED) AT ENTRY', 30, perfY + 24, { characterSpacing: 1.5 });
  doc
    .font('Helvetica-Bold')
    .fontSize(20)
    .fillColor(GOLD)
    .text(booking.ticket_id, 30, perfY + 42, { characterSpacing: 2 });
  doc
    .font('Helvetica')
    .fontSize(8)
    .fillColor('#a79e96')
    .text(
      'This ticket is proof of purchase and is validated once at entry.',
      30,
      perfY + 78,
      { width: 360 }
    );

  doc.end();

  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

/**
 * One ticket for one attendee of a Group of 6 / Guys / Girls / Late Bird booking.
 * Each attendee ticket has its own ticket ID and is validated once at entry.
 */
function generateAttendeeTicketPdf(attendee, booking) {
  const filePath = path.join(TICKETS_DIR, `${attendee.ticket_id}.pdf`);
  const doc = new PDFDocument({ size: [420, 620], margin: 0 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const isGroup = booking.price_unit === 'group';
  const categoryLabel = labelFor(booking.ticket_type);
  const priceLine = isGroup
    ? `GHS ${Number(booking.unit_price).toFixed(2)} total for the group of ${attendee.attendee_total}`
    : `GHS ${Number(booking.unit_price).toFixed(2)} per person`;

  doc.rect(0, 0, 420, 130).fill(INK);
  doc.font('Helvetica-Bold').fontSize(30).fillColor('#ede8e2').text('HANGOVER', 30, 38, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(9).fillColor(GOLD)
    .text('GHANA’S PREMIUM NIGHT OUT · ADMIT ONE', 30, 76, { characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(EMBER)
    .text(categoryLabel.toUpperCase(), 30, 96, { characterSpacing: 2 });

  let y = 150;
  doc.fillColor(INK);
  row(doc, 'Booked By', booking.guest_name, 30, y, 360); y += 40;
  row(doc, 'Event', eventLine(), 30, y, 360); y += 40;
  row(doc, 'Ticket', `${attendee.attendee_number} of ${attendee.attendee_total}`, 30, y, 170);
  row(doc, 'Category', categoryLabel, 220, y, 170); y += 40;
  row(doc, 'Booking ID', booking.booking_id, 30, y, 170);
  row(doc, 'Ticket ID', attendee.ticket_id, 220, y, 170); y += 40;
  row(doc, 'Price', priceLine, 30, y, 360); y += 40;
  row(doc, 'Booking Total Paid', `GHS ${Number(booking.amount_paid).toFixed(2)}`, 30, y, 170);
  row(doc, 'Payment Status', booking.payment_status, 220, y, 170); y += 40;
  row(doc, 'Booking Date', booking.booking_date, 30, y, 360);

  const perfY = 430;
  doc.save();
  doc.dash(4, { space: 4 }).moveTo(0, perfY).lineTo(420, perfY).strokeColor('#d9d3ca').lineWidth(1).stroke();
  doc.undash();
  doc.restore();
  doc.rect(0, perfY, 420, 620 - perfY).fill('#151217');
  doc.font('Helvetica').fontSize(8).fillColor('#a79e96')
    .text('PRESENT THIS TICKET (DIGITAL OR PRINTED) AT ENTRY', 30, perfY + 24, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(GOLD)
    .text(attendee.ticket_id, 30, perfY + 42, { characterSpacing: 2 });
  doc.font('Helvetica').fontSize(8).fillColor('#a79e96').text(
    isGroup
      ? `Admits ONE person. This is ticket ${attendee.attendee_number} of ${attendee.attendee_total} in a group booking; every ticket is validated separately and only once.`
      : 'Admits ONE person and is validated once at entry.',
    30,
    perfY + 78,
    { width: 360 }
  );

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateTicketPdf, generateAttendeeTicketPdf, TICKETS_DIR };
