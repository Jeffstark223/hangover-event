const crypto = require('crypto');
const { customAlphabet } = require('nanoid');

// Unambiguous alphabet (no 0/O, 1/I/L) so IDs printed on tickets or
// read aloud at the door are hard to confuse.
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const nano = customAlphabet(ALPHABET, 10);

function randomSegment(len = 10) {
  return nano.length === len ? nano() : customAlphabet(ALPHABET, len)();
}

/** BOOKING-XXXXXXXXXX */
function generateBookingId() {
  return `BK-${randomSegment(10)}`;
}

/** RES-XXXXXXXXXX */
function generateReservationId() {
  return `RSV-${randomSegment(10)}`;
}

/** TCK-XXXXXXXXXX */
function generateTicketId() {
  return `TCK-${randomSegment(10)}`;
}

/**
 * A short-lived, cryptographically random client reference to hand to
 * Hubtel when initiating a charge. Kept separate from the booking ID
 * so a leaked payment reference never reveals the booking ID pattern.
 */
function generatePaymentReference() {
  return `PAY-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
}

module.exports = {
  generateBookingId,
  generateReservationId,
  generateTicketId,
  generatePaymentReference,
};
