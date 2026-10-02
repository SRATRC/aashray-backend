import request from 'supertest';
import bcrypt from 'bcryptjs';
import { app, sequelize } from '../../../app.js';
import {
  AdminRoles,
  AdminUsers,
  CardDb,
  GuestRelationship,
  Roles
} from '../../../models/associations.js';
import { ROLE_AVT_ADMIN, ROLE_CARD_ADMIN } from '../../../config/constants.js';
import CardFactory from '../../factories/cardFactory.js';
import { createAdminAuth } from '../../factories/adminAuthFactory.js';

// Sign-in and password changes send WhatsApp messages to the card's number.
jest.mock('../../../utils/sendMail.js');
jest.mock('../../../utils/sendWhatsAppMessage.js');
jest.mock('../../../services/notification.service.js');

const CARDNO = 'SECRET_1';
const GUEST = 'SECRET_GUEST';
const PUSH_ADDRESS = 'ExponentPushToken[secret-test]';
const PASSWORD = 'right-pass-1';

// A bcrypt hash starts with "$2"; nothing a client receives may contain one.
function expectNoSecrets(record) {
  expect(record).toBeDefined();
  expect(record.token).toBeUndefined();
  expect(String(record.password || '')).not.toMatch(/^\$2/);
}

/**
 * Gap: no test looked at what card replies contain. The member profile replies
 * sent the stored password hash and the push address, and the staff card
 * search and AVT search sent both for every matching member.
 */
describe('Card replies never carry the password hash or push address', () => {
  let STAFF;
  let mobno;

  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await GuestRelationship.truncate();
    await AdminRoles.truncate();
    await AdminUsers.truncate();
    await Roles.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardDb.destroy({ where: { cardno: [CARDNO, GUEST] } });

    await CardFactory.create(CARDNO);
    await CardFactory.createGuest(GUEST);
    await CardDb.update(
      { token: PUSH_ADDRESS, password: bcrypt.hashSync(PASSWORD, 10) },
      { where: { cardno: CARDNO } }
    );
    await GuestRelationship.create({
      cardno: CARDNO,
      guest: GUEST,
      type: 'Friend',
      updatedBy: 'test'
    });
    mobno = String((await CardDb.findOne({ where: { cardno: CARDNO } })).mobno);

    STAFF = await createAdminAuth('test_card_avt_admin', [ROLE_CARD_ADMIN, ROLE_AVT_ADMIN]);
  });

  it('member profile fetch and update', async () => {
    const fetched = await request(app).get(`/api/v1/profile?cardno=${CARDNO}`);
    expect(fetched.status).toBe(200);
    expectNoSecrets(fetched.body.data);

    const updated = await request(app)
      .put('/api/v1/profile')
      .send({ cardno: CARDNO, city: 'Pune' });
    expect(updated.status).toBe(200);
    expectNoSecrets(updated.body.data);
  });

  it('sign-in works with the right password and refuses a wrong one', async () => {
    const wrong = await request(app)
      .post('/api/v1/client/verifyAndLogin')
      .send({ mobno, password: 'wrong-pass', token: PUSH_ADDRESS });
    expect(wrong.status).not.toBe(200);

    const right = await request(app)
      .post('/api/v1/client/verifyAndLogin')
      .send({ mobno, password: PASSWORD, token: PUSH_ADDRESS });
    expect(right.status).toBe(200);
    expect(right.body.data.cardno).toBe(CARDNO);
    expectNoSecrets(right.body.data);
  });

  it('password change checks the current password and still works', async () => {
    const wrong = await request(app)
      .post('/api/v1/client/updatePassword')
      .send({ cardno: CARDNO, current_password: 'nope', new_password: 'new-pass-2' });
    expect(wrong.status).not.toBe(200);

    const changed = await request(app)
      .post('/api/v1/client/updatePassword')
      .send({ cardno: CARDNO, current_password: PASSWORD, new_password: 'new-pass-2' });
    expect(changed.status).toBe(200);
    expectNoSecrets(changed.body.data);

    const signIn = await request(app)
      .post('/api/v1/client/verifyAndLogin')
      .send({ mobno, password: 'new-pass-2', token: PUSH_ADDRESS });
    expect(signIn.status).toBe(200);

    // The push address is still stored for notifications, only never sent out.
    const stored = await CardDb.findOne({ where: { cardno: CARDNO } });
    expect(stored.token).toBe(PUSH_ADDRESS);
  });

  it('staff card search, card list, AVT search and AVT list', async () => {
    for (const path of [
      `/api/v1/admin/card/search/${CARDNO}`,
      '/api/v1/admin/card/getAll',
      '/api/v1/admin/avt/search/',
      '/api/v1/admin/avt/getAll'
    ]) {
      const url =
        path === '/api/v1/admin/avt/search/'
          ? path + encodeURIComponent((await CardDb.findOne({ where: { cardno: CARDNO } })).issuedto)
          : path;
      const res = await request(app).get(url).set(STAFF);
      expect(res.status).toBe(200);
      const mine = res.body.data.find((c) => c.cardno === CARDNO);
      expectNoSecrets(mine);
      res.body.data.forEach(expectNoSecrets);
    }
  });

  it('staff card creation replies without the starter password hash', async () => {
    await CardDb.destroy({ where: { cardno: 'SECRET_NEW' } });

    const res = await request(app)
      .post('/api/v1/admin/card/create')
      .set(STAFF)
      .send({
        cardno: 'SECRET_NEW',
        issuedto: 'New Member',
        gender: 'F',
        dob: '1990-01-01',
        mobno: '9000000123',
        email: 'new@example.com',
        idType: 'AADHAR',
        idNo: '123412341234',
        address: 'Test Address',
        country: 'India',
        state: 'Maharashtra',
        city: 'Pune',
        pin: '411001',
        centre: 'Pune',
        res_status: 'MUMUKSHU'
      });

    expect(res.status).toBe(200);
    expect(res.body.data.cardno).toBe('SECRET_NEW');
    expectNoSecrets(res.body.data);
    expect(res.body.data.password).toBeUndefined();
    await CardDb.destroy({ where: { cardno: 'SECRET_NEW' } });
  });

  it('a card nested inside another result carries no password hash', async () => {
    const rows = await GuestRelationship.findAll({
      where: { guest: GUEST },
      include: [{ model: CardDb }]
    });
    const nested = rows[0].get({ plain: true }).CardDb;
    expect(nested.cardno).toBe(GUEST);
    expect(nested.password).toBeUndefined();
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await sequelize.close();
  });
});
