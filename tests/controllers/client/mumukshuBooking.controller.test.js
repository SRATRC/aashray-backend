import request from 'supertest';
import { app, sequelize } from '../../../app.js';
import { CardDb } from '../../../models/associations.js';
import {
  STATUS_CONFIRMED,
  STATUS_CANCELLED,
  TYPE_ADHYAYAN
} from '../../../config/constants.js';

jest.mock('../../../utils/sendMail.js');

describe('Mumukshu Booking Controller', () => {
  describe('Booking', () => {
    describe('Utsav Booking', () => {
      test.todo('should return an error when booking an utsav with invalid details');
      test.todo('should return an error when booking an utsav with no packageid');
      test.todo('should return an error when booking an utsav with packageid which is not available');
      test.todo('should book utsav successfully');
    });

    describe('Room Booking', () => {
      test.todo('should book room in waiting status if checking in on Utsav end date');
      test.todo('should book room in waiting status if checking out on Utsav begining date');

      test.todo('should book room for single day visit successfully');
      test.todo('should book room for multiple days successfully');
    });

    test.todo('should book adhyayans successfully');
    test.todo('should book rooms successfully');
    test.todo('should book food successfully');
    test.todo('should book travel successfully');
  });

  describe('Validate Booking', () => {
    test.todo('should validate utsav successfully');
    test.todo('should validate adhyayans successfully');
    test.todo('should validate rooms successfully');
    test.todo('should validate food successfully');
    test.todo('should validate travel successfully');
  });

  afterAll(async () => {
    await sequelize.close();
  });
});
