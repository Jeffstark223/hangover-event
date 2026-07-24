const express = require('express');
const router = express.Router();
const tableController = require('../controllers/tableController');

router.get('/', tableController.listAvailableTables);

module.exports = router;
