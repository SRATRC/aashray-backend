import database from '../../../config/database.js';
import {
  STATUS_CONFIRMED,
  STATUS_PAYMENT_PENDING,
  STATUS_ADMIN_CANCELLED,
  STATUS_WAITING,
  STATUS_PAYMENT_COMPLETED,
  STATUS_CANCELLED,
  ROOM_STATUS_CHECKEDIN,
  ERR_BOOKING_ALREADY_CANCELLED,
  ERR_UTSAV_NO_SEATS_AVAILABLE
} from '../../../config/constants.js';

// Mock dependencies
jest.mock('../../../config/database.js', () => {
  const mTransaction = () => ({
    commit: jest.fn().mockResolvedValue(),
    rollback: jest.fn().mockResolvedValue(),
    LOCK: { UPDATE: 'UPDATE' }
  });
  return {
    __esModule: true,
    default: {
      define: jest.fn().mockReturnValue({
        belongsTo: jest.fn(),
        hasMany: jest.fn(),
        hasOne: jest.fn(),
        belongsToMany: jest.fn(),
        sync: jest.fn(),
        truncate: jest.fn(),
        findOne: jest.fn(),
        findAll: jest.fn()
      }),
      transaction: jest.fn(() => mTransaction()),
      query: jest.fn(),
      QueryTypes: { SELECT: 'SELECT' }
    }
  };
});

jest.mock('../../../models/associations.js', () => ({
  UtsavDb: {
    findOne: jest.fn(),
    findByPk: jest.fn()
  },
  UtsavPackagesDb: {
    findOne: jest.fn(),
    findByPk: jest.fn()
  },
  UtsavBooking: {
    findOne: jest.fn()
  },
  CardDb: {
    findOne: jest.fn()
  }
}));

jest.mock('../../../models/transactions.model.js', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn()
  }
}));

jest.mock('../../../helpers/utsavBooking.helper.js', () => ({
  validateUtsavBooking: jest.fn(),
  reserveUtsavSeat: jest.fn(),
  openUtsavSeat: jest.fn(),
  utsavBookingHeldSeat: jest.fn(),
  cancelUtsavFoodBookings: jest.fn(),
  bookFoodForUtsav: jest.fn(),
  sendUtsavBookingUpdateEmail: jest.fn().mockResolvedValue()
}));

jest.mock('../../../helpers/transactions.helper.js', () => ({
  createPendingTransaction: jest.fn(),
  cancelTransaction: jest.fn(),
  useCredit: jest.fn()
}));

jest.mock('../../../helpers/card.helper.js', () => ({
  validateCard: jest.fn()
}));

jest.mock('../../../helpers/whatsapp.helper.js', () => ({
  sendUtsavStatusChangeWhatsApp: jest.fn().mockResolvedValue()
}));

import {
  bulkUtsavStatusUpdate,
  executeUtsavStatusUpdate
} from '../../../controllers/admin/utsavManagement.controller.js';
import {
  UtsavDb,
  UtsavPackagesDb,
  CardDb
} from '../../../models/associations.js';
import Transactions from '../../../models/transactions.model.js';
import {
  validateUtsavBooking,
  reserveUtsavSeat,
  openUtsavSeat,
  utsavBookingHeldSeat,
  cancelUtsavFoodBookings,
  bookFoodForUtsav
} from '../../../helpers/utsavBooking.helper.js';
import {
  createPendingTransaction,
  cancelTransaction,
  useCredit
} from '../../../helpers/transactions.helper.js';
import { validateCard } from '../../../helpers/card.helper.js';
import ApiError from '../../../utils/ApiError.js';

describe('Utsav Bulk Status Update Controller', () => {
  let req, res;
  const mockUtsav = { id: 1, name: 'Diwali Utsav', location: 'RESEARCH_CENTRE', amount: 500 };

  beforeEach(() => {
    jest.clearAllMocks();

    UtsavDb.findOne.mockResolvedValue(mockUtsav);
    UtsavDb.findByPk.mockResolvedValue(mockUtsav);

    req = {
      body: {},
      user: { username: 'testAdmin' },
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };

    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
  });

  describe('Input Validations', () => {
    test('rejects when utsav_id is missing', async () => {
      req.body = { bookingids: ['b1'], status: STATUS_CONFIRMED };
      await expect(bulkUtsavStatusUpdate(req, res)).rejects.toMatchObject({
        statusCode: 400,
        message: 'utsav_id is required'
      });
    });

    test('rejects when bookingids is not a non-empty array', async () => {
      req.body = { utsav_id: 1, bookingids: [], status: STATUS_CONFIRMED };
      await expect(bulkUtsavStatusUpdate(req, res)).rejects.toMatchObject({
        statusCode: 400,
        message: 'bookingids must be a non-empty array'
      });
    });

    test('rejects when batch size exceeds 100', async () => {
      const ids = Array.from({ length: 101 }, (_, i) => `b${i}`);
      req.body = { utsav_id: 1, bookingids: ids, status: STATUS_CONFIRMED };
      await expect(bulkUtsavStatusUpdate(req, res)).rejects.toMatchObject({
        statusCode: 400,
        message: 'Batch size exceeds maximum limit of 100'
      });
    });

    test('rejects disallowed target status like waiting', async () => {
      req.body = { utsav_id: 1, bookingids: ['b1'], status: STATUS_WAITING };
      await expect(bulkUtsavStatusUpdate(req, res)).rejects.toMatchObject({
        statusCode: 400
      });
    });
  });

  describe('Scenario 1: Batch Confirmation', () => {
    test('successfully confirms multiple payment-pending bookings', async () => {
      const mockBooking1 = {
        bookingid: 'b1',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };
      const mockBooking2 = {
        bookingid: 'b2',
        utsavid: 1,
        cardno: '1002',
        packageid: 10,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };

      validateUtsavBooking.mockImplementation((id) => {
        if (id === 'b1') return Promise.resolve(mockBooking1);
        if (id === 'b2') return Promise.resolve(mockBooking2);
      });

      const mockTx1 = { id: 1, bookingid: 'b1', status: STATUS_PAYMENT_PENDING, update: jest.fn().mockResolvedValue() };
      const mockTx2 = { id: 2, bookingid: 'b2', status: STATUS_PAYMENT_PENDING, update: jest.fn().mockResolvedValue() };
      Transactions.findOne.mockImplementation(({ where }) => {
        if (where.bookingid === 'b1') return Promise.resolve(mockTx1);
        if (where.bookingid === 'b2') return Promise.resolve(mockTx2);
      });

      req.body = {
        utsav_id: 1,
        bookingids: ['b1', 'b2'],
        status: STATUS_CONFIRMED,
        description: 'Bulk confirmed'
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 2,
          successCount: 2,
          failedCount: 0,
          failures: []
        })
      }));

      expect(mockTx1.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_PAYMENT_COMPLETED }),
        expect.any(Object)
      );
      expect(mockTx2.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_PAYMENT_COMPLETED }),
        expect.any(Object)
      );
      expect(mockBooking1.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_CONFIRMED, updatedBy: 'testAdmin' }),
        expect.any(Object)
      );
      expect(mockBooking2.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_CONFIRMED, updatedBy: 'testAdmin' }),
        expect.any(Object)
      );
    });

    test('reopens a cancelled booking to confirmed and resets transaction status', async () => {
      const mockBooking = {
        bookingid: 'b_cancelled',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_CANCELLED,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);

      const mockTx = {
        id: 1,
        bookingid: 'b_cancelled',
        status: STATUS_CANCELLED,
        update: jest.fn().mockResolvedValue()
      };
      Transactions.findOne.mockResolvedValue(mockTx);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_cancelled'],
        status: STATUS_CONFIRMED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockTx.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_PAYMENT_PENDING }),
        expect.any(Object)
      );
      expect(mockBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_CONFIRMED }),
        expect.any(Object)
      );
    });

    test('restores status to ROOM_STATUS_CHECKEDIN when booking.other includes WAS_CHECKEDIN', async () => {
      const mockBooking = {
        bookingid: 'b_was_checkedin',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        other: 'WAS_CHECKEDIN,VIP',
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);
      Transactions.findOne.mockResolvedValue({
        id: 1,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      });

      req.body = {
        utsav_id: 1,
        bookingids: ['b_was_checkedin'],
        status: STATUS_CONFIRMED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ROOM_STATUS_CHECKEDIN,
          other: 'VIP'
        }),
        expect.any(Object)
      );
    });

    test('creates pending transaction and books food when confirming booking without existing transaction', async () => {
      const mockBooking = {
        bookingid: 'b_no_tx',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);
      Transactions.findOne.mockResolvedValue(null);
      validateCard.mockResolvedValue({ cardno: '1001' });
      createPendingTransaction.mockResolvedValue({ id: 100 });
      UtsavPackagesDb.findOne.mockResolvedValue({ id: 10, utsavid: 1 });

      req.body = {
        utsav_id: 1,
        bookingids: ['b_no_tx'],
        status: STATUS_CONFIRMED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(createPendingTransaction).toHaveBeenCalled();
      expect(bookFoodForUtsav).toHaveBeenCalled();
    });

    test('rejects transition to confirmed from waiting with 400', async () => {
      const mockBooking = {
        bookingid: 'b_waiting',
        utsavid: 1,
        status: STATUS_WAITING,
        update: jest.fn()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_waiting'],
        status: STATUS_CONFIRMED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          successCount: 0,
          failedCount: 1,
          failures: [
            expect.objectContaining({
              bookingid: 'b_waiting',
              reason: 'Confirmed status can only be set from payment pending or cancelled'
            })
          ]
        })
      }));
    });
  });

  describe('Scenario 2: Batch Admin Cancel with Credits', () => {
    test('cancels bookings, frees seats, cleans food, and issues credits', async () => {
      const mockBooking = {
        bookingid: 'b1',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_CONFIRMED,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);
      utsavBookingHeldSeat.mockReturnValue(true);

      const mockTx = {
        id: 1,
        bookingid: 'b1',
        cardno: '1001',
        amount: 500,
        status: STATUS_PAYMENT_COMPLETED,
        update: jest.fn().mockResolvedValue()
      };
      Transactions.findOne.mockResolvedValue(mockTx);

      req.body = {
        utsav_id: 1,
        bookingids: ['b1'],
        status: STATUS_ADMIN_CANCELLED,
        issueCredits: 'yes'
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(cancelUtsavFoodBookings).toHaveBeenCalledWith(mockBooking, 'testAdmin', expect.any(Object));
      expect(openUtsavSeat).toHaveBeenCalledWith(mockUtsav, '1001', 'testAdmin', expect.any(Object));
      expect(cancelTransaction).toHaveBeenCalledWith(req.user, null, mockTx, expect.any(Object), true);
      expect(mockBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_ADMIN_CANCELLED }),
        expect.any(Object)
      );
    });

    test('cancels waiting booking without opening seat or clearing meals', async () => {
      const mockBooking = {
        bookingid: 'b_waiting_cancel',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_WAITING,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);
      utsavBookingHeldSeat.mockReturnValue(false);
      Transactions.findOne.mockResolvedValue(null);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_waiting_cancel'],
        status: STATUS_ADMIN_CANCELLED,
        issueCredits: 'no'
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(openUtsavSeat).not.toHaveBeenCalled();
      expect(cancelUtsavFoodBookings).not.toHaveBeenCalled();
      expect(mockBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_ADMIN_CANCELLED }),
        expect.any(Object)
      );
    });

    test('upgrades a user-cancelled booking to admin cancelled and refunds credits', async () => {
      const mockBooking = {
        bookingid: 'b_prev_user_cancel',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_CANCELLED,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);
      utsavBookingHeldSeat.mockReturnValue(false);

      const mockTx = {
        id: 1,
        bookingid: 'b_prev_user_cancel',
        cardno: '1001',
        amount: 500,
        status: STATUS_CANCELLED,
        update: jest.fn().mockResolvedValue()
      };
      Transactions.findOne.mockResolvedValue(mockTx);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_prev_user_cancel'],
        status: STATUS_ADMIN_CANCELLED,
        issueCredits: 'yes'
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(cancelTransaction).toHaveBeenCalledWith(req.user, null, mockTx, expect.any(Object), true);
    });

    test('cancels payment-pending booking and restores credit discount without cash refund', async () => {
      const mockBooking = {
        bookingid: 'b_pending_cancel',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);
      utsavBookingHeldSeat.mockReturnValue(true);

      const mockTx = {
        id: 1,
        bookingid: 'b_pending_cancel',
        cardno: '1001',
        amount: 500,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };
      Transactions.findOne.mockResolvedValue(mockTx);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_pending_cancel'],
        status: STATUS_ADMIN_CANCELLED,
        issueCredits: 'no'
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(cancelTransaction).toHaveBeenCalledWith(req.user, null, mockTx, expect.any(Object), false);
    });

    test('rejects admin cancelled from invalid status like checkedin with 400', async () => {
      const mockBooking = {
        bookingid: 'b_checkedin',
        utsavid: 1,
        status: 'checkedin',
        update: jest.fn()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_checkedin'],
        status: STATUS_ADMIN_CANCELLED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          successCount: 0,
          failedCount: 1,
          failures: [
            expect.objectContaining({
              bookingid: 'b_checkedin',
              reason: 'Admin Cancelled can only be set from waiting, payment pending, confirmed or cancelled'
            })
          ]
        })
      }));
    });
  });

  describe('Scenario 3b: Payment Pending Invalid Transitions', () => {
    test('rejects payment pending from confirmed with 400', async () => {
      const mockBooking = {
        bookingid: 'b_confirmed',
        utsavid: 1,
        status: STATUS_CONFIRMED,
        update: jest.fn()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);

      req.body = {
        utsav_id: 1,
        bookingids: ['b_confirmed'],
        status: STATUS_PAYMENT_PENDING
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          successCount: 0,
          failedCount: 1,
          failures: [
            expect.objectContaining({
              bookingid: 'b_confirmed',
              reason: 'Payment Pending can only be set from waiting'
            })
          ]
        })
      }));
    });
  });

  describe('Scenario 4: Partial Failure Isolation', () => {
    test('processes valid bookings while capturing errors for already cancelled bookings', async () => {
      const mockValidBooking = {
        bookingid: 'b1',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_PAYMENT_PENDING,
        update: jest.fn().mockResolvedValue()
      };
      const mockCancelledBooking = {
        bookingid: 'b2',
        utsavid: 1,
        cardno: '1002',
        packageid: 10,
        status: STATUS_ADMIN_CANCELLED,
        update: jest.fn().mockResolvedValue()
      };

      validateUtsavBooking.mockImplementation((id) => {
        if (id === 'b1') return Promise.resolve(mockValidBooking);
        if (id === 'b2') return Promise.resolve(mockCancelledBooking);
      });

      const mockTx1 = { id: 1, bookingid: 'b1', status: STATUS_PAYMENT_PENDING, update: jest.fn().mockResolvedValue() };
      Transactions.findOne.mockImplementation(({ where }) => {
        if (where.bookingid === 'b1') return Promise.resolve(mockTx1);
        return Promise.resolve(null);
      });

      req.body = {
        utsav_id: 1,
        bookingids: ['b1', 'b2'],
        status: STATUS_CONFIRMED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 2,
          successCount: 1,
          failedCount: 1,
          failures: [
            expect.objectContaining({
              bookingid: 'b2',
              reason: ERR_BOOKING_ALREADY_CANCELLED
            })
          ]
        })
      }));
    });
  });

  describe('Scenario 5: Seat Exhaustion during Promotion', () => {
    test('succeeds for bookings while seats remain, and fails gracefully when seats run out', async () => {
      const mockWaitingBooking1 = {
        bookingid: 'b1',
        utsavid: 1,
        cardno: '1001',
        packageid: 10,
        status: STATUS_WAITING,
        update: jest.fn().mockResolvedValue()
      };
      const mockWaitingBooking2 = {
        bookingid: 'b2',
        utsavid: 1,
        cardno: '1002',
        packageid: 10,
        status: STATUS_WAITING,
        update: jest.fn().mockResolvedValue()
      };

      validateUtsavBooking.mockImplementation((id) => {
        if (id === 'b1') return Promise.resolve(mockWaitingBooking1);
        if (id === 'b2') return Promise.resolve(mockWaitingBooking2);
      });

      const mockPkg = { id: 10, amount: 500 };
      UtsavPackagesDb.findByPk.mockResolvedValue(mockPkg);

      // Booking 1 succeeds in reserving seat; booking 2 throws no seats available
      reserveUtsavSeat
        .mockResolvedValueOnce()
        .mockRejectedValueOnce(new ApiError(400, ERR_UTSAV_NO_SEATS_AVAILABLE));

      validateCard.mockResolvedValue({ cardno: '1001' });
      createPendingTransaction.mockResolvedValue({
        transaction: { status: STATUS_PAYMENT_PENDING }
      });

      req.body = {
        utsav_id: 1,
        bookingids: ['b1', 'b2'],
        status: STATUS_PAYMENT_PENDING
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 2,
          successCount: 1,
          failedCount: 1,
          failures: [
            expect.objectContaining({
              bookingid: 'b2',
              reason: ERR_UTSAV_NO_SEATS_AVAILABLE
            })
          ]
        })
      }));
    });

    test('auto-confirms free (0 amount) package bookings when setting payment pending', async () => {
      const mockFreeBooking = {
        bookingid: 'b_free',
        utsavid: 1,
        cardno: '1003',
        packageid: 20,
        status: STATUS_WAITING,
        update: jest.fn().mockResolvedValue()
      };

      validateUtsavBooking.mockResolvedValue(mockFreeBooking);
      UtsavPackagesDb.findByPk.mockResolvedValue({ id: 20, amount: 0 });
      reserveUtsavSeat.mockResolvedValue();

      req.body = {
        utsav_id: 1,
        bookingids: ['b_free'],
        status: STATUS_PAYMENT_PENDING
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(mockFreeBooking.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: STATUS_CONFIRMED }),
        expect.any(Object)
      );
      expect(bookFoodForUtsav).toHaveBeenCalled();
    });
  });

  describe('Scenario 6: Same Status Guard', () => {
    test('fails item when requested status is already current status', async () => {
      const mockBooking = {
        bookingid: 'b1',
        utsavid: 1,
        status: STATUS_CONFIRMED,
        update: jest.fn()
      };
      validateUtsavBooking.mockResolvedValue(mockBooking);

      req.body = {
        utsav_id: 1,
        bookingids: ['b1'],
        status: STATUS_CONFIRMED
      };

      await bulkUtsavStatusUpdate(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          total: 1,
          successCount: 0,
          failedCount: 1,
          failures: [
            expect.objectContaining({
              bookingid: 'b1',
              reason: 'Status is same as before'
            })
          ]
        })
      }));
    });
  });
});
