// Defines the venue's table inventory. This is the single source of
// truth for how many tables exist per package and how they are
// numbered. Edit the counts here if the venue layout changes, then
// run `npm run seed-tables` to sync the database.
//
// Prices are in GHS and mirror the packages presented on the public
// site (index.html "Reserve your table" section).

module.exports = {
  packages: [
    {
      key: 'premium',
      label: 'Premium Table',
      prefix: 'P',
      count: 10,
      price: 5000,
      includes: [
        'Hennessy VS or Martell Blue Swift',
        'Shisha x2',
        'Water x5',
        'Coke x4',
        'Spring Roll x1',
        'Samosa x1',
        'Chicken Wings x1',
      ],
    },
    {
      key: 'luxury',
      label: 'Luxury Table',
      prefix: 'L',
      count: 10,
      price: 3500,
      includes: ['Belaire Rosé', 'Shisha x1', 'Chicken Wings x1', 'Spring Rolls x1', 'Water x4'],
    },
    {
      key: 'standard',
      label: 'Standard Table',
      prefix: 'S',
      count: 16,
      price: 2500,
      includes: ['Wine', 'Water x3', 'Full Chicken x1'],
    },
  ],

  tickets: {
    regular: { key: 'regular', label: 'Regular Ticket', price: 250 },
    vip: { key: 'vip', label: 'VIP Ticket', price: 600 },
  },
};
