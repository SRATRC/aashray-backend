import request from 'supertest';
import moment from 'moment';
import { v4 as uuidv4 } from 'uuid';
import { app, sequelize } from '../../../app.js';
import {
  AdminRoles,
  AdminUsers,
  CardDb,
  Roles,
  Transactions,
  TravelDb
} from '../../../models/associations.js';
import {
  ROLE_TRAVEL_ADMIN,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_CREDITED,
  STATUS_PAYMENT_COMPLETED,
  TYPE_TRAVEL
} from '../../../config/constants.js';
import { parseCredits } from '../../../helpers/transactions.helper.js';
import { sendWhatsAppMessage } from '../../../utils/sendWhatsAppMessage.js';
import CardFactory from '../../factories/cardFactory.js';
import { createAdminAuth } from '../../factories/adminAuthFactory.js';

jest.mock('../../../utils/sendMail.js');
jest.mock('../../../utils/sendWhatsAppMessage.js');
jest.mock('../../../services/notification.service.js');

const PAYER = 'CREDIT_PAYER';

const travelCredit = async () =>
  parseCredits((await CardDb.findOne({ where: { cardno: PAYER } })).credits)[TYPE_TRAVEL] || 0;

// A travel booking the member already cancelled, with its charge in the given state.
async function memberCancelledTrip({ txnStatus, amount, discount }) {
  const bookingid = uuidv4();
  await TravelDb.create({
    bookingid,
    cardno: PAYER,
    date: moment().add(5, 'days').format('YYYY-MM-DD'),
    pickup_point: 'RC',
    drop_point: 'Dadar',
    type: 'regular',
    luggage: 'none',
    leaving_post_adhyayan: 0,
    status: STATUS_CANCELLED,
    updatedBy: PAYER
  });
  await Transactions.create({
    cardno: PAYER,
    bookingid,
    category: TYPE_TRAVEL,
    amount,
    discount,
    status: txnStatus,
    updatedBy: PAYER
  });
  return bookingid;
}

const staffCancelWithCredit = (auth, bookingid) =>
  request(app)
    .post('/api/v1/admin/travel/booking/status')
    .set(auth)
    .send({ bookingid, status: STATUS_ADMIN_CANCELLED, issueCredits: 'yes' });

// WhatsApp's answer when a template is not approved on the account.
function templateMissing() {
  const err = new Error('Template name does not exist in the translation');
  err.response = {
    status: 404,
    data: { error: { message: 'Template name does not exist in the translation' } }
  };
  return err;
}

async function waitForWhatsAppCalls() {
  for (let i = 0; i < 40 && sendWhatsAppMessage.mock.calls.length === 0; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Let any fallback retries finish.
  await new Promise((resolve) => setTimeout(resolve, 300));
}

/**
 * Gaps: no test covered staff "issue credit" on a booking the member had
 * already cancelled, and no test covered the WhatsApp fallback. The first used
 * to credit the full price of a trip that was never paid. The second used to
 * answer a missing cancellation template with an Adhyayan "confirmed" message.
 */
describe('Staff credit on a booking the member already cancelled', () => {
  let AUTH;

  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await AdminRoles.truncate();
    await AdminUsers.truncate();
    await Roles.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardDb.destroy({ where: { cardno: PAYER } });
    await CardFactory.create(PAYER);
    AUTH = await createAdminAuth('test_travel_admin', [ROLE_TRAVEL_ADMIN]);
  });

  beforeEach(async () => {
    await Transactions.destroy({ where: { cardno: PAYER } });
    await TravelDb.destroy({ where: { cardno: PAYER } });
    await CardDb.update({ credits: null }, { where: { cardno: PAYER } });
    sendWhatsAppMessage.mockReset();
    sendWhatsAppMessage.mockResolvedValue({ responseData: {} });
  });

  it('gives no credit for a trip that was never paid', async () => {
    const bookingid = await memberCancelledTrip({
      txnStatus: STATUS_CANCELLED,
      amount: 1500,
      discount: 0
    });

    const res = await staffCancelWithCredit(AUTH, bookingid);

    expect(res.status).toBe(200);
    expect(await travelCredit()).toBe(0);
    const txn = await Transactions.findOne({ where: { bookingid } });
    expect(txn.status).toBe(STATUS_ADMIN_CANCELLED);
  });

  it('returns credit that was applied and never given back', async () => {
    const bookingid = await memberCancelledTrip({
      txnStatus: STATUS_CANCELLED,
      amount: 1200,
      discount: 300
    });

    const res = await staffCancelWithCredit(AUTH, bookingid);

    expect(res.status).toBe(200);
    expect(await travelCredit()).toBe(300);
    const txn = await Transactions.findOne({ where: { bookingid } });
    expect(txn.status).toBe(STATUS_CREDITED);
  });

  it('still credits the full price of a paid trip the member cancelled', async () => {
    // A member's own cancellation of a paid trip leaves the charge completed.
    const bookingid = await memberCancelledTrip({
      txnStatus: STATUS_PAYMENT_COMPLETED,
      amount: 1500,
      discount: 0
    });

    const res = await staffCancelWithCredit(AUTH, bookingid);

    expect(res.status).toBe(200);
    expect(await travelCredit()).toBe(1500);
  });

  it('does not send a "confirmed" WhatsApp when the cancellation template is missing', async () => {
    sendWhatsAppMessage.mockRejectedValue(templateMissing());
    const bookingid = await memberCancelledTrip({
      txnStatus: STATUS_PAYMENT_COMPLETED,
      amount: 1500,
      discount: 0
    });

    const res = await staffCancelWithCredit(AUTH, bookingid);
    expect(res.status).toBe(200);
    await waitForWhatsAppCalls();

    const templates = sendWhatsAppMessage.mock.calls.map((call) => call[1]);
    expect(templates.length).toBeGreaterThan(0);
    // Every attempt is the cancellation template itself (once per language),
    // never a confirmation stand-in.
    expect(new Set(templates).size).toBe(1);
    expect(templates[0]).not.toMatch(/confirm|_cf(_|$)|cnf|2conf/);
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sequelize.close();
  });
});
