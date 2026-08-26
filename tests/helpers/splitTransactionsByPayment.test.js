import { splitTransactionsByPayment } from '../../helpers/transactions.helper.js';

const txn = (id, amount) => ({ id, amount });

describe('splitTransactionsByPayment', () => {
  it('covers everything when the payment matches what is owed', () => {
    const transactions = [txn(1, 1100), txn(2, 600)];

    const { covered, uncovered } = splitTransactionsByPayment(
      transactions,
      170000
    );

    expect(covered.map((t) => t.id)).toEqual([1, 2]);
    expect(uncovered).toEqual([]);
  });

  it('covers everything when the payment exceeds what is owed', () => {
    const { covered, uncovered } = splitTransactionsByPayment(
      [txn(1, 1100)],
      200000
    );

    expect(covered.map((t) => t.id)).toEqual([1]);
    expect(uncovered).toEqual([]);
  });

  // The order_TKp4lCuDbgtvZD case: an order built from the room alone, with
  // six meal transactions stamped on it as well.
  it('leaves the meals pending when the order only paid for the room', () => {
    const transactions = [
      txn(30159, 1100),
      txn(30160, 60),
      txn(30161, 120),
      txn(30162, 120),
      txn(30163, 60),
      txn(30164, 120),
      txn(30165, 120)
    ];

    const { covered, uncovered } = splitTransactionsByPayment(
      transactions,
      110000
    );

    expect(covered.map((t) => t.id)).toEqual([30159]);
    expect(uncovered.map((t) => t.id)).toEqual([
      30160, 30161, 30162, 30163, 30164, 30165
    ]);
  });

  it('settles the earliest transactions first, whatever order they arrive in', () => {
    const { covered, uncovered } = splitTransactionsByPayment(
      [txn(3, 100), txn(1, 100), txn(2, 100)],
      20000
    );

    expect(covered.map((t) => t.id)).toEqual([1, 2]);
    expect(uncovered.map((t) => t.id)).toEqual([3]);
  });

  // Settling a later, smaller transaction while an earlier one goes unpaid is
  // not explicable to the member. The payment stops where the money runs out.
  it('stops at the first transaction the remainder cannot cover', () => {
    const { covered, uncovered } = splitTransactionsByPayment(
      [txn(1, 100), txn(2, 500), txn(3, 100)],
      20000
    );

    expect(covered.map((t) => t.id)).toEqual([1]);
    expect(uncovered.map((t) => t.id)).toEqual([2, 3]);
  });

  // order_TKp4lCuDbgtvZD got `captured` and then `authorized` for the same
  // payment a second apart. The second delivery sees only the six meal rows;
  // measured against the full 110000 they would look affordable and get a free
  // pass, so the caller hands over the payment's remaining budget instead.
  it('gives a redelivery of the same payment nothing left to spend', () => {
    const meals = [
      txn(30160, 60),
      txn(30161, 120),
      txn(30162, 120),
      txn(30163, 60),
      txn(30164, 120),
      txn(30165, 120)
    ];
    const paidInPaise = 110000;
    const alreadySettledInPaise = 110000; // the room, settled by the first call

    const { covered, uncovered } = splitTransactionsByPayment(
      meals,
      paidInPaise - alreadySettledInPaise
    );

    expect(covered).toEqual([]);
    expect(uncovered.map((t) => t.id)).toEqual([
      30160, 30161, 30162, 30163, 30164, 30165
    ]);
  });

  it('covers everything when the payload carries no usable amount', () => {
    const { covered, uncovered } = splitTransactionsByPayment(
      [txn(1, 1100), txn(2, 600)],
      Number(undefined)
    );

    expect(covered.map((t) => t.id)).toEqual([1, 2]);
    expect(uncovered).toEqual([]);
  });

  it('does not mutate the array it is given', () => {
    const transactions = [txn(3, 100), txn(1, 100)];

    splitTransactionsByPayment(transactions, 10000);

    expect(transactions.map((t) => t.id)).toEqual([3, 1]);
  });
});
