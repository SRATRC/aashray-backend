import { reserveUtsavSeat } from '../../helpers/utsavBooking.helper.js';
import { UtsavDb } from '../../models/associations.js';
import { ERR_UTSAV_NO_SEATS_AVAILABLE } from '../../config/constants.js';
import ApiError from '../../utils/ApiError.js';

jest.mock('../../models/associations.js', () => ({
  UtsavDb: { findOne: jest.fn() }
}));
jest.mock('../../config/logger.js', () => ({}));
jest.mock('../../config/database.js', () => ({}));
jest.mock('../../helpers/transactions.helper.js', () => ({}));
jest.mock('../../controllers/helper.js', () => ({}));
jest.mock('../../utils/sendMail.js', () => ({}));
jest.mock('../../helpers/foodBooking.helper.js', () => ({}));

describe('reserveUtsavSeat', () => {
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([0, -1])('rejects a Utsav with %i seats with the seat error', async (seats) => {
    const utsav = { id: 26, available_seats: 10 };
    const freshUtsav = { available_seats: seats, update: jest.fn() };
    UtsavDb.findOne.mockResolvedValue(freshUtsav);

    const error = await reserveUtsavSeat(utsav, transaction).catch((err) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      statusCode: 400,
      message: ERR_UTSAV_NO_SEATS_AVAILABLE
    });
    expect(freshUtsav.update).not.toHaveBeenCalled();
    expect(utsav.available_seats).toBe(10);
  });

  test('reserves the last seat from the locked Utsav row', async () => {
    const utsav = { id: 26, available_seats: 10 };
    const freshUtsav = { available_seats: 1, update: jest.fn().mockResolvedValue() };
    UtsavDb.findOne.mockResolvedValue(freshUtsav);

    await reserveUtsavSeat(utsav, transaction);

    expect(UtsavDb.findOne).toHaveBeenCalledWith({
      where: { id: 26 },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    expect(freshUtsav.update).toHaveBeenCalledWith(
      { available_seats: 0 },
      { transaction }
    );
    expect(utsav.available_seats).toBe(0);
  });
});
