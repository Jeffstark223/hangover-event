// ============================================================
// Paystack payment integration
// ============================================================

const config = require('../config/env');
const logger = require('../utils/logger');

const PAYSTACK_BASE_URL = 'https://api.paystack.co';


async function initiateCheckout({ paymentReference, amount, description, customerName, customerPhone, customerEmail, bookingId }) {

  if (!config.paystack.secretKey) {
    throw new Error(
      'Paystack credentials are not configured.'
    );
  }

  const amountInPesewas = Math.round(Number(amount) * 100);

  const payload = {
    email: customerEmail,
    amount: amountInPesewas,
    currency: 'GHS',
    reference: paymentReference,
    callback_url: `${config.paystack.callbackUrl}?bookingId=${bookingId}`,

    metadata: {
      description,
      customerName,
      customerPhone
    }
  };


  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/initialize`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );


  const data = await response.json();


  if (!response.ok || data.status !== true) {
    logger.error(
      'Paystack initialization failed',
      response.status,
      data
    );

    throw new Error(
      data.message || 'Payment initialization failed'
    );
  }


  return {
    checkoutUrl: data.data.authorization_url,
    reference: data.data.reference
  };

}



async function verifyTransaction({
  paymentReference
}) {

  if (!config.paystack.secretKey) {
    throw new Error(
      'Paystack secret key missing'
    );
  }


  const response = await fetch(
    `${PAYSTACK_BASE_URL}/transaction/verify/${paymentReference}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.paystack.secretKey}`,
        'Content-Type': 'application/json'
      }
    }
  );


  const data = await response.json();


  logger.info(
    'Paystack verification response:',
    JSON.stringify(data)
  );


  if (!response.ok) {

    return {
      verified: false,
      status: 'failed',
      amount: null
    };

  }


  const transaction = data.data;


  if (
    data.status === true &&
    transaction.status === 'success'
  ) {

    return {

      verified: true,

      status: 'success',

      amount:
        transaction.amount / 100,

      raw: transaction

    };

  }


  return {

    verified: false,

    status: transaction?.status || 'failed',

    amount: null,

    raw: transaction

  };

}


module.exports = {
  initiateCheckout,
  verifyTransaction
};