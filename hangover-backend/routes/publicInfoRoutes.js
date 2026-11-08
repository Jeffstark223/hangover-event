const express = require('express');
const router = express.Router();
const publicInfoController = require('../controllers/publicInfoController');

router.get('/tickets', publicInfoController.listTickets);
router.get('/event/location', publicInfoController.getLocation);

module.exports = router;
