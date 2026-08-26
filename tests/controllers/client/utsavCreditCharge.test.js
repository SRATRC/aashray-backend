import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import {
  CardDb,
  Transactions,
  UtsavBooking,
  UtsavDb,
  UtsavPackagesDb
} from '../../../models/associations.js';
import { STATUS_OPEN } from '../../../config/constants.js';
import { MUMUKSHU_1 } from '../../testConstants.js';

jest.mock('../../../utils/sendMail.js');

const PACKAGE_PRICE = 4750;
const day = (n) => moment().add(n, 'days').format('YYYY-MM-DD');

async function createUtsavWithPackage(offset) {
  const utsav = await UtsavDb.create({
    name: `Credit Test Utsav ${offset}`,
    start_date: day(offset),
    end_date: day(offset + 2),
    month: moment().add(offset, 'days').month(),
    total_seats: 400,
    available_seats: 100,
    location: 'Research Centre',
    status: STATUS_OPEN
  });

  const pkg = await UtsavPackagesDb.create({
    utsavid: utsav.id,
    name: 'Full package',
    start_date: day(offset),
    end_date: day(offset + 2),
    amount: PACKAGE_PRICE,
    updatedBy: 'test'
  });

  return { utsav, pkg };
}

const bookingBody = (utsav, pkg) => ({
  cardno: MUMUKSHU_1,
  primary_booking: {
    booking_type: 'utsav',
    details: {
      utsavid: utsav.id,
      mumukshus: [
        {
          cardno: MUMUKSHU_1,
          packageid: pkg.id,
          arrival: 'self',
          carno: null,
          other: null,
          volunteer: 0
        }
      ]
    }
  }
});

const setCredits = (utsavCredits) =>
  CardDb.update(
    { credits: utsavCredits === null ? null : { utsav: utsavCredits } },
    { where: { cardno: MUMUKSHU_1 } }
  );

/**
 * Utsav credit is spent when the transaction is created, so the Razorpay order
 * must be built from what is left to pay. Charging the package price collects
 * the credit twice: once off the balance, once off the card.
 */
describe('Utsav booking — credits already spent must not be charged again', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await Transactions.truncate();
    await UtsavBooking.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  afterEach(async () => {
    await setCredits(null);
  });

  it('bills only the balance when credit covers part of the package', async () => {
    const { utsav, pkg } = await createUtsavWithPackage(40);
    await setCredits(1000);

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send(bookingBody(utsav, pkg));

    expect(res.status).toBe(200);

    const orderId = res.body.order?.id;
    expect(orderId).toBeDefined();

    const stamped = await Transactions.findAll({
      where: { razorpay_order_id: orderId }
    });
    const stampedTotal = stamped.reduce((sum, txn) => sum + txn.amount, 0);

    expect(stampedTotal).toBe(PACKAGE_PRICE - 1000);
    expect(res.body.order.amount).toBe(stampedTotal * 100);

    const card = await CardDb.findOne({ where: { cardno: MUMUKSHU_1 } });
    expect(card.credits?.utsav ?? 0).toBe(0);
  });

  it('asks for no payment at all when credit covers the whole package', async () => {
    const { utsav, pkg } = await createUtsavWithPackage(50);
    await setCredits(PACKAGE_PRICE);

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send(bookingBody(utsav, pkg));

    expect(res.status).toBe(200);
    // Nothing left to pay, so no order — the app must not open a payment sheet
    // for a booking the credit already settled.
    expect(res.body.order.amount).toBe(0);
    expect(res.body.order.id).toBeUndefined();
  });

  it('bills the full package when the card holds no credit', async () => {
    const { utsav, pkg } = await createUtsavWithPackage(60);

    const res = await request(app)
      .post('/api/v1/mumukshu/booking')
      .send(bookingBody(utsav, pkg));

    expect(res.status).toBe(200);
    expect(res.body.order.amount).toBe(PACKAGE_PRICE * 100);
  });

  afterAll(async () => {
    // The controller fires confirmation email/WhatsApp without awaiting them.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sequelize.close();
  });
});
