const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');

// ---- Auth ----
router.post('/auth/login', loginLimiter, adminController.login);
router.get('/auth/me', requireAdmin, adminController.me);

// ---- Everything below requires a valid admin session ----
router.use(requireAdmin);

router.get('/dashboard', adminController.dashboard);

router.get('/bookings', adminController.listBookings);
router.get('/bookings/:bookingId', adminController.getBooking);
router.post('/bookings/:bookingId/resend-ticket', adminController.resendTicket);

router.post('/verify', adminController.verifyTicket);
router.post('/checkin', adminController.checkIn);

router.get('/tables', adminController.tableFloor);

router.get('/export/guest-list', adminController.exportGuestList);

module.exports = router;
