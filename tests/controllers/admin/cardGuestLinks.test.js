import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import {
  AdminRoles,
  AdminUsers,
  CardDb,
  GuestRelationship,
  Roles
} from '../../../models/associations.js';
import {
  ROLE_CARD_ADMIN,
  STATUS_GUEST,
  STATUS_MUMUKSHU
} from '../../../config/constants.js';
import CardFactory from '../../factories/cardFactory.js';
import { createAdminAuth } from '../../factories/adminAuthFactory.js';

// Saving a card sends a "profile updated" WhatsApp to the card's mobile
// number. Test cards carry random numbers, so nothing may leave the process.
jest.mock('../../../utils/sendMail.js');
jest.mock('../../../utils/sendWhatsAppMessage.js');
jest.mock('../../../services/notification.service.js');

/**
 * Gap: no test covered the staff card save. It used to delete every guest link
 * where the saved card was the HOST, so editing a member's phone number wiped
 * that member's whole guest list, and editing a guest card never saved its
 * link at all.
 */
describe('Staff card save keeps guest links', () => {
  let AUTH;

  const HOST_A = 'GL_HOST_A';
  const HOST_B = 'GL_HOST_B';
  const HOST_C = 'GL_HOST_C';
  const GUEST_X = 'GL_GUEST_X';
  const GUEST_Y = 'GL_GUEST_Y';

  async function saveBody(cardno, overrides = {}) {
    const card = await CardDb.findOne({ where: { cardno } });
    return {
      cardno,
      issuedto: card.issuedto,
      gender: card.gender,
      dob: card.dob,
      mobno: card.mobno,
      email: card.email,
      idType: card.idType,
      idNo: card.idNo,
      address: card.address,
      country: card.country,
      city: card.city,
      state: card.state,
      pin: card.pin,
      center: card.center,
      status: card.status,
      res_status: card.res_status,
      ...overrides
    };
  }

  const link = (host, guest, type = 'Friend') =>
    GuestRelationship.create({ cardno: host, guest, type, updatedBy: 'test' });

  const linksOf = (where) =>
    GuestRelationship.findAll({ where, order: [['cardno', 'ASC']] });

  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await GuestRelationship.truncate();
    await AdminRoles.truncate();
    await AdminUsers.truncate();
    await Roles.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');
    await CardDb.destroy({
      where: { cardno: [HOST_A, HOST_B, HOST_C, GUEST_X, GUEST_Y] }
    });

    await CardFactory.create(HOST_A);
    await CardFactory.create(HOST_B);
    await CardFactory.create(HOST_C);
    await CardFactory.createGuest(GUEST_X);
    await CardFactory.createGuest(GUEST_Y);

    AUTH = await createAdminAuth('test_card_admin', [ROLE_CARD_ADMIN]);
  });

  beforeEach(async () => {
    await GuestRelationship.truncate();
    // Each guest has one host, as bookings create them.
    await link(HOST_A, GUEST_X);
    await link(HOST_A, GUEST_Y);
  });

  it("editing a host's own card keeps that host's guest list", async () => {
    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send(await saveBody(HOST_A, { city: 'Nagpur' }));

    expect(res.status).toBe(200);
    expect((await CardDb.findOne({ where: { cardno: HOST_A } })).city).toBe('Nagpur');
    const guests = (await linksOf({ cardno: HOST_A })).map((l) => l.guest).sort();
    expect(guests).toEqual([GUEST_X, GUEST_Y]);
  });

  it('saving a guest card with the same host updates that one link', async () => {
    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send(await saveBody(GUEST_X, { referenceCardno: HOST_A, guestType: 'Family' }));

    expect(res.status).toBe(200);
    const links = await linksOf({ guest: GUEST_X });
    expect(links.map((l) => [l.cardno, l.type])).toEqual([[HOST_A, 'Family']]);
  });

  it('naming a new host moves the guest and drops every older host link', async () => {
    // A leftover second host, as the old save could leave behind.
    await link(HOST_B, GUEST_X);

    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send(await saveBody(GUEST_X, { referenceCardno: HOST_C, guestType: 'Driver' }));

    expect(res.status).toBe(200);
    const links = await linksOf({ guest: GUEST_X });
    expect(links.map((l) => [l.cardno, l.type])).toEqual([[HOST_C, 'Driver']]);
    // The old host no longer sees the guest, and keeps their other guests.
    expect((await linksOf({ cardno: HOST_A })).map((l) => l.guest)).toEqual([GUEST_Y]);
    expect(await linksOf({ cardno: HOST_B })).toHaveLength(0);
  });

  it('refuses a host card that does not exist, without saving the card', async () => {
    const before = await CardDb.findOne({ where: { cardno: GUEST_X } });

    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send(
        await saveBody(GUEST_X, {
          issuedto: 'Changed Name',
          referenceCardno: 'GL_NO_SUCH_CARD',
          guestType: 'Friend'
        })
      );

    expect(res.status).toBe(400);
    const after = await CardDb.findOne({ where: { cardno: GUEST_X } });
    expect(after.issuedto).toBe(before.issuedto);
    expect((await linksOf({ guest: GUEST_X })).map((l) => l.cardno)).toEqual([HOST_A]);
  });

  it('refuses a guest named as their own host', async () => {
    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send(await saveBody(GUEST_X, { referenceCardno: GUEST_X, guestType: 'Friend' }));

    expect(res.status).toBe(400);
  });

  it('a guest card saved without its member type keeps all its links', async () => {
    // A partial save, such as a mobile-number fix, leaves the card a guest.
    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send({ cardno: GUEST_X, city: 'Surat' });

    expect(res.status).toBe(200);
    const card = await CardDb.findOne({ where: { cardno: GUEST_X } });
    expect(card.res_status).toBe(STATUS_GUEST);
    expect((await linksOf({ guest: GUEST_X })).map((l) => l.cardno)).toEqual([HOST_A]);
  });

  it('a guest who becomes a Mumukshu loses only the links where they are the guest', async () => {
    // GUEST_X also books for GUEST_Y; that link is theirs and must stay.
    await link(GUEST_X, GUEST_Y);

    const res = await request(app)
      .put('/api/v1/admin/card/update')
      .set(AUTH)
      .send(await saveBody(GUEST_X, { res_status: STATUS_MUMUKSHU }));

    expect(res.status).toBe(200);
    expect(await linksOf({ guest: GUEST_X })).toHaveLength(0);
    expect((await linksOf({ cardno: GUEST_X })).map((l) => l.guest)).toEqual([GUEST_Y]);
    expect((await linksOf({ cardno: HOST_A })).map((l) => l.guest)).toEqual([GUEST_Y]);

    await CardDb.update({ res_status: STATUS_GUEST }, { where: { cardno: GUEST_X } });
  });

  afterAll(async () => {
    await sequelize.close();
  });
});
