import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import { verifyRazorpayWebhook } from '../../middleware/verifyRazorpayWebhook.js';

const ENDPOINT = '/webhook';
const SECRET = 'webhook-test-secret';
const body = JSON.stringify({ event: 'payment.captured' });

const sign = (raw, secret) =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

const testApp = express();
testApp.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
testApp.post(ENDPOINT, verifyRazorpayWebhook, (_req, res) => {
  res.status(200).send({ status: 'ok' });
});
testApp.use((err, _req, res, _next) => {
  res.status(err.statusCode || 500).send({ message: err.message });
});

const post = (raw, signature) => {
  const req = request(testApp)
    .post(ENDPOINT)
    .set('Content-Type', 'application/json');
  if (signature !== undefined) req.set('X-Razorpay-Signature', signature);
  return req.send(raw);
};

describe('Razorpay webhook signature middleware', () => {
  const originalSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = originalSecret;
  });

  it('accepts a body signed with the configured secret', async () => {
    const res = await post(body, sign(body, SECRET));

    expect(res.status).toBe(200);
  });

  it('rejects a request with no signature header', async () => {
    const res = await post(body, undefined);

    expect(res.status).toBe(401);
  });

  it('rejects a signature computed with the wrong secret', async () => {
    const res = await post(body, sign(body, 'wrong-secret'));

    expect(res.status).toBe(401);
  });

  it('rejects a body edited after it was signed', async () => {
    const res = await post(
      JSON.stringify({ event: 'payment.failed' }),
      sign(body, SECRET)
    );

    expect(res.status).toBe(401);
  });

  it('rejects everything when the secret is not configured', async () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;

    const res = await post(body, sign(body, SECRET));

    expect(res.status).toBe(401);
  });
});
