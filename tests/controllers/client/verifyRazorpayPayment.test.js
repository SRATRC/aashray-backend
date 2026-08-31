import { jest } from '@jest/globals';

const mockPaymentFetch = jest.fn();
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    payments: { fetch: mockPaymentFetch }
  }));
});

import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { RazorpayWebhook, Transactions } from '../../../models/associations.js';
import {
  STATUS_PAYMENT_COMPLETED,
  STATUS_PAYMENT_PENDING,
  TYPE_ROOM
} from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';

jest.mock('../../../utils/sendMail.js');

const ENDPOINT = '/api/v1/razorpay/verifyPayment';

const payment = {
  id: 'pay_api_verification_test',
  order_id: 'order_api_verification_test_unknown',
  status: 'captured',
  amount: 110000,
  currency: 'INR'
};
const TRANSACTION_BOOKING_ID = 'payment_api_verification_late_fee';

const payload = (overrides = {}) => ({
  payload: {
    payment: {
      entity: { ...payment, ...overrides }
    }
  }
});

describe('Razorpay webhook API verification fallback', () => {
  beforeEach(() => {
    mockPaymentFetch.mockReset();
    mockPaymentFetch.mockResolvedValue(payment);
  });

  afterEach(async () => {
    await Transactions.destroy({
      where: { bookingid: TRANSACTION_BOOKING_ID }
    });
  });

  it('accepts an unsigned webhook after Razorpay confirms the payment', async () => {
    const res = await request(app).post(ENDPOINT).send(payload());

    expect(res.status).toBe(200);
    expect(mockPaymentFetch).toHaveBeenCalledWith(payment.id);
  });

  it('settles from Razorpay status instead of the unsigned webhook status', async () => {
    const transaction = await Transactions.create({
      cardno: MUMUKSHU_1,
      bookingid: TRANSACTION_BOOKING_ID,
      category: TYPE_ROOM,
      amount: payment.amount / 100,
      status: STATUS_PAYMENT_PENDING,
      razorpay_order_id: payment.order_id
    });

    const res = await request(app)
      .post(ENDPOINT)
      .send(payload({ status: 'authorized' }));

    expect(res.status).toBe(200);
    await transaction.reload();
    expect(transaction.status).toBe(STATUS_PAYMENT_COMPLETED);
  });

  it('rejects a payment whose order does not match Razorpay', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send(payload({ order_id: 'order_forged' }));

    expect(res.status).toBe(401);
  });

  it('rejects a payment whose amount does not match Razorpay', async () => {
    const res = await request(app)
      .post(ENDPOINT)
      .send(payload({ amount: payment.amount + 100 }));

    expect(res.status).toBe(401);
  });

  it('returns a retryable error when Razorpay cannot verify the payment', async () => {
    mockPaymentFetch.mockRejectedValue(new Error('Razorpay unavailable'));

    const before = await RazorpayWebhook.count();
    const res = await request(app).post(ENDPOINT).send(payload());

    expect(res.status).toBe(503);
    expect(await RazorpayWebhook.count()).toBe(before);
  });

  it('rejects a payload without a payment id', async () => {
    const res = await request(app).post(ENDPOINT).send(payload({ id: null }));

    expect(res.status).toBe(400);
    expect(mockPaymentFetch).not.toHaveBeenCalled();
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await sequelize.close();
  });
});
