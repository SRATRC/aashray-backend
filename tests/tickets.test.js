import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app, sequelize } from '../app.js';
import CardFactory from './factories/cardFactory.js';
import Ticket from '../models/ticket.model.js';
import TicketMessage from '../models/ticket_message.model.js';
import TicketAttachment from '../models/ticket_attachment.model.js';
import AdminUsers from '../models/admin_users.model.js';
import AdminRoles from '../models/admin_roles.model.js';
import Roles from '../models/roles.model.js';
import {
  STATUS_CLOSED,
  STATUS_ACTIVE,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  ROLE_SUPER_ADMIN,
  ROLE_ELECTRICAL_ADMIN,
  ROLE_MAINTENANCE_ADMIN
} from '../config/constants.js';

// Mock ONLY the raw S3 primitives — no network. buildAttachmentKey/isTicketKey
// stay real (they're pure). The orchestrator (validation, HeadObject-verify
// flow, persistence, video cap) is a separate module and runs for real against
// these mocks.
jest.mock('../helpers/ticketAttachment.helper.js', () => {
  const actual = jest.requireActual('../helpers/ticketAttachment.helper.js');
  return {
    __esModule: true,
    ...actual,
    createPresignedPutUrl: jest.fn(async ({ key }) => `https://s3.mock/put/${encodeURIComponent(key)}`),
    createPresignedGetUrl: jest.fn(async ({ key }) => `https://s3.mock/get/${encodeURIComponent(key)}`),
    verifyObject: jest.fn(async ({ kind, contentType }) => ({
      ok: true,
      size: kind === 'video' ? 2048 : 1024,
      contentType
    })),
    deleteObjects: jest.fn(async () => ({ deleted: 0, errors: [] }))
  };
});

import * as attachmentHelper from '../helpers/ticketAttachment.helper.js';

// Create an admin user with the given roles and return a bearer token that the
// AdminAuth middleware will accept (it verifies with process.env.SECRET and
// reads decoded.user.{id,username}).
async function createAdmin(username, roleNames) {
  for (const rn of roleNames) {
    await Roles.findOrCreate({
      where: { name: rn },
      defaults: { name: rn, status: STATUS_ACTIVE, updatedBy: 'test' }
    });
  }
  const adminUser = await AdminUsers.create({
    username,
    password: 'test',
    status: STATUS_ACTIVE
  });
  for (const rn of roleNames) {
    await AdminRoles.create({
      user_id: adminUser.id,
      role_name: rn,
      status: STATUS_ACTIVE,
      updatedBy: 'test'
    });
  }
  const token = jwt.sign({ user: { id: adminUser.id, username } }, process.env.SECRET);
  return { adminUser, token };
}

describe('Ticket System', () => {
  let user;
  let ticketId;
  const ADMIN_USERNAMES = ['test_superAdmin', 'test_electricalAdmin', 'test_maintenanceAdmin'];
  let superToken;
  let electricalToken;
  let maintenanceToken;

  async function cleanupAdmins() {
    const admins = await AdminUsers.findAll({ where: { username: ADMIN_USERNAMES } });
    for (const a of admins) {
      await AdminRoles.destroy({ where: { user_id: a.id } });
    }
    await AdminUsers.destroy({ where: { username: ADMIN_USERNAMES } });
  }

  beforeAll(async () => {
    await sequelize.sync();
    user = await CardFactory.create('TEST_USER_123');

    // Fresh admins (idempotent across reruns)
    await cleanupAdmins();
    ({ token: superToken } = await createAdmin('test_superAdmin', [ROLE_SUPER_ADMIN]));
    ({ token: electricalToken } = await createAdmin('test_electricalAdmin', [ROLE_ELECTRICAL_ADMIN]));
    ({ token: maintenanceToken } = await createAdmin('test_maintenanceAdmin', [ROLE_MAINTENANCE_ADMIN]));
  });

  afterAll(async () => {
    await TicketAttachment.destroy({ where: {} });
    await TicketMessage.destroy({ where: {} });
    await Ticket.destroy({ where: {} });
    await cleanupAdmins();
    await sequelize.close();
  });

  describe('POST /api/v1/tickets', () => {
    it('should create a new ticket', async () => {
      const response = await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno, // Pass cardno for validation middleware
          service: 'Maintenance',
          description: 'Leaky faucet',
          os: 'iOS',
          app_version: '1.0.0'
        })
        .expect(201);

      expect(response.body.message).toBe('Successfully created ticket');
      expect(response.body.data.service).toBe('Maintenance');
      expect(response.body.data.issued_by).toBe(user.cardno);
      expect(response.body.data.id).toBeTruthy();

      ticketId = response.body.data.id;
    });

    it('should fail without required fields', async () => {
      await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno
        })
        .expect(400);
    });

    it('should reject an unknown service value', async () => {
      await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno,
          service: 'Food', // an old, now-removed department label
          description: 'stale service'
        })
        .expect(400);
    });

    it('should persist and round-trip metadata on the created ticket', async () => {
      const createResponse = await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno,
          service: 'IT',
          description: 'App crashes on launch',
          os: 'iOS',
          app_version: '1.0.0',
          metadata: { device: { osName: 'iOS' } }
        })
        .expect(201);

      expect(createResponse.body.data.metadata).toEqual({
        device: { osName: 'iOS' }
      });

      const detailResponse = await request(app)
        .get(`/api/v1/tickets/${createResponse.body.data.id}`)
        .query({ cardno: user.cardno })
        .expect(200);

      expect(detailResponse.body.data.metadata).toEqual({
        device: { osName: 'iOS' }
      });
    });
  });

  describe('POST /api/v1/tickets/:id/messages', () => {
    it('should add a message to the ticket', async () => {
      const response = await request(app)
        .post(`/api/v1/tickets/${ticketId}/messages`)
        .send({
          cardno: user.cardno,
          message: 'Is anyone looking at this?'
        })
        .expect(201);

      expect(response.body.data.message).toBe('Is anyone looking at this?');
      expect(response.body.data.sender_id).toBe(user.cardno);
    });
  });

  describe('GET /api/v1/tickets/:id', () => {
    it('should get ticket details with messages', async () => {
      const response = await request(app)
        .get(`/api/v1/tickets/${ticketId}`)
        .query({ cardno: user.cardno }) // Pass cardno in query for validation
        .expect(200);

      expect(response.body.data.id).toBe(ticketId);
      expect(response.body.data.messages).toHaveLength(1);
      expect(response.body.data.messages[0].message).toBe(
        'Is anyone looking at this?'
      );
    });
  });

  describe('GET /api/v1/tickets', () => {
    it('should list user tickets', async () => {
      const response = await request(app)
        .get('/api/v1/tickets')
        .query({ cardno: user.cardno })
        .expect(200);

      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PATCH /api/v1/tickets/:id/resolve', () => {
    it('should resolve (close) the ticket', async () => {
      const response = await request(app)
        .patch(`/api/v1/tickets/${ticketId}/resolve`)
        .send({ cardno: user.cardno })
        .expect(200);

      expect(response.body.message).toBeTruthy();

      const detailResponse = await request(app)
        .get(`/api/v1/tickets/${ticketId}`)
        .query({ cardno: user.cardno })
        .expect(200);

      expect(detailResponse.body.data.status).toBe(STATUS_CLOSED);
    });

    it('should reject further messages on a closed ticket', async () => {
      await request(app)
        .post(`/api/v1/tickets/${ticketId}/messages`)
        .send({
          cardno: user.cardno,
          message: 'Still there?'
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/tickets/attachments/presign (client)', () => {
    const img = { filename: 'a.jpg', contentType: 'image/jpeg', size: 1000, kind: 'image' };

    it('should return { key, uploadUrl } per file for a valid batch', async () => {
      const res = await request(app)
        .post('/api/v1/tickets/attachments/presign')
        .send({ cardno: user.cardno, files: [img, { ...img, filename: 'b.jpg' }] })
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      for (const entry of res.body.data) {
        expect(typeof entry.key).toBe('string');
        expect(entry.key.startsWith('tickets/')).toBe(true);
        expect(typeof entry.uploadUrl).toBe('string');
      }
    });

    it('should reject more than 5 images (over-count) with 400', async () => {
      const files = Array.from({ length: 6 }, (_, i) => ({ ...img, filename: `${i}.jpg` }));
      await request(app)
        .post('/api/v1/tickets/attachments/presign')
        .send({ cardno: user.cardno, files })
        .expect(400);
    });

    it('should reject an oversized image with 400', async () => {
      await request(app)
        .post('/api/v1/tickets/attachments/presign')
        .send({ cardno: user.cardno, files: [{ ...img, size: MAX_IMAGE_BYTES + 1 }] })
        .expect(400);
    });

    it('should reject a content-type that does not match its kind with 400', async () => {
      await request(app)
        .post('/api/v1/tickets/attachments/presign')
        .send({ cardno: user.cardno, files: [{ ...img, contentType: 'application/pdf' }] })
        .expect(400);
    });

    it('should accept a valid video within limits', async () => {
      await request(app)
        .post('/api/v1/tickets/attachments/presign')
        .send({
          cardno: user.cardno,
          files: [{ filename: 'v.mp4', contentType: 'video/mp4', size: MAX_VIDEO_BYTES, kind: 'video', durationSec: 60 }]
        })
        .expect(200);
    });

    it('should reject a video longer than 60s with 400', async () => {
      await request(app)
        .post('/api/v1/tickets/attachments/presign')
        .send({
          cardno: user.cardno,
          files: [{ filename: 'v.mp4', contentType: 'video/mp4', size: 1000, kind: 'video', durationSec: 61 }]
        })
        .expect(400);
    });
  });

  describe('POST /api/v1/admin/tickets/attachments/presign (admin)', () => {
    it('should reject a video (video is user-only) with 400', async () => {
      await request(app)
        .post('/api/v1/admin/tickets/attachments/presign')
        .set('Authorization', `Bearer ${electricalToken}`)
        .send({ files: [{ filename: 'v.mp4', contentType: 'video/mp4', size: 1000, kind: 'video', durationSec: 10 }] })
        .expect(400);
    });

    it('should accept images', async () => {
      await request(app)
        .post('/api/v1/admin/tickets/attachments/presign')
        .set('Authorization', `Bearer ${electricalToken}`)
        .send({ files: [{ filename: 'a.jpg', contentType: 'image/jpeg', size: 1000, kind: 'image' }] })
        .expect(200);
    });
  });

  describe('Attach + verify persists rows', () => {
    it('should create a ticket with attachments and persist ticket_attachments rows', async () => {
      const res = await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno,
          service: 'Electrical',
          description: 'Broken switch',
          attachments: [
            { key: 'tickets/pending/TEST_USER_123/x.jpg', contentType: 'image/jpeg', kind: 'image' }
          ]
        })
        .expect(201);

      const tid = res.body.data.id;
      const rows = await TicketAttachment.findAll({ where: { ticket_id: tid } });
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe('image');
      expect(rows[0].message_id).toBeNull();
      expect(rows[0].size).toBe(1024); // from mocked verifyObject

      // detail surfaces the ticket-level attachment with a serve URL
      const detail = await request(app)
        .get(`/api/v1/tickets/${tid}`)
        .query({ cardno: user.cardno })
        .expect(200);
      expect(detail.body.data.attachments).toHaveLength(1);
      expect(detail.body.data.attachments[0].url).toContain(`/attachments/${rows[0].id}`);
      expect(detail.body.data.attachments[0].expired).toBe(false);
    });

    it('should best-effort delete and 400 when verification fails', async () => {
      attachmentHelper.verifyObject.mockImplementationOnce(async () => ({
        ok: false,
        reason: 'object not found in storage'
      }));
      await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno,
          service: 'Electrical',
          description: 'bad key',
          attachments: [{ key: 'tickets/pending/TEST_USER_123/missing.jpg', contentType: 'image/jpeg', kind: 'image' }]
        })
        .expect(400);
      expect(attachmentHelper.deleteObjects).toHaveBeenCalled();
    });
  });

  describe('Per-ticket video cap', () => {
    it('should reject a 3rd video on a ticket that already has 2', async () => {
      const vids = [
        { key: 'tickets/pending/TEST_USER_123/v1.mp4', contentType: 'video/mp4', kind: 'video' },
        { key: 'tickets/pending/TEST_USER_123/v2.mp4', contentType: 'video/mp4', kind: 'video' }
      ];
      const res = await request(app)
        .post('/api/v1/tickets')
        .send({ cardno: user.cardno, service: 'Electrical', description: 'two videos', attachments: vids })
        .expect(201);
      const tid = res.body.data.id;

      await request(app)
        .post(`/api/v1/tickets/${tid}/messages`)
        .send({
          cardno: user.cardno,
          message: 'one more',
          attachments: [{ key: 'tickets/pending/TEST_USER_123/v3.mp4', contentType: 'video/mp4', kind: 'video' }]
        })
        .expect(400);
    });
  });

  describe('Serve attachment auth', () => {
    let tid;
    let attId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno,
          service: 'Electrical',
          description: 'serve test',
          attachments: [{ key: 'tickets/pending/TEST_USER_123/serve.jpg', contentType: 'image/jpeg', kind: 'image' }]
        })
        .expect(201);
      tid = res.body.data.id;
      const row = await TicketAttachment.findOne({ where: { ticket_id: tid } });
      attId = row.id;
    });

    it('owner (client) is 302-redirected to a presigned GET', async () => {
      const res = await request(app)
        .get(`/api/v1/tickets/${tid}/attachments/${attId}`)
        .query({ cardno: user.cardno })
        .expect(302);
      expect(res.headers.location).toContain('s3.mock/get');
    });

    it('a non-owner client cannot reach it (404)', async () => {
      await request(app)
        .get(`/api/v1/tickets/${tid}/attachments/${attId}`)
        .query({ cardno: 'Mumukshu_1' })
        .expect(404);
    });

    it('department admin (electrical) is 302-redirected', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/tickets/${tid}/attachments/${attId}`)
        .set('Authorization', `Bearer ${electricalToken}`)
        .expect(302);
      expect(res.headers.location).toContain('s3.mock/get');
    });

    it('an admin of another department gets 403', async () => {
      await request(app)
        .get(`/api/v1/admin/tickets/${tid}/attachments/${attId}`)
        .set('Authorization', `Bearer ${maintenanceToken}`)
        .expect(403);
    });

    it('returns 410 once the attachment is expired (tombstoned)', async () => {
      await TicketAttachment.update({ expired_at: new Date() }, { where: { id: attId } });
      await request(app)
        .get(`/api/v1/tickets/${tid}/attachments/${attId}`)
        .query({ cardno: user.cardno })
        .expect(410);
    });
  });

  describe('Department RBAC (new services)', () => {
    beforeAll(async () => {
      // one ticket per department so the filters have something to match
      await request(app)
        .post('/api/v1/tickets')
        .send({ cardno: user.cardno, service: 'Electrical', description: 'rbac electrical' })
        .expect(201);
      await request(app)
        .post('/api/v1/tickets')
        .send({ cardno: user.cardno, service: 'Maintenance', description: 'rbac maintenance' })
        .expect(201);
    });

    it('electricalAdmin can list Electrical tickets', async () => {
      const res = await request(app)
        .get('/api/v1/admin/tickets')
        .query({ service: 'Electrical' })
        .set('Authorization', `Bearer ${electricalToken}`)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.every((t) => t.service === 'Electrical')).toBe(true);
    });

    it('electricalAdmin cannot list Maintenance tickets (403)', async () => {
      await request(app)
        .get('/api/v1/admin/tickets')
        .query({ service: 'Maintenance' })
        .set('Authorization', `Bearer ${electricalToken}`)
        .expect(403);
    });

    it('electricalAdmin default listing only contains its own department', async () => {
      const res = await request(app)
        .get('/api/v1/admin/tickets')
        .set('Authorization', `Bearer ${electricalToken}`)
        .expect(200);
      expect(res.body.data.every((t) => t.service === 'Electrical')).toBe(true);
    });

    it('superAdmin can list any department', async () => {
      await request(app)
        .get('/api/v1/admin/tickets')
        .query({ service: 'Maintenance' })
        .set('Authorization', `Bearer ${superToken}`)
        .expect(200);
    });
  });
});
