import request from 'supertest';
import { app, sequelize } from '../app.js';

jest.mock('../utils/sendMail.js');

/**
 * Behind the reverse proxy every request reaches express from 127.0.0.1, so
 * req.ip logged the proxy rather than the caller - including on the webhook
 * signature rejections, where the address is the whole point of the log line.
 */
describe('trust proxy', () => {
  it('reads the caller out of X-Forwarded-For', () => {
    const trust = app.get('trust proxy fn');

    // The proxy itself is trusted, so express looks past it in the header.
    expect(trust('127.0.0.1', 0)).toBe(true);
    expect(trust('::1', 0)).toBe(true);
  });

  it('does not trust a forwarded address from a non-loopback peer', () => {
    const trust = app.get('trust proxy fn');

    // If the app is ever reachable without the proxy in front, a caller must
    // not be able to name its own address.
    expect(trust('203.0.113.9', 0)).toBe(false);
  });

  it('still serves a request that carries no forwarded header', async () => {
    const res = await request(app).get('/api');

    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    await sequelize.close();
  });
});
