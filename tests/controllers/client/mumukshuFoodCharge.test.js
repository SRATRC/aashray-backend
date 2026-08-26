import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import {
  FoodDb,
  RoomBooking,
  Transactions
} from '../../../models/associations.js';
import {
  BREAKFAST_PRICE,
  LUNCH_PRICE,
  DINNER_PRICE,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_LUNCH,
  TYPE_GUEST_DINNER
} from '../../../config/constants.js';

jest.mock('../../../utils/sendMail.js');

const GUEST_1 = 'Guest_1';
const MEALS = [TYPE_GUEST_BREAKFAST, TYPE_GUEST_LUNCH, TYPE_GUEST_DINNER];
const MEAL_PRICE_PER_DAY = BREAKFAST_PRICE + LUNCH_PRICE + DINNER_PRICE;

const day = (n) => moment().add(n, 'days').format('YYYY-MM-DD');

function roomAddon(cardno, checkin, checkout) {
  return {
    booking_type: 'room',
    details: {
      checkin_date: checkin,
      checkout_date: checkout,
      mumukshuGroup: [{ roomType: 'ac', floorType: '', mumukshus: [cardno] }]
    }
  };
}

function foodAddon(cardno, start, end) {
  return {
    booking_type: 'food',
    details: {
      start_date: start,
      end_date: end,
      mumukshuGroup: [
        {
          mumukshus: [cardno],
          meals: MEALS,
          spicy: 1,
          high_tea: 'TEA'
        }
      ]
    }
  };
}

/**
 * A GUEST card booking through /mumukshu/* is charged for meals by
 * bookFoodForMumukshus. The order must cover those meal charges, and the quote
 * from /validate must match what /booking ends up charging.
 */
describe('Mumukshu booking — guest meal charges', () => {
  const checkin = day(10);
  const checkout = day(11);
  const mealDays = 2; // meals cover both the checkin and the checkout date

  const payload = {
    cardno: GUEST_1,
    primary_booking: roomAddon(GUEST_1, checkin, checkout),
    addons: [foodAddon(GUEST_1, checkin, checkout)]
  };

  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await Transactions.truncate();
    await FoodDb.truncate();
    await RoomBooking.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  it('creates a razorpay order that covers every transaction it is stamped on', async () => {
    const res = await request(app).post('/api/v1/mumukshu/booking').send(payload);

    expect(res.status).toBe(200);
    const orderId = res.body.order?.id;
    expect(orderId).toBeDefined();

    const stamped = await Transactions.findAll({
      where: { razorpay_order_id: orderId }
    });

    const stampedTotal = stamped.reduce((sum, txn) => sum + txn.amount, 0);
    const foodTotal = stamped
      .filter((txn) => MEALS.includes(txn.category))
      .reduce((sum, txn) => sum + txn.amount, 0);

    // The meals were charged, so they must be part of what the member pays.
    expect(foodTotal).toBe(mealDays * MEAL_PRICE_PER_DAY);
    expect(res.body.order.amount).toBe(stampedTotal * 100);
  });

  it('quotes the same total from /validate as /booking charges', async () => {
    // One body for both calls: the point of the test is that the quote and the
    // charge agree on identical input, so the two must not drift.
    const body = {
      cardno: GUEST_1,
      primary_booking: roomAddon(GUEST_1, day(13), day(14)),
      addons: [foodAddon(GUEST_1, day(13), day(14))]
    };

    const validateRes = await request(app)
      .post('/api/v1/mumukshu/validate')
      .send(body);

    expect(validateRes.status).toBe(200);

    const bookRes = await request(app).post('/api/v1/mumukshu/booking').send(body);

    expect(bookRes.status).toBe(200);
    expect(validateRes.body.data.totalCharge).toBe(bookRes.body.order.amount / 100);
  });

  afterAll(async () => {
    // The controller fires the confirmation email without awaiting it. Let it
    // finish its queries before the pool goes away, or it throws into teardown.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sequelize.close();
  });
});
