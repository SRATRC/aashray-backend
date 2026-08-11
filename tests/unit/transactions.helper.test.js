import { adjustAmount } from '../../helpers/transactions.helper.js';
import {
  STATUS_PAYMENT_PENDING,
  STATUS_CASH_PENDING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CASH_COMPLETED
} from '../../config/constants.js';

// adjustAmount only calls transaction.update(), so a plain mock object exercises
// the full logic without touching the DB.
function makeTxn({ amount, discount, status }) {
  const txn = { amount, discount, status };
  txn.update = jest.fn(async (payload) => Object.assign(txn, payload));
  return txn;
}

describe('adjustAmount — net-based admin amount edit', () => {
  it('is a no-op when the net is unchanged (the redundant-save bug)', async () => {
    const txn = makeTxn({ amount: 130, discount: 400, status: STATUS_PAYMENT_PENDING });
    await adjustAmount(txn, 130, 'admin', null);
    expect(txn.update).not.toHaveBeenCalled();
  });

  it('lowers the net without refunding already-applied credit', async () => {
    const txn = makeTxn({ amount: 130, discount: 400, status: STATUS_PAYMENT_PENDING });
    await adjustAmount(txn, 50, 'admin', null);
    const payload = txn.update.mock.calls[0][0];
    expect(payload.amount).toBe(50);
    expect(payload.status).toBe(STATUS_PAYMENT_PENDING);
    expect(payload).not.toHaveProperty('discount'); // wallet untouched
    expect(payload.description).toMatch(/credits used: 400/);
  });

  it('raises the net while keeping the pending status', async () => {
    const txn = makeTxn({ amount: 130, discount: 400, status: STATUS_PAYMENT_PENDING });
    await adjustAmount(txn, 200, 'admin', null);
    expect(txn.update.mock.calls[0][0]).toMatchObject({
      amount: 200,
      status: STATUS_PAYMENT_PENDING
    });
  });

  it('settles an online transaction when the net hits 0', async () => {
    const txn = makeTxn({ amount: 130, discount: 400, status: STATUS_PAYMENT_PENDING });
    await adjustAmount(txn, 0, 'admin', null);
    expect(txn.update.mock.calls[0][0]).toMatchObject({
      amount: 0,
      status: STATUS_PAYMENT_COMPLETED
    });
  });

  it('settles a cash transaction as cash-completed when the net hits 0', async () => {
    const txn = makeTxn({ amount: 130, discount: 400, status: STATUS_CASH_PENDING });
    await adjustAmount(txn, 0, 'admin', null);
    expect(txn.update.mock.calls[0][0].status).toBe(STATUS_CASH_COMPLETED);
  });

  it('uses a plain description when no credit is applied', async () => {
    const txn = makeTxn({ amount: 399, discount: 0, status: STATUS_PAYMENT_PENDING });
    await adjustAmount(txn, 400, 'admin', null);
    expect(txn.update.mock.calls[0][0].description).toBe('Balance updated to 400');
  });

  it.each([STATUS_PAYMENT_COMPLETED, STATUS_CASH_COMPLETED])(
    'rejects editing a completed transaction (%s) and never mutates it',
    async (status) => {
      const txn = makeTxn({ amount: 0, discount: 530, status });
      await expect(adjustAmount(txn, 100, 'admin', null)).rejects.toThrow(/completed/i);
      expect(txn.update).not.toHaveBeenCalled();
    }
  );
});
