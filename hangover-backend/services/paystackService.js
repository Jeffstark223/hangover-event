// ============================================================
// Paystack payment integration
//
// Isolates all Paystack-specific logic so the rest of the app never
// needs to know the payment provider's API shape. Only PAYSTACK_SECRET_KEY
// is required for server-side calls (unlike Hubtel's client ID/secret pair).
//
// Docs: https://paystack.com/docs/payments/accept-payments/
//       https://paystack.com/docs/payments/verify-payments/
// ============================================================

const config = require('../config/env');
const logger = require('../utils/logger');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';

async function initiateCheckout({ paymentReference, amount, description, customerName, customerPhone, customerEmail }) {
  if (!config.paystack.secretKey) {
    throw new Error(
      'Paystack credentials are not configured. Set PAYSTACK_SECRET_KEY in .env before accepting payments.'
    );
  }

  // Paystack expects amounts in the smallest currency unit (pesewas for GHS).
  const amountInPesewas = Math.round(Number(amount) * 100);

  const payload = {
    email: customerEmail,
    amount: amountInPesewas,
    currency: 'GHS',
    reference: paymentReference,
    callback_url: config.paystack.callbackUrl,
    metadata: {
      description,
      customerName,
      customerPhone,
      custom_fields: [
        { display_name: 'Guest Name', variable_name: 'guest_name', value: customerName },
        { display_name: 'Phone Number', variable_name: 'phone_number', value: customerPhone },
      ],
    },
  };

  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.paystack.secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.status !== true) {
    logger.error('Paystack transaction initialize failed', response.status, data);
    throw new Error(data.message || 'Unable to start payment with Paystack. Please try again shortly.');
  }

  return {
    checkoutUrl: data.data?.authorization_url,
    accessCode: data.data?.access_code,
    reference: data.data?.reference,
    raw: data,
  };
}

async function verifyTransaction({ paymentReference }) {
  if (!config.paystack.secretKey) {
    throw new Error('Paystack credentials are not configured.');
  }

  logger.info(`Verifying Paystack transaction: ${paymentReference}`);

  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${encodeURIComponent(paymentReference)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  const rawResponse = await response.text();

  let data = {};

  try {
    data = JSON.parse(rawResponse);
  } catch (err) {
    logger.error(
      'Paystack returned non-JSON response:',
      rawResponse
    );
  }

  if (!response.ok || data.status !== true) {
    logger.error(
      'Paystack verification failed:',
      response.status,
      JSON.stringify(data)
    );

    return {
      verified: false,
      status: 'error',
      amount: null,
      raw: data,
    };
  }

  const tx = data.data || {};

  return {
    verified: tx.status === 'success',
    status: tx.status,
    amount:
      typeof tx.amount === 'number'
        ? tx.amount / 100
        : null,
    raw: tx,
  };
}

module.exports = { initiateCheckout, verifyTransaction };