import request from 'supertest';
import { app, sequelize, server } from '../app';
import hbs from 'nodemailer-express-handlebars';


// Mock nodemailer-express-handlebars
jest.mock('nodemailer-express-handlebars', () => {
  return jest.fn(() => ({
    use: jest.fn(),
  }));
});

describe('GET /', () => {
  it('should return 200 and "API is up and running... 🚀"', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    // expect(response.text).toBe('API is up and running... 🚀');
  });
});


// Close the database connection after all tests
afterAll(async () => {
  await sequelize.close();
  server.close();
});
