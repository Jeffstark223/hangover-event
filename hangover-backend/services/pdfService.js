const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const TICKETS_DIR = path.resolve(process.cwd(), 'tickets');
if (!fs.existsSync(TICKETS_DIR)) fs.mkdirSync(TICKETS_DIR, { recursive: true });

const INK = '#0b0a0d';
const GOLD = '#d4af6a';
const EMBER = '#e8562c';
const DIM = '#5c564f';

function row(doc, label, value, x, y, width) {
  doc.font('Helvetica').fontSize(8).fillColor(DIM).text(label.toUpperCase(), x, y, { characterSpacing: 1 });
  doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(value || '—', x, y + 12, { width });
}

/**
 * Renders a professional PDF ticket for a paid booking and saves it
 * to /tickets/<ticketId>.pdf. Returns the absolute file path.
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
    .text((booking.ticket_type || '').toUpperCase(), 30, 96, { characterSpacing: 2 });

  // ---- Guest / event body ----
  let y = 150;
  doc.fillColor(INK);
  row(doc, 'Guest Name', booking.guest_name, 30, y, 360);
  y += 40;
  row(doc, 'Event', 'HANGOVER — Fri, 11th Sept 2026 · Pera lounge East legon, Accra', 30, y, 360);
  y += 40;

  row(doc, 'Booking ID', booking.booking_id, 30, y, 170);
  row(doc, 'Reservation ID', booking.reservation_id, 220, y, 170);
  y += 40;

  row(doc, 'Ticket ID', booking.ticket_id, 30, y, 170);
  row(doc, 'Ticket Type', booking.ticket_type, 220, y, 170);
  y += 40;

  row(doc, 'Phone Number', booking.phone_number, 30, y, 170);
  row(doc, 'Email', booking.email, 220, y, 170);
  y += 40;

  row(doc, 'Table Package', booking.table_package || 'N/A', 30, y, 170);
  row(doc, 'Table Number', booking.table_number || 'N/A', 220, y, 170);
  y += 40;

  row(doc, 'Drink Choice', booking.drink_choice || 'N/A', 30, y, 170);
  row(doc, 'Free Tickets Included', booking.table_package ? String(booking.seats ?? 1) : 'N/A', 220, y, 170);
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
      booking.is_free_ticket
        ? 'Included with a paid table reservation. This ticket may be given to another guest and is validated once at entry.'
        : 'This ticket is proof of purchase and is validated once at entry.',
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

function generateFreeTicketPdf(freeTicket, booking) {
  const filePath = path.join(TICKETS_DIR, `${freeTicket.ticket_id}.pdf`);
  const doc = new PDFDocument({ size: [420, 620], margin: 0 });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  doc.rect(0, 0, 420, 130).fill(INK);
  doc.font('Helvetica-Bold').fontSize(30).fillColor('#ede8e2')
    .text('HANGOVER', 30, 38, { characterSpacing: 1 });
  doc.font('Helvetica').fontSize(9).fillColor(GOLD)
    .text('TABLE GUEST · FREE ENTRY', 30, 76, { characterSpacing: 2 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor(EMBER)
    .text('INCLUDED FREE TICKET', 30, 96, { characterSpacing: 2 });

  let y = 150;
  row(doc, 'Guest', 'Table Guest', 30, y, 360); y += 40;
  row(doc, 'Event', 'HANGOVER — Fri, 11th Sept 2026 · Pera lounge East legon, Accra', 30, y, 360); y += 40;
  row(doc, 'Table Reservation', booking.booking_id, 30, y, 170);
  row(doc, 'Table', `${booking.table_number || 'N/A'} · ${booking.table_package || 'N/A'}`, 220, y, 170); y += 40;
  row(doc, 'Free Ticket ID', freeTicket.ticket_id, 30, y, 360); y += 40;
  row(doc, 'Included With', `GHS ${Number(booking.amount_paid || booking.amount_due || 0).toFixed(2)} table`, 30, y, 360); y += 40;
  row(doc, 'Payment Status', booking.payment_status, 30, y, 170);
  row(doc, 'Reservation ID', booking.reservation_id, 220, y, 170); y += 40;

  const perfY = 430;
  doc.save();
  doc.dash(4, { space: 4 }).moveTo(0, perfY).lineTo(420, perfY)
    .strokeColor('#d9d3ca').lineWidth(1).stroke();
  doc.undash(); doc.restore();
  doc.rect(0, perfY, 420, 620 - perfY).fill('#151217');
  doc.font('Helvetica').fontSize(8).fillColor('#a79e96')
    .text('PRESENT THIS TICKET (DIGITAL OR PRINTED) AT ENTRY', 30, perfY + 24, { characterSpacing: 1.5 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(GOLD)
    .text(freeTicket.ticket_id, 30, perfY + 42, { characterSpacing: 2 });
  doc.font('Helvetica').fontSize(8).fillColor('#a79e96')
    .text('Included with the table reservation. The purchaser may give this ticket to anyone.', 30, perfY + 78, { width: 360 });

  doc.end();
  return new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(filePath));
    stream.on('error', reject);
  });
}

module.exports = { generateTicketPdf, generateFreeTicketPdf, TICKETS_DIR };
