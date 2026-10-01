import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import {
  CardDb,
  FoodDb,
  RoomBooking,
  Transactions
} from '../../../models/associations.js';
import {
  BREAKFAST_PRICE,
  DINNER_PRICE,
  LUNCH_PRICE,
  STATUS_CANCELLED,
  STATUS_PAYMENT_COMPLETED,
  TYPE_FOOD,
  TYPE_GUEST_BREAKFAST,
  TYPE_GUEST_DINNER,
  TYPE_GUEST_LUNCH
} from '../../../config/constants.js';
import { parseCredits } from '../../../helpers/transactions.helper.js';
import CardFactory from '../../factories/cardFactory.js';

jest.mock('../../../utils/sendMail.js');
jest.mock('../../../utils/sendWhatsAppMessage.js');
jest.mock('../../../services/notification.service.js');

const GUEST = 'FOOD_CREDIT_GUEST';
const MEALS = [TYPE_GUEST_BREAKFAST, TYPE_GUEST_LUNCH, TYPE_GUEST_DINNER];
const MEAL_DAYS = 2; // meals cover the check-in and the check-out date
const FOOD_CHARGE = MEAL_DAYS * (BREAKFAST_PRICE + LUNCH_PRICE + DINNER_PRICE);

const day = (n) => moment().add(n, 'days').format('YYYY-MM-DD');

function body(checkin, checkout) {
  return {
    cardno: GUEST,
    primary_booking: {
      booking_type: 'room',
      details: {
        checkin_date: checkin,
        checkout_date: checkout,
        mumukshuGroup: [{ roomType: 'ac', floorType: '', mumukshus: [GUEST] }]
      }
    },
    addons: [
      {
        booking_type: 'food',
        details: {
          start_date: checkin,
          end_date: checkout,
          mumukshuGroup: [{ mumukshus: [GUEST], meals: MEALS, spicy: 1, high_tea: 'TEA' }]
        }
      }
    ]
  };
}

const MEMBER = 'FOOD_CREDIT_MEMBER';
const HOSTED_GUEST = 'FOOD_CREDIT_HOSTED';

const foodCredit = async (cardno = GUEST) =>
  parseCredits((await CardDb.findOne({ where: { cardno } })).credits)[TYPE_FOOD] || 0;

const setFoodCredit = (amount, cardno = GUEST) =>
  CardDb.update(
    { credits: amount === null ? null : { [TYPE_FOOD]: amount } },
    { where: { cardno } }
  );

// A member booking a room and meals for a guest, through the guest route.
function guestRouteBody(checkin, checkout) {
  return {
    cardno: MEMBER,
    primary_booking: {
      booking_type: 'room',
      details: {
        checkin_date: checkin,
        checkout_date: checkout,
        guestGroup: [{ roomType: 'ac', floorType: '', guests: [HOSTED_GUEST] }]
      }
    },
    addons: [
      {
        booking_type: 'food',
        details: {
          start_date: checkin,
          end_date: checkout,
          guestGroup: [{ guests: [HOSTED_GUEST], meals: MEALS, spicy: 1, high_tea: 'TEA' }]
        }
      }
    ]
  };
}

const cancelMeal = (requester, date, mealType, bookedFor) =>
  request(app)
    .patch('/api/v1/food/cancel')
    .send({
      cardno: requester,
      food_data: [{ date, mealType, ...(bookedFor ? { bookedFor } : {}) }]
    });

async function quoteAndBook(payload) {
  const quote = await request(app).post('/api/v1/mumukshu/validate').send(payload);
  expect(quote.status).toBe(200);
  const book = await request(app).post('/api/v1/mumukshu/booking').send(payload);
  expect(book.status).toBe(200);
  const roomCharge = quote.body.data.roomDetails.reduce((s, r) => s + r.charge, 0);
  const meals = await Transactions.findAll({
    where: { cardno: GUEST, category: MEALS },
    order: [['id', 'ASC']]
  });
  return { quote: quote.body.data, book: book.body, roomCharge, meals };
}

/**
 * Gap: no test booked meals for a member holding food credit. The credit was
 * earned on meal cancellations but every new meal was charged at full price,
 * so the balance could never be spent (36 cards held Rs 10,620 in Aug 2026).
 */
describe('Guest meals spend the payer\'s food credit', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await Transactions.truncate();
    await FoodDb.truncate();
    await RoomBooking.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardDb.destroy({ where: { cardno: [GUEST, MEMBER, HOSTED_GUEST] } });
    await CardFactory.createGuest(GUEST);
    await CardFactory.create(MEMBER);
    await CardFactory.createGuest(HOSTED_GUEST);
  });

  beforeEach(async () => {
    const cards = [GUEST, MEMBER, HOSTED_GUEST];
    await Transactions.destroy({ where: { cardno: cards } });
    await FoodDb.destroy({ where: { cardno: cards } });
    await RoomBooking.destroy({ where: { cardno: cards } });
  });

  it('partial credit: the quote shows it, the order is reduced by it, and the balance is used up', async () => {
    await setFoodCredit(200);

    const { quote, book, roomCharge, meals } = await quoteAndBook(body(day(20), day(21)));

    expect(quote.foodDetails.charge).toBe(FOOD_CHARGE);
    expect(quote.foodDetails.availableCredits).toBe(200);
    expect(book.order.amount).toBe((roomCharge + FOOD_CHARGE - 200) * 100);
    expect(meals.reduce((s, m) => s + m.discount, 0)).toBe(200);
    expect(meals.reduce((s, m) => s + m.amount, 0)).toBe(FOOD_CHARGE - 200);
    expect(await foodCredit()).toBe(0);

    // What Razorpay collects equals the charges stamped with its order id.
    const stamped = await Transactions.findAll({ where: { razorpay_order_id: book.order.id } });
    expect(stamped.reduce((s, t) => s + t.amount, 0) * 100).toBe(book.order.amount);
  });

  it('credit that covers every meal marks the meals paid and leaves them off the order', async () => {
    await setFoodCredit(10000);

    const { quote, book, roomCharge, meals } = await quoteAndBook(body(day(23), day(24)));

    expect(quote.foodDetails.availableCredits).toBe(FOOD_CHARGE);
    expect(book.order.amount).toBe(roomCharge * 100);
    expect(meals.every((m) => m.status === STATUS_PAYMENT_COMPLETED && m.amount === 0)).toBe(true);
    expect(meals.every((m) => m.razorpay_order_id === null)).toBe(true);
    expect(await foodCredit()).toBe(10000 - FOOD_CHARGE);
  });

  it('no food credit: meals are charged in full, as before', async () => {
    await CardDb.update({ credits: null }, { where: { cardno: GUEST } });

    const { quote, book, roomCharge, meals } = await quoteAndBook(body(day(26), day(27)));

    expect(quote.foodDetails.availableCredits).toBe(0);
    expect(book.order.amount).toBe((roomCharge + FOOD_CHARGE) * 100);
    expect(meals.every((m) => m.discount === 0)).toBe(true);
  });

  it('guest route: a member spends food credit on a guest\'s meals and gets it back on cancel', async () => {
    await setFoodCredit(200, MEMBER);
    const checkin = day(29);
    const payload = guestRouteBody(checkin, day(30));

    const quote = await request(app).post('/api/v1/guest/validate').send(payload);
    expect(quote.status).toBe(200);
    expect(quote.body.data.foodDetails.availableCredits).toBe(200);
    const roomCharge = quote.body.data.roomDetails.reduce((s, r) => s + r.charge, 0);

    const book = await request(app).post('/api/v1/guest/booking').send(payload);
    expect(book.status).toBe(200);
    // The guest route returns the order under `data`.
    expect(book.body.data.amount).toBe((roomCharge + FOOD_CHARGE - 200) * 100);
    expect(await foodCredit(MEMBER)).toBe(0);

    // Credit was spent on the first meals, so the first breakfast is paid by credit.
    const cancel = await cancelMeal(MEMBER, checkin, 'breakfast', HOSTED_GUEST);
    expect(cancel.status).toBe(200);
    expect(await foodCredit(MEMBER)).toBe(BREAKFAST_PRICE);
  });

  it('a guest who cancels their own credit-paid meal gets the credit back', async () => {
    await setFoodCredit(10000);
    const checkin = day(32);
    await quoteAndBook(body(checkin, day(33)));
    const before = await foodCredit();

    const cancel = await cancelMeal(GUEST, checkin, 'lunch');

    expect(cancel.status).toBe(200);
    expect(await foodCredit()).toBe(before + LUNCH_PRICE);
  });

  it('cancelling an unpaid meal closes its charge, so it can no longer be paid', async () => {
    await setFoodCredit(null);
    const checkin = day(35);
    await quoteAndBook(body(checkin, day(36)));

    const cancel = await cancelMeal(GUEST, checkin, 'dinner');

    expect(cancel.status).toBe(200);
    const charges = await Transactions.findAll({
      where: { cardno: GUEST, category: TYPE_GUEST_DINNER },
      order: [['createdAt', 'ASC']]
    });
    const statuses = charges.map((c) => c.status);
    // One dinner per day: the cancelled day's charge is closed, the other stays open.
    expect(statuses.filter((st) => st === STATUS_CANCELLED)).toHaveLength(1);
    expect(await foodCredit()).toBe(0);
  });

  afterAll(async () => {
    // The booking email is sent without being awaited; let it finish first.
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await sequelize.close();
  });
});
