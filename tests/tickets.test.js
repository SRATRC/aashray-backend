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
      // We might not want to delete the user if other tests rely on it, but for this isolated test it's fine.
      // However, CardFactory creates real records.
      // Let's just leave it or try to clean up.
    }
    await sequelize.close();
  });

  describe('POST /api/v1/tickets', () => {
    it('should create a new ticket', async () => {
      const response = await request(app)
        .post('/api/v1/tickets')
        .send({
          cardno: user.cardno, // Pass cardno for validation middleware
          service: 'Plumbing',
          description: 'Leaky faucet',
          os: 'iOS',
          app_version: '1.0.0'
        })
        .expect(201);

      expect(response.body.status).toBe('success');
      expect(response.body.data.service).toBe('Plumbing');
      expect(response.body.data.issued_by).toBe(user.cardno);

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

      expect(response.body.status).toBe('success');
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

      expect(response.body.status).toBe('success');
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

      expect(response.body.status).toBe('success');
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });
});
