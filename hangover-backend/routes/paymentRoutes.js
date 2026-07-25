const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// paystack calls this server-to-server; no CSRF/browser auth applies here.
// Paystack redirects customers here after payment
router.get('/paystack/callback', paymentController.paystackCallback);

// Keep POST support for server callbacks
router.post('/paystack/callback', paymentController.paystackCallback);
router.get('/status/:bookingId', paymentController.paymentStatus);

module.exports = router;
