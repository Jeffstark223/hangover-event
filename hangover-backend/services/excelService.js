const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { listBookings } = require('../models/Booking');
const { db } = require('../database/db');

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true });

const COLUMNS = [
  { header: 'Booking ID', key: 'booking_id', width: 18 },
  { header: 'Ticket ID', key: 'ticket_id', width: 18 },
  { header: 'Reservation ID', key: 'reservation_id', width: 18 },
  { header: 'Guest Name', key: 'guest_name', width: 24 },
  { header: 'Phone Number', key: 'phone_number', width: 16 },
  { header: 'Email', key: 'email', width: 26 },
  { header: 'Ticket Type', key: 'ticket_type', width: 14 },
  { header: 'Table Package', key: 'table_package', width: 16 },
  { header: 'Table Number', key: 'table_number', width: 14 },
  { header: 'Drink Choice', key: 'drink_choice', width: 20 },
  { header: 'Seats', key: 'seats', width: 8 },
  { header: 'Amount Paid', key: 'amount_paid', width: 14 },
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

  for (const b of bookings) {
    sheet.addRow({
      ...b,
      checked_in_label: b.checked_in ? 'Yes' : 'No',
    });
  }

  const filename = `hangover-guest-list-${Date.now()}.xlsx`;
  const filePath = path.join(EXPORTS_DIR, filename);
  await workbook.xlsx.writeFile(filePath);
  return filePath;
}

module.exports = { generateGuestListExcel, EXPORTS_DIR };
