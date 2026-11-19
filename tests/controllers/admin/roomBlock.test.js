import request from 'supertest';
import moment from 'moment';
import jwt from 'jsonwebtoken';
import { app, sequelize } from '../../../app.js';
import {
  RoomBlock,
  RoomDb,
  AdminUsers,
  AdminRoles,
  Roles
} from '../../../models/associations.js';
import {
  STATUS_ACTIVE,
  ROLE_ROOM_ADMIN,
  ROOM_BLOCK_ACTIVE,
  ROOM_BLOCK_CANCELLED,
  ROOM_BLOCKED,
  ROOM_STATUS_AVAILABLE
} from '../../../config/constants.js';

jest.mock('../../../utils/sendMail.js');

const fmt = (m) => m.format('YYYY-MM-DD');

let ADMIN_AUTH;

describe('Admin Room & Bed Maintenance Blocking (/api/v1/admin/stay/room_block)', () => {
  beforeAll(async () => {
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 0');
    await RoomBlock.truncate();
    await RoomDb.truncate();
    await AdminRoles.truncate();
    await AdminUsers.truncate();
    await Roles.truncate();
    await sequelize.query('SET FOREIGN_KEY_CHECKS = 1');

    await RoomDb.bulkCreate([
      { roomno: '51A', roomtype: 'ac', gender: 'M', roomstatus: ROOM_STATUS_AVAILABLE, updatedBy: 'admin' },
      { roomno: '51B', roomtype: 'ac', gender: 'M', roomstatus: ROOM_STATUS_AVAILABLE, updatedBy: 'admin' },
      { roomno: '52A', roomtype: 'ac', gender: 'M', roomstatus: ROOM_STATUS_AVAILABLE, updatedBy: 'admin' }
    ]);

    const role = await Roles.create({
      name: ROLE_ROOM_ADMIN,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    const adminUser = await AdminUsers.create({
      username: 'test_block_admin',
      password: 'x',
      status: STATUS_ACTIVE
    });
    await AdminRoles.create({
      user_id: adminUser.id,
      role_name: role.name,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
    const token = jwt.sign(
      { user: { id: adminUser.id, username: adminUser.username } },
      process.env.SECRET
    );
    ADMIN_AUTH = { Authorization: `Bearer ${token}` };
  });

  beforeEach(async () => {
    await RoomBlock.truncate();
    await RoomDb.update({ roomstatus: ROOM_STATUS_AVAILABLE }, { where: {} });
  });

  it('creates a dated room block successfully', async () => {
    const start_date = fmt(moment().add(1, 'day'));
    const end_date = fmt(moment().add(5, 'day'));

    const res = await request(app)
      .post('/api/v1/admin/stay/room_block')
      .set(ADMIN_AUTH)
      .send({
        roomno: '51A',
        start_date,
        end_date,
        reason: 'Plumbing maintenance',
        blockAllBeds: false
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].roomno).toBe('51A');
    expect(res.body.data[0].status).toBe(ROOM_BLOCK_ACTIVE);

    const block = await RoomBlock.findOne({ where: { roomno: '51A', status: ROOM_BLOCK_ACTIVE } });
    expect(block).toBeTruthy();
    expect(block.reason).toBe('Plumbing maintenance');
  });

  it('rejects a permanent block with a future start date', async () => {
    const futureStart = fmt(moment().add(10, 'day'));

    const res = await request(app)
      .post('/api/v1/admin/stay/room_block')
      .set(ADMIN_AUTH)
      .send({
        roomno: '51A',
        start_date: futureStart,
        end_date: null,
        reason: 'Future permanent block'
      });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Permanent blocks must start today or earlier/i);
  });

  it('sets roomstatus = blocked when permanent block starts today or earlier', async () => {
    const today = fmt(moment());

    const res = await request(app)
      .post('/api/v1/admin/stay/room_block')
      .set(ADMIN_AUTH)
      .send({
        roomno: '51A',
        start_date: today,
        end_date: null,
        reason: 'Decommissioned room',
        blockAllBeds: false
      });

    expect(res.status).toBe(200);
    const room = await RoomDb.findOne({ where: { roomno: '51A' } });
    expect(room.roomstatus).toBe(ROOM_BLOCKED);
  });

  it('cancels block via DELETE /room_block/:id and restores roomstatus', async () => {
    const today = fmt(moment());

    // Create a permanent block
    const block = await RoomBlock.create({
      roomno: '51A',
      start_date: today,
      end_date: null,
      reason: 'Temporary test block',
      status: ROOM_BLOCK_ACTIVE,
      createdBy: 'admin',
      updatedBy: 'admin'
    });
    await RoomDb.update({ roomstatus: ROOM_BLOCKED }, { where: { roomno: '51A' } });

    // Cancel block via DELETE method (with allBeds query param)
    const res = await request(app)
      .delete(`/api/v1/admin/stay/room_block/${block.id}?allBeds=false`)
      .set(ADMIN_AUTH);

    expect(res.status).toBe(200);
    const reloaded = await RoomBlock.findByPk(block.id);
    expect(reloaded.status).toBe(ROOM_BLOCK_CANCELLED);

    // Verify roomstatus is restored to available
    const room = await RoomDb.findOne({ where: { roomno: '51A' } });
    expect(room.roomstatus).toBe(ROOM_STATUS_AVAILABLE);
  });

  it('cancels block for all beds of the room when cancelAllBeds=true', async () => {
    const today = fmt(moment());

    const block1 = await RoomBlock.create({
      roomno: '51A',
      start_date: today,
      end_date: null,
      status: ROOM_BLOCK_ACTIVE,
      createdBy: 'admin',
      updatedBy: 'admin'
    });
    const block2 = await RoomBlock.create({
      roomno: '51B',
      start_date: today,
      end_date: null,
      status: ROOM_BLOCK_ACTIVE,
      createdBy: 'admin',
      updatedBy: 'admin'
    });

    const res = await request(app)
      .delete(`/api/v1/admin/stay/room_block/${block1.id}?allBeds=true`)
      .set(ADMIN_AUTH);

    expect(res.status).toBe(200);
    const reloaded1 = await RoomBlock.findByPk(block1.id);
    const reloaded2 = await RoomBlock.findByPk(block2.id);
    expect(reloaded1.status).toBe(ROOM_BLOCK_CANCELLED);
    expect(reloaded2.status).toBe(ROOM_BLOCK_CANCELLED);
  });

  it('bulk blocks multiple rooms and bulk cancels them', async () => {
    const today = fmt(moment());
    const tomorrow = fmt(moment().add(1, 'day'));

    // Bulk block
    const resBlock = await request(app)
      .post('/api/v1/admin/stay/room_block/bulk')
      .set(ADMIN_AUTH)
      .send({
        roomnos: ['51A', '51B', '52A'],
        start_date: today,
        end_date: tomorrow,
        reason: 'Bulk painting'
      });

    expect(resBlock.status).toBe(200);
    expect(resBlock.body.data).toHaveLength(3);

    // Bulk cancel current blocks
    const resCancel = await request(app)
      .post('/api/v1/admin/stay/room_block/bulk_cancel')
      .set(ADMIN_AUTH)
      .send({
        roomnos: ['51A', '51B', '52A']
      });

    expect(resCancel.status).toBe(200);
    const activeBlocks = await RoomBlock.findAll({
      where: { roomno: ['51A', '51B', '52A'], status: ROOM_BLOCK_ACTIVE }
    });
    expect(activeBlocks).toHaveLength(0);
  });
});
