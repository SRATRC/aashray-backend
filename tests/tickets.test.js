import request from 'supertest';
import { app, sequelize } from '../app.js';
import CardFactory from './factories/cardFactory.js';
import Ticket from '../models/ticket.model.js';
import TicketMessage from '../models/ticket_message.model.js';

describe('Ticket System', () => {
  let user;
  let ticketId;

  beforeAll(async () => {
    // Sync database to ensure tables exist
    await sequelize.sync();
    // Create a test user
    user = await CardFactory.create('TEST_USER_123');
  });

  afterAll(async () => {
    // Cleanup
    if (user) {
      await TicketMessage.destroy({ where: {} });
      await Ticket.destroy({ where: {} });
    }
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

    it('should persist and round-trip metadata on the created ticket', async () => {
      const createResponse = await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno,
          service: 'IT Support',
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

      expect(detailResponse.body.data.status).toBe('closed');
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
});
