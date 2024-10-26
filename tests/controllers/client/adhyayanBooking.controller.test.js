jest.mock('uuid');
jest.mock('../../../utils/sendMail.js');
jest.mock('../../../models/associations.js');
jest.mock('../../../config/database.js');

import request from 'supertest';
import { app, sequelize, server } from '../../../app.js'; 
import sendMail from '../../../utils/sendMail.js';
import { CardDb, ShibirDb, ShibirBookingDb } from '../../../models/associations.js';
import { STATUS_CONFIRMED, STATUS_PAYMENT_PENDING } from '../../../config/constants.js';

afterAll(async () => {
  server.close();
});

describe('Adhyayan Booking Controller', () => {
  describe('FetchAllShibir', () => {
    it('should fetch all shibirs starting after today and group them by month', async () => {
        const mockShibirs = [
            { month: 'January', start_date: '2023-01-15' },
            { month: 'February', start_date: '2023-02-20' }
        ];
        ShibirDb.findAll.mockResolvedValue(mockShibirs);

        const mockCard = { cardno: '1234' };
        CardDb.findOne.mockResolvedValue(mockCard);

        const res = await request(app)
          .get('/api/v1/adhyayan/getall') 
          .query({ cardno: '1234', page: 1, page_size: 10 });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('fetched results');
        expect(res.body.data).toEqual([
            { title: 'January', data: [mockShibirs[0]] },
            { title: 'February', data: [mockShibirs[1]] }
        ]);
    });
  });

  describe('FetchBookedShibir', () => {
    it('should fetch booked shibirs for a user', async () => {
        const mockShibirs = [
          { bookingid: '1', shibir_id: 1, status: STATUS_CONFIRMED, name: 'Shibir 1', speaker: 'Speaker 1', start_date: '2023-01-15', end_date: '2023-01-20', amount: 1000, transaction_status: STATUS_PAYMENT_PENDING }
        ];
        sequelize.query.mockResolvedValue(mockShibirs);

        const mockCard = { cardno: '1234' };
        CardDb.findOne.mockResolvedValue(mockCard);
    
        const res = await request(app)
          .get('/api/v1/adhyayan/getbooked') 
          .query({ cardno: '1234', page: 1, page_size: 10 });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual(mockShibirs);
    });
  });

  describe('CancelShibir', () => {
    it('should cancel a shibir booking', async () => {
        const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
        sequelize.transaction.mockResolvedValue(mockTransaction);

        const mockCard = { cardno: '1234', email: 'test@example.com', issuedto: 'Test User' };
        CardDb.findOne.mockResolvedValue(mockCard);
        
        ShibirBookingDb.findOne.mockResolvedValue({ status: STATUS_CONFIRMED, save: jest.fn() });
        ShibirDb.findOne.mockResolvedValue({ available_seats: 1, total_seats: 10, dataValues: {name: "Test"}, save: jest.fn() });
        sendMail.mockResolvedValue({});
        
        const res = await request(app)
            .delete('/api/v1/adhyayan/cancel')
            .send({ shibir_id: 1, cardno: '1234' });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('Shibir booking cancelled');
        expect(mockTransaction.commit).toHaveBeenCalled();
        expect(sendMail).toHaveBeenCalledWith({
            email: 'test@example.com',
            subject: 'Shibir Booking Cancellation',
            template: 'rajAdhyayanCancellation',
            context: {
                name: 'Test User',
                adhyayanName: 'Test'
            }
        });
    });
});

describe('FetchShibirInRange', () => {
    it('should fetch shibirs within a date range', async () => {
        const mockCard = { cardno: '1234', email: 'test@example.com', issuedto: 'Test User' };
        CardDb.findOne.mockResolvedValue(mockCard);

        const res = await request(app)
            .get('/api/v1/adhyayan/getrange')
            .query({ cardno: '1234', start_date: '2023-01-01', end_date: '2023-01-31' });

        expect(res.status).toBe(200);
        expect(ShibirDb.findAll).toHaveBeenCalledWith({
            where: {
                start_date: { [sequelize.Op.gte]: '2023-01-01', [sequelize.Op.lte]: '2023-01-31' },
                end_date: { [sequelize.Op.gte]: '2023-01-01', [sequelize.Op.lte]: '2023-01-31' }
            },
            order: [['start_date', 'ASC']]
        });
    });
  });
});
