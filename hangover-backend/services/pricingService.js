const ticketsConfig = require('../config/tickets.config');
const { ApiError } = require('../utils/apiError');

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** Public, display-safe view of the active ticket catalogue. */
function getCatalog() {
  return Object.values(ticketsConfig.tickets)
    .filter((t) => t.active)
    .map((t) => ({
      key: t.key,
      label: t.label,
      pricingUnit: t.pricingUnit,
      price: t.price,
      attendeesPerUnit: t.attendeesPerUnit,
      maxQuantity: t.pricingUnit === 'group' ? 1 : t.maxQuantity,
      currency: ticketsConfig.currency,
    }));
}

/** Human label for any stored ticket_type, including legacy ones. */
function labelFor(ticketType) {
  if (ticketType && hasOwn(ticketsConfig.tickets, ticketType)) return ticketsConfig.tickets[ticketType].label;
  if (ticketType && hasOwn(ticketsConfig.legacyLabels, ticketType)) return ticketsConfig.legacyLabels[ticketType];
  return ticketType || '';
}

function parseQuantity(raw, def) {
  if (raw === undefined || raw === null || raw === '') return 1;
  let n = raw;
  if (typeof raw === 'string' && /^\d{1,3}$/.test(raw.trim())) n = Number(raw.trim());
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new ApiError(422, 'Invalid booking details.', ['quantity must be a whole number of at least 1.']);
  }
  if (def.pricingUnit === 'group') {
    if (n !== 1) {
      throw new ApiError(422, 'Invalid booking details.', [
        `${def.label} covers exactly ${def.attendeesPerUnit} people. Make a separate booking for each additional group.`,
      ]);
    }
    return 1;
  }
  if (n > def.maxQuantity) {
    throw new ApiError(422, 'Invalid booking details.', [`You can book at most ${def.maxQuantity} ${def.label} tickets at once.`]);
  }
  return n;
}

/**
 * Server-side price calculation. The ONLY inputs are a ticket category key
 * and a quantity; any price/amount sent by a browser is never read.
 *
 * Returns { ticketType, label, pricingUnit, unitPrice, units, attendees, amount }
 *   units     = number of priced units (1 group, or N people)
 *   attendees = number of tickets (and people admitted) the booking produces
 */
function quote(ticketType, quantity) {
  if (typeof ticketType !== 'string' || !ticketType) {
    throw new ApiError(422, 'Invalid booking details.', ['ticketType is required.']);
  }
  if (ticketsConfig.retired.includes(ticketType)) {
    throw new ApiError(422, 'Invalid booking details.', [
      'The Regular ticket is no longer available. Please choose Group of 6, Guys, Girls or Late Bird.',
    ]);
  }
  if (!hasOwn(ticketsConfig.tickets, ticketType) || !ticketsConfig.tickets[ticketType].active) {
    throw new ApiError(422, 'Invalid booking details.', ['ticketType is not an available ticket category.']);
  }
  const def = ticketsConfig.tickets[ticketType];
  const units = parseQuantity(quantity, def);
  return {
    ticketType: def.key,
    label: def.label,
    pricingUnit: def.pricingUnit,
    unitPrice: def.price,
    units,
    attendees: units * def.attendeesPerUnit,
    amount: round2(def.price * units),
  };
}

/**
 * Recomputes what a stored booking must cost, from the price snapshot saved
 * on the booking when it was created. Returns null for bookings that have no
 * snapshot (bookings made under the retired categories);
 * those keep their original validation path.
 */
function expectedAmountForBooking(booking) {
  if (!booking || !booking.price_unit || booking.unit_price == null) return null;
  const units = booking.price_unit === 'group' ? 1 : Number(booking.quantity);
  return round2(Number(booking.unit_price) * units);
}

module.exports = { getCatalog, labelFor, quote, expectedAmountForBooking, round2 };
