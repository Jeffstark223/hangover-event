const TableModel = require('../models/Table');
const tablesConfig = require('../config/tables.config');
const { asyncHandler } = require('../utils/apiError');

/** GET /api/tables — public: available tables grouped by package, for the booking UI */
const listAvailableTables = asyncHandler(async (req, res) => {
  const all = TableModel.getAvailableTables();
  const grouped = {};
  for (const pkg of tablesConfig.packages) {
    grouped[pkg.key] = {
      label: pkg.label,
      price: pkg.price,
      includes: pkg.includes,
      availableTables: all.filter((t) => t.package === pkg.key).map((t) => t.table_number),
    };
  }
  res.json({ success: true, packages: grouped });
});

module.exports = { listAvailableTables };
