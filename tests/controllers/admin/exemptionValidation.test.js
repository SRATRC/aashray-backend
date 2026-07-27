import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { RoomBookingExemption } from '../../../models/associations.js';
import { createAdminAuth } from '../../helpers/adminAuthFixture.js';

jest.mock('../../../utils/sendMail.js');

// Backend-enforced exemption date validation (Task B7.5). A TEMPORARY exemption
// requires both valid_from and valid_to with valid_from <= valid_to; a PERMANENT
// exemption ignores the dates. These tests need MySQL and are meant to run
// locally (`npx jest tests/controllers/admin/exemptionValidation.test.js`) — the
// sandbox has no DB.
let ADMIN_AUTH;

describe('Admin exemption date validation (backend enforcement)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBookingExemption.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

    ADMIN_AUTH = await createAdminAuth(sequelize, 'test_exemption_admin');
  });

  const post = (body) =>
    request(app).post('/api/v1/admin/stay/exemptions').set(ADMIN_AUTH).send(body);

  it('temporary exemption missing both dates -> 400', async () => {
    const res = await post({ cardno: 'ANY', is_permanent: false });
    expect(res.status).toBe(400);
  });

  it('temporary exemption missing valid_to -> 400', async () => {
    const res = await post({ cardno: 'ANY', is_permanent: false, valid_from: '2026-08-01' });
    expect(res.status).toBe(400);
  });

  it('temporary exemption with valid_from > valid_to -> 400', async () => {
    const res = await post({
      cardno: 'ANY',
      is_permanent: false,
      valid_from: '2026-08-10',
      valid_to: '2026-08-01'
    });
    expect(res.status).toBe(400);
  });

  it('temporary exemption with malformed date -> 400', async () => {
    const res = await post({
      cardno: 'ANY',
      is_permanent: false,
      valid_from: '10-08-2026',
      valid_to: '2026-08-20'
    });
    expect(res.status).toBe(400);
  });

  it('permanent exemption ignores dates (no 400 from date validation)', async () => {
    // With no matching card this proceeds past date validation to the card
    // lookup and returns 404 — proving the permanent path does NOT 400 on dates.
    const res = await post({ cardno: 'DOES_NOT_EXIST', is_permanent: true });
    expect(res.status).not.toBe(400);
  });
});
