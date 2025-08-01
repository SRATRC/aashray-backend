import request from 'supertest';
import { app } from '../app';

describe('GET /', () => {
  it('should return 200', async () => {
    const response = await request(app)
      .get('/api')
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
