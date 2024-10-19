import request from 'supertest';
import { app, sequelize, server } from '../app';

beforeAll(async () => {
  await sequelize.authenticate();
  await sequelize.sync();
});

describe('GET /', () => {
  it('should return 200', async () => {
    const response = await request(app)
      .get('/')
      .expect(200);
    expect(response.body.data).toBe('API is up and running... 🚀');
    expect(response.body.status).toBe(200);
  });
});

describe('GET /some/random/url', () => {
  it('should return 404', async () => {
    const response = await request(app)
      .get('/some/random/url')
      .expect(404);

      expect(response.body.message).toBe('Page Not Found');
      expect(response.body.statusCode).toBe(404);
  });
});

// Close the database connection after all tests
afterAll(async () => {
  await sequelize.close();
  server.close();
});
