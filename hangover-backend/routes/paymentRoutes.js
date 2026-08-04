const express = require('express');
const router = express.Router();

const paymentController = require('../controllers/paymentController');

router.post('/momo/submit', paymentController.submitMomoPayment);
router.get('/status/:bookingId', paymentController.paymentStatus);

module.exports = router;
