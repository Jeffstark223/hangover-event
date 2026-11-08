// ==========================================================================
// HANGOVER — Ticket price catalogue (SINGLE SOURCE OF TRUTH)
//
// Every price the system charges for a ticket is defined here and ONLY here. The backend uses this file to:
//   - calculate the amount due when a booking is created,
//   - re-validate the amount when an admin confirms a payment,
//   - tell the public website which prices to display (GET /api/tickets).
//
// The browser can never influence a price: the API only accepts a ticket
// category key and a quantity, and recalculates everything from this file.
//
// pricingUnit:
//   'group'  -> `price` is the TOTAL for one group; `attendeesPerUnit` people
//               are admitted and each gets their own ticket.
//   'person' -> `price` is charged per person; one ticket per person.
//
// Set `active: false` to stop selling a category without deleting it.
// Prices are in GHS.
// ==========================================================================

const deepFreeze = (obj) => {
  Object.values(obj).forEach((v) => {
    if (v && typeof v === 'object') deepFreeze(v);
  });
  return Object.freeze(obj);
};

module.exports = deepFreeze({
  currency: 'GHS',

  tickets: {
    group_of_6: {
      key: 'group_of_6',
      label: 'Group of 6',
      pricingUnit: 'group',
      price: 300, // GHS 300 TOTAL for six people (not per person)
      attendeesPerUnit: 6,
      active: true,
    },
    guys: {
      key: 'guys',
      label: 'Guys',
      pricingUnit: 'person',
      price: 80,
      attendeesPerUnit: 1,
      maxQuantity: 20,
      active: true,
    },
    girls: {
      key: 'girls',
      label: 'Girls',
      pricingUnit: 'person',
      price: 65,
      attendeesPerUnit: 1,
      maxQuantity: 20,
      active: true,
    },
    late_bird: {
      key: 'late_bird',
      label: 'Late Bird (Gate – Everybody)',
      pricingUnit: 'person',
      price: 100,
      attendeesPerUnit: 1,
      maxQuantity: 20,
      active: true,
    },
  },

  // Ticket categories that have been withdrawn. They are rejected with a
  // clear message and can never be sold again by accident.
  // (Regular, VIP and VVIP were replaced by Group of 6 / Guys / Girls / Late Bird.)
  retired: ['regular', 'vip', 'vvip'],

  // Display names for historic records and non-catalogue booking types.
  // Used only to show old bookings nicely in the admin panel / exports.
  legacyLabels: {
    regular: 'Regular Ticket (retired)',
    vip: 'VIP Ticket (retired)',
    vvip: 'VVIP Ticket (retired)',
    table: 'Table Reservation (retired)',
  },
});
