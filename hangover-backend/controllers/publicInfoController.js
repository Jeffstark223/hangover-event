const pricingService = require('../services/pricingService');
const locationService = require('../services/locationService');
const { asyncHandler } = require('../utils/apiError');

/** GET /api/tickets — active ticket categories and their prices (display only; the server re-prices every booking). */
const listTickets = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, currency: 'GHS', tickets: pricingService.getCatalog() });
});

/** GET /api/event/location — the venue exactly as it should be displayed right now. */
const getLocation = asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, location: locationService.getLocation() });
});

module.exports = { listTickets, getLocation };
