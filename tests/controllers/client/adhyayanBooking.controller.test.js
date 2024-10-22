jest.mock('uuid');
jest.mock('../../../utils/sendMail.js');
jest.mock('../../../models/associations.js');
jest.mock('../../../config/database.js');

import request from 'supertest';
import { app, server } from '../../../app'; 
import { CardDb, ShibirDb } from '../../../models/associations';

describe('Adhyayan Booking Controller', () => {
describe('FetchAllShibir', () => {
    it('should fetch all shibirs starting after today and group them by month', async () => {
        const mockShibirs = [
            { month: 'January', start_date: '2023-01-15' },
            { month: 'February', start_date: '2023-02-20' }
        ];


        const mockCard = { cardno: '1234' };

        CardDb.findOne.mockResolvedValue(mockCard);
        ShibirDb.findAll.mockResolvedValue(mockShibirs);

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
});




// describe('Adhyayan Booking Controller', () => {
//   describe('FetchAllShibir', () => {
//     it('should fetch all shibirs starting after today and group them by month', async () => {
//       const mockShibirs = [
//         { month: 'January', start_date: '2023-01-15' },
//         { month: 'February', start_date: '2023-02-20' }
//       ];

//       ShibirDb.findAll.mockResolvedValue(mockShibirs);
//       moment.mockReturnValue({ format: () => '2023-01-01' });

//       const req = {
//         query: {
//           page: 1,
//           page_size: 10
//         }
//       };
//       const res = {
//         status: jest.fn().mockReturnThis(),
//         send: jest.fn()
//       };

//       await FetchAllShibir(req, res);

//       expect(res.status).toHaveBeenCalledWith(200);
//       expect(res.send).toHaveBeenCalledWith({
//         message: 'fetched results',
//         data: [
//           { title: 'January', data: [mockShibirs[0]] },
//           { title: 'February', data: [mockShibirs[1]] }
//         ]
//       });
//     });
//   });
// });

// describe('RegisterShibir', () => {
//     it('should register a shibir booking', async () => {
//         const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
//         database.transaction.mockResolvedValue(mockTransaction);
//         uuidv4.mockReturnValue('mock-uuid');
//         ShibirBookingDb.findOne.mockResolvedValue(null);
//         ShibirDb.findOne.mockResolvedValue({ available_seats: 1, dataValues: { amount: 1000 } });
//         ShibirBookingTransaction.findAll.mockResolvedValue([]);
//         ShibirBookingDb.create.mockResolvedValue({});
//         ShibirBookingTransaction.create.mockResolvedValue({});
//         sendMail.mockResolvedValue({});

//         const res = await request(app)
//             .post('/api/shibir/register')
//             .send({ shibir_id: 1, cardno: '1234' })
//             .set('user', { email: 'test@example.com', issuedto: 'Test User' });

//         expect(res.status).toBe(201);
//         expect(res.body.message).toBe('Shibir booking successful');
//         expect(mockTransaction.commit).toHaveBeenCalled();
//         expect(sendMail).toHaveBeenCalledWith({
//             email: 'test@example.com',
//             subject: 'Shibir Booking Confirmation',
//             template: 'rajAdhyayan',
//             context: {
//                 name: 'Test User',
//                 adhyayanName: undefined,
//                 speaker: undefined,
//                 startDate: undefined,
//                 endDate: undefined
//             }
//         });
//     });
// });

// describe('FetchBookedShibir', () => {
//     it('should fetch booked shibirs for a user', async () => {
//         const mockShibirs = [
//             { bookingid: '1', shibir_id: 1, status: STATUS_CONFIRMED, name: 'Shibir 1', speaker: 'Speaker 1', start_date: '2023-01-15', end_date: '2023-01-20', amount: 1000, transaction_status: STATUS_PAYMENT_PENDING }
//         ];
//         database.query.mockResolvedValue(mockShibirs);

//         const res = await request(app)
//             .get('/api/shibir/booked')
//             .query({ page: 1, page_size: 10 })
//             .set('user', { cardno: '1234' });

//         expect(res.status).toBe(200);
//         expect(res.body.data).toEqual(mockShibirs);
//     });
// });

// describe('CancelShibir', () => {
//     it('should cancel a shibir booking', async () => {
//         const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
//         database.transaction.mockResolvedValue(mockTransaction);
//         ShibirBookingDb.findOne.mockResolvedValue({ status: STATUS_CONFIRMED, save: jest.fn() });
//         ShibirDb.findOne.mockResolvedValue({ available_seats: 1, total_seats: 10, save: jest.fn() });
//         ShibirBookingDb.create.mockResolvedValue({});
//         sendMail.mockResolvedValue({});

//         const res = await request(app)
//             .post('/api/shibir/cancel')
//             .send({ shibir_id: 1, cardno: '1234' })
//             .set('user', { email: 'test@example.com', issuedto: 'Test User' });

//         expect(res.status).toBe(200);
//         expect(res.body.message).toBe('Shibir booking cancelled');
//         expect(mockTransaction.commit).toHaveBeenCalled();
//         expect(sendMail).toHaveBeenCalledWith({
//             email: 'test@example.com',
//             subject: 'Shibir Booking Cancellation',
//             template: 'rajAdhyayanCancellation',
//             context: {
//                 name: 'Test User',
//                 adhyayanName: undefined
//             }
//         });
//     });
// });

// describe('FetchShibirInRange', () => {
//     it('should fetch shibirs within a date range', async () => {
//         const mockShibirs = [
//             { start_date: '2023-01-15', end_date: '2023-01-20' },
//             { start_date: '2023-01-25', end_date: '2023-01-30' }
//         ];
//         ShibirDb.findAll.mockResolvedValue(mockShibirs);

//         const res = await request(app)
//             .get('/api/shibir/range')
//             .query({ start_date: '2023-01-01', end_date: '2023-01-31' });

//         expect(res.status).toBe(200);
//         expect(res.body.data).toEqual(mockShibirs);
//     });
// });
// });


// Close the database connection after all tests
afterAll(async () => {
    server.close();
  });