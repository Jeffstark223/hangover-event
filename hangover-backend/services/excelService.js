const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { listBookings } = require('../models/Booking');
const { db } = require('../database/db');
const { labelFor } = require('./pricingService');

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

const COLUMNS = [
  { header: 'Booking ID', key: 'booking_id', width: 18 },
  { header: 'Ticket ID', key: 'ticket_id', width: 18 },
  { header: 'Reservation ID', key: 'reservation_id', width: 18 },
  { header: 'Guest Name', key: 'guest_name', width: 24 },
  { header: 'Phone Number', key: 'phone_number', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Ticket Type', key: 'ticket_label', width: 28 },
  { header: 'Tickets', key: 'quantity', width: 10 },
  { header: 'Tickets Issued', key: 'tickets_issued', width: 14 },
  { header: 'Unit Price', key: 'unit_price_label', width: 18 },
  { header: 'Amount Due', key: 'amount_due', width: 14 },
  { header: 'Amount Paid', key: 'amount_paid', width: 14 },
  { header: 'Payment Method', key: 'payment_method', width: 16 },
  { header: 'MoMo Transaction ID', key: 'momo_transaction_id', width: 24 },
  { header: 'Payment Status', key: 'payment_status', width: 14 },
  { header: 'Booking Date', key: 'booking_date', width: 20 },
  { header: 'Checked In', key: 'checked_in_label', width: 12 },
];

/**
 * Pulls every booking from SQLite and writes a fresh guest-list
 * workbook to /exports. SQLite remains the source of truth — this
 * file is generated on demand and safe to overwrite/delete anytime.
 */
async function generateGuestListExcel() {
  const bookings = db.prepare(`SELECT * FROM bookings ORDER BY datetime(booking_date) DESC`).all();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HANGOVER Events';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Guest List', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = COLUMNS;

  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF151217' },
  };
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFEDE8E2' } };
  });

  const attendeeSummary = db.prepare(
    `SELECT COUNT(*) AS total, COALESCE(SUM(checked_in), 0) AS checkedIn FROM attendee_tickets WHERE booking_id = ?`
  );

  for (const b of bookings) {
    const a = attendeeSummary.get(b.booking_id);
    const unitPriceLabel = b.price_unit
      ? `GHS ${Number(b.unit_price)} ${b.price_unit === 'group' ? 'per group' : 'per person'}`
      : '';
    sheet.addRow({
      ...b,
      ticket_label: labelFor(b.ticket_type),
      tickets_issued: a.total || '',
      unit_price_label: unitPriceLabel,
      // Per-attendee bookings show how many of their tickets are checked in (e.g. 2/6).
      checked_in_label: a.total ? `${a.checkedIn}/${a.total}` : b.checked_in ? 'Yes' : 'No',
    });
  }

  // One row per individual attendee ticket, so door staff can work from a flat list.
  const ticketSheet = workbook.addWorksheet('Attendee Tickets', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ticketSheet.columns = [
    { header: 'Ticket ID', key: 'ticket_id', width: 18 },
    { header: 'Ticket #', key: 'number', width: 10 },
    { header: 'Booking ID', key: 'booking_id', width: 18 },
    { header: 'Booked By', key: 'guest_name', width: 24 },
    { header: 'Phone Number', key: 'phone_number', width: 16 },
    { header: 'Category', key: 'category', width: 28 },
    { header: 'Payment Status', key: 'payment_status', width: 14 },
    { header: 'Checked In', key: 'checked_in_label', width: 12 },
    { header: 'Checked In At', key: 'checked_in_at', width: 20 },
  ];
  ticketSheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFEDE8E2' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF151217' } };
  });
  const attendeeRows = db
    .prepare(
      `SELECT t.*, b.phone_number, b.payment_status
       FROM attendee_tickets t JOIN bookings b ON b.booking_id = t.booking_id
       ORDER BY datetime(b.booking_date) DESC, t.booking_id, t.attendee_number`
    )
    .all();
  for (const t of attendeeRows) {
    ticketSheet.addRow({
      ticket_id: t.ticket_id,
      number: `${t.attendee_number} of ${t.attendee_total}`,
      booking_id: t.booking_id,
      guest_name: t.guest_name,
      phone_number: t.phone_number,
      category: labelFor(t.ticket_category),
      payment_status: t.payment_status,
      checked_in_label: t.checked_in ? 'Yes' : 'No',
      checked_in_at: t.checked_in_at || '',
    });
  }

  const filename = `hangover-guest-list-${Date.now()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, filename);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { generateGuestListExcel, EXPORTS_DIR };
