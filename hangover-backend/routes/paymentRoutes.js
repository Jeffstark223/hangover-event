const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

// Hubtel calls this server-to-server; no CSRF/browser auth applies here.
router.post('/paystack/callback', paymentController.paystackCallback);
router.get('/status/:bookingId', paymentController.paymentStatus);

module.exports = router;
