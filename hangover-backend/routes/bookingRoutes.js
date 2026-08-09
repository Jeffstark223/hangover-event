const express = require('express');
const router = express.Router();
const path = require('path');

const bookingController = require('../controllers/bookingController');
const Booking = require('../models/Booking');
const FreeTicket = require('../models/FreeTicket');
const { bookingLimiter } = require('../middleware/rateLimiters');

router.post('/', bookingLimiter, bookingController.createBooking);

router.get('/verify/:ticketId', bookingController.verifyTicket);

router.post('/retrieve', bookingController.retrieveBooking);

router.get('/:bookingId', bookingController.getBooking);

// Download ticket PDF
router.get('/ticket/:bookingId', (req, res) => {
  const booking = Booking.getByBookingId(req.params.bookingId);

  if (!booking) {
    return res.status(404).send('Booking not found');
  }

  if (!booking.ticket_pdf_path) {
    return res.status(404).send('Ticket has not been generated yet');
  }

  res.download(path.resolve(booking.ticket_pdf_path));
});

// Download an included table free-ticket PDF
router.get('/free-ticket/:ticketId', (req, res) => {
  const ticket = FreeTicket.getByTicketId(req.params.ticketId);
  if (!ticket) return res.status(404).send('Free ticket not found');
  if (!ticket.ticket_pdf_path) return res.status(404).send('Free ticket has not been generated yet');
  res.download(path.resolve(ticket.ticket_pdf_path));
});

module.exports = router;