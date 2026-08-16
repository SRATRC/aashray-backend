import { jest } from '@jest/globals';

// Fresh mock per Razorpay client instance (getRazorpayClient() builds a new
// one on every call), so isolate the .orders.fetch/.create it hits.
const mockRazorpayFetch = jest.fn();
const mockRazorpayCreate = jest.fn();
jest.mock('razorpay', () => {
  return jest.fn().mockImplementation(() => ({
    orders: { fetch: mockRazorpayFetch, create: mockRazorpayCreate }
  }));
});

import moment from 'moment';
import database from '../../config/database.js';
import { resolveOrderForTransactions } from '../../helpers/transactions.helper.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  MAX_APP_PAYMENT_DURATION_MINUTES
} from '../../config/constants.js';

const STALE_CREATED_AT = moment
  .utc()
  .subtract(MAX_APP_PAYMENT_DURATION_MINUTES + 60, 'minutes')
  .toDate();

function txn(overrides) {
  return { id: 1, cardno: 'TESTCARD1', razorpay_order_id: null, ...overrides };
}

const originalNodeEnv = process.env.NODE_ENV;
let t;

beforeEach(async () => {
  t = await database.transaction();
  mockRazorpayFetch.mockReset();
  mockRazorpayCreate.mockReset();
});

afterEach(async () => {
  await t.rollback();
  process.env.NODE_ENV = originalNodeEnv;
});

test('rejects a stale pending transaction with no existing order as expired (400)', async () => {
  const transactions = [
    txn({ status: STATUS_PAYMENT_PENDING, createdAt: STALE_CREATED_AT })
  ];

  await expect(
    resolveOrderForTransactions(transactions, 100, ['b1'], [], t)
  ).rejects.toMatchObject({ statusCode: 400 });
});

test('does not reject a stale cash-pending transaction', async () => {
  const transactions = [
    txn({ status: STATUS_CASH_PENDING, createdAt: STALE_CREATED_AT })
  ];

  const order = await resolveOrderForTransactions(transactions, 100, ['b2'], [], t);
  expect(order).toBeDefined();
});

test('reconciles a stale transaction whose Razorpay order was already paid (409, not 400)', async () => {
  process.env.NODE_ENV = 'qa';
  mockRazorpayFetch.mockResolvedValue({ status: 'paid', amount: 10000 });

  const transactions = [
    txn({
      status: STATUS_PAYMENT_PENDING,
      createdAt: STALE_CREATED_AT,
      razorpay_order_id: 'order_stale_paid'
    })
  ];

  await expect(
    resolveOrderForTransactions(transactions, 100, ['b3'], [], t)
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(mockRazorpayFetch).toHaveBeenCalledWith('order_stale_paid');
});

test('still rejects a stale transaction as expired when its existing order is unpaid, not reused', async () => {
  process.env.NODE_ENV = 'qa';
  mockRazorpayFetch.mockResolvedValue({ status: 'created', amount: 10000 });

  const transactions = [
    txn({
      status: STATUS_PAYMENT_PENDING,
      createdAt: STALE_CREATED_AT,
      razorpay_order_id: 'order_stale_unpaid'
    })
  ];

  await expect(
    resolveOrderForTransactions(transactions, 100, ['b4'], [], t)
  ).rejects.toMatchObject({ statusCode: 400 });
});
