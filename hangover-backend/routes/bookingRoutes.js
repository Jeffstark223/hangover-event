const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');
const { bookingLimiter } = require('../middleware/rateLimiters');

router.post('/', bookingLimiter, bookingController.createBooking);
router.get('/verify/:ticketId', bookingController.verifyTicket);
router.get('/:bookingId', bookingController.getBooking);

module.exports = router;
