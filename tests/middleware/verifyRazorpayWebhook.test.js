import crypto from 'crypto';
import request from 'supertest';
import { app, sequelize } from '../../app.js';

jest.mock('../../utils/sendMail.js');

const ENDPOINT = '/api/v1/razorpay/verifyPayment';

// An order id nothing is stamped with, so a request that clears the signature
// check reaches verifyPayment, finds no pending transactions and settles
// nothing. That keeps these tests about the signature alone.
const payload = {
  payload: {
    payment: {
      entity: {
        order_id: 'order_signature_test_unknown',
        id: 'pay_signature_test',
        status: 'captured',
        amount: 110000
      }
    }
  }
};

const body = JSON.stringify(payload);

const sign = (raw, secret) =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

const post = (raw, signature) => {
  const req = request(app).post(ENDPOINT).set('Content-Type', 'application/json');
  if (signature !== undefined) req.set('X-Razorpay-Signature', signature);
  return req.send(raw);
};

/**
 * verifyPayment settles transactions from an order id, a status and an amount
 * it reads out of the request body. Only the signature proves Razorpay sent it.
 */
describe('Razorpay webhook signature', () => {
  const realSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = realSecret;
  });

  it('accepts a body Razorpay signed', async () => {
    const res = await post(body, sign(body, realSecret));

    expect(res.status).toBe(200);
  });

  it('rejects a request with no signature header', async () => {
    const res = await post(body, undefined);

    expect(res.status).toBe(401);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const res = await post(body, sign(body, 'not-the-webhook-secret'));

    expect(res.status).toBe(401);
  });

  // The whole point: a forged "this was paid" must not be accepted.
  it('rejects a body edited after it was signed', async () => {
    const signature = sign(body, realSecret);
    const tampered = body.replace('"amount":110000', '"amount":999900');

    const res = await post(tampered, signature);

    expect(res.status).toBe(401);
  });

  it('rejects everything when the secret is not configured', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const res = await post(body, sign(body, realSecret));

    expect(res.status).toBe(401);
  });

  it('does not record a rejected webhook', async () => {
    const { RazorpayWebhook } = await import('../../models/associations.js');
    const before = await RazorpayWebhook.count();

    await post(body, sign(body, 'not-the-webhook-secret'));

    expect(await RazorpayWebhook.count()).toBe(before);
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await sequelize.close();
  });
});
