import request from 'supertest';
import moment from 'moment';
import { app, sequelize } from '../../../app.js';
import { BlockDates, UtsavDb } from '../../../models/associations.js';
import {
  STATUS_ACTIVE,
  STATUS_INACTIVE,
  ROLE_ROOM_ADMIN,
  RESEARCH_CENTRE
} from '../../../config/constants.js';
import { createAdminAuth } from '../../factories/adminAuthFactory.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

describe('PUT /api/v1/admin/stay/toggle_rc_block_mode/:id', () => {
  let adminAuth;
  const START = fmt(moment().add(200, 'day'));
  const END = fmt(moment().add(205, 'day'));

  beforeAll(async () => {
    adminAuth = await createAdminAuth('toggle_rc_mode_admin', [ROLE_ROOM_ADMIN]);
  });

  afterEach(async () => {
    await BlockDates.destroy({
      where: { comments: ['test manual block', 'test utsav auto block'] }
    });
    await UtsavDb.destroy({
      where: { name: 'Test Utsav Toggle' }
    });
  });

  it('toggles mode from waitlist (true) to hard block (false) without payload', async () => {
    const block = await BlockDates.create({
      checkin: START,
      checkout: END,
      comments: 'test manual block',
      status: STATUS_ACTIVE,
      allow_waitlist: true,
      updatedBy: 'test'
    });

    const res = await request(app)
      .put(`/api/v1/admin/stay/toggle_rc_block_mode/${block.id}`)
      .set(adminAuth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.allow_waitlist).toBe(false);

    const reloaded = await BlockDates.findByPk(block.id);
    expect(reloaded.allow_waitlist).toBe(false);
  });

  it('toggles mode from hard block (false) to waitlist (true) without payload', async () => {
    const block = await BlockDates.create({
      checkin: START,
      checkout: END,
      comments: 'test manual block',
      status: STATUS_ACTIVE,
      allow_waitlist: false,
      updatedBy: 'test'
    });

    const res = await request(app)
      .put(`/api/v1/admin/stay/toggle_rc_block_mode/${block.id}`)
      .set(adminAuth)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.allow_waitlist).toBe(true);

    const reloaded = await BlockDates.findByPk(block.id);
    expect(reloaded.allow_waitlist).toBe(true);
  });

  it('sets explicit target mode idempotently with { allow_waitlist: false }', async () => {
    const block = await BlockDates.create({
      checkin: START,
      checkout: END,
      comments: 'test manual block',
      status: STATUS_ACTIVE,
      allow_waitlist: false,
      updatedBy: 'test'
    });

    const res = await request(app)
      .put(`/api/v1/admin/stay/toggle_rc_block_mode/${block.id}`)
      .set(adminAuth)
      .send({ allow_waitlist: false });

    expect(res.status).toBe(200);
    expect(res.body.data.allow_waitlist).toBe(false);

    const reloaded = await BlockDates.findByPk(block.id);
    expect(reloaded.allow_waitlist).toBe(false);
  });

  it('rejects non-boolean allow_waitlist in payload with 400', async () => {
    const block = await BlockDates.create({
      checkin: START,
      checkout: END,
      comments: 'test manual block',
      status: STATUS_ACTIVE,
      allow_waitlist: true,
      updatedBy: 'test'
    });

    const res = await request(app)
      .put(`/api/v1/admin/stay/toggle_rc_block_mode/${block.id}`)
      .set(adminAuth)
      .send({ allow_waitlist: 'false' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/allow_waitlist must be a boolean/);
  });

  it('returns 400 when attempting to change mode of an inactive block', async () => {
    const block = await BlockDates.create({
      checkin: START,
      checkout: END,
      comments: 'test manual block',
      status: STATUS_INACTIVE,
      allow_waitlist: true,
      updatedBy: 'test'
    });

    const res = await request(app)
      .put(`/api/v1/admin/stay/toggle_rc_block_mode/${block.id}`)
      .set(adminAuth)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot change mode of an inactive block/);
  });

  it('returns 400 when attempting to change mode of an utsav auto-block', async () => {
    const utsav = await UtsavDb.create({
      name: 'Test Utsav Toggle',
      start_date: START,
      end_date: END,
      month: moment(START).format('MMMM'),
      total_seats: 50,
      location: RESEARCH_CENTRE,
      available_seats: 50
    });

    const autoBlock = await BlockDates.create({
      checkin: START,
      checkout: fmt(moment(END).add(1, 'day')),
      comments: 'Test Utsav Toggle auto-block',
      status: STATUS_ACTIVE,
      allow_waitlist: false,
      updatedBy: 'test'
    });

    const res = await request(app)
      .put(`/api/v1/admin/stay/toggle_rc_block_mode/${autoBlock.id}`)
      .set(adminAuth)
      .send({ allow_waitlist: true });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Cannot change mode for Utsav auto-blocks/);
  });

  it('returns 404 for nonexistent block ID', async () => {
    const res = await request(app)
      .put('/api/v1/admin/stay/toggle_rc_block_mode/9999999')
      .set(adminAuth)
      .send({});

    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/stay/block_rc input validation', () => {
  let adminAuth;
  const START = fmt(moment().add(210, 'day'));
  const END = fmt(moment().add(215, 'day'));

  beforeAll(async () => {
    adminAuth = await createAdminAuth('block_rc_val_admin', [ROLE_ROOM_ADMIN]);
  });

  afterEach(async () => {
    await BlockDates.destroy({
      where: { comments: 'test validation block' }
    });
  });

  it('creates a hard block when allow_waitlist is explicitly false', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stay/block_rc')
      .set(adminAuth)
      .send({
        checkin_date: START,
        checkout_date: END,
        comments: 'test validation block',
        allow_waitlist: false
      });

    expect(res.status).toBe(201);
    expect(res.body.data.allow_waitlist).toBe(false);
  });

  it('defaults to allow_waitlist: true when omitted', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stay/block_rc')
      .set(adminAuth)
      .send({
        checkin_date: START,
        checkout_date: END,
        comments: 'test validation block'
      });

    expect(res.status).toBe(201);
    expect(res.body.data.allow_waitlist).toBe(true);
  });

  it('rejects non-boolean allow_waitlist with 400', async () => {
    const res = await request(app)
      .post('/api/v1/admin/stay/block_rc')
      .set(adminAuth)
      .send({
        checkin_date: START,
        checkout_date: END,
        comments: 'test validation block',
        allow_waitlist: 'false'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/allow_waitlist must be a boolean/);
  });
});

describe('GET /api/v1/admin/stay/rc_block_list', () => {
  let adminAuth;
  const START = fmt(moment().add(220, 'day'));
  const END = fmt(moment().add(225, 'day'));

  beforeAll(async () => {
    adminAuth = await createAdminAuth('rc_block_list_admin', [ROLE_ROOM_ADMIN]);
  });

  afterEach(async () => {
    await BlockDates.destroy({
      where: { comments: ['test rc_block_list hard', 'test rc_block_list waitlist'] }
    });
  });

  it('returns allow_waitlist attribute in block list data', async () => {
    await BlockDates.create({
      checkin: START,
      checkout: END,
      comments: 'test rc_block_list hard',
      status: STATUS_ACTIVE,
      allow_waitlist: false,
      updatedBy: 'test'
    });
    await BlockDates.create({
      checkin: fmt(moment().add(226, 'day')),
      checkout: fmt(moment().add(230, 'day')),
      comments: 'test rc_block_list waitlist',
      status: STATUS_ACTIVE,
      allow_waitlist: true,
      updatedBy: 'test'
    });

    const res = await request(app)
      .get('/api/v1/admin/stay/rc_block_list')
      .set(adminAuth);

    expect(res.status).toBe(200);
    const hardBlock = res.body.data.find((b) => b.comments === 'test rc_block_list hard');
    const waitlistBlock = res.body.data.find((b) => b.comments === 'test rc_block_list waitlist');
    expect(hardBlock).toBeDefined();
    expect(hardBlock.allow_waitlist).toBe(false);
    expect(waitlistBlock).toBeDefined();
    expect(waitlistBlock.allow_waitlist).toBe(true);
  });
});
