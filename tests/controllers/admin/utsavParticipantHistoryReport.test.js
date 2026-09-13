import database from '../../../config/database.js';

jest.mock('../../../config/database.js', () => ({
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
    query: jest.fn(),
    QueryTypes: { SELECT: 'SELECT' },
    transaction: jest.fn()
  }
}));

jest.mock('../../../models/associations.js', () => ({
  UtsavDb: {
    findOne: jest.fn()
  },
  UtsavPackagesDb: {},
  UtsavBooking: {},
  CardDb: {},
  RoomBooking: {}
}));

import { utsavParticipantHistoryReport } from '../../../controllers/admin/utsavManagement.controller.js';
import { UtsavDb } from '../../../models/associations.js';

describe('utsavParticipantHistoryReport Controller', () => {
  let req, res;

  beforeEach(() => {
    jest.clearAllMocks();
    req = {
      query: {},
      log: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      }
    };
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      setHeader: jest.fn()
    };
  });

  it('should return 400 if utsavid is missing', async () => {
    req.query = {};

    await utsavParticipantHistoryReport(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalledWith({ message: 'utsavid is required' });
  });

  it('should return 404 if Utsav is not found', async () => {
    req.query = { utsavid: '999' };
    UtsavDb.findOne.mockResolvedValue(null);

    await utsavParticipantHistoryReport(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.send).toHaveBeenCalledWith({ message: 'Utsav not found' });
  });

  it('should return empty report when no confirmed participants exist', async () => {
    req.query = { utsavid: '1' };
    UtsavDb.findOne.mockResolvedValue({ id: 1, name: 'Diwali Utsav', start_date: '2026-11-01' });
    database.query.mockResolvedValue([]);

    await utsavParticipantHistoryReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'No confirmed participants found for this Utsav',
        data: []
      })
    );
  });

  it('should correctly aggregate history and tags for confirmed participants', async () => {
    req.query = { utsavid: '1' };
    UtsavDb.findOne.mockResolvedValue({ id: 1, name: 'Diwali Utsav', start_date: '2026-11-01' });

    // Mock participants query
    database.query.mockResolvedValueOnce([
      {
        bookingid: 'UB001',
        utsavid: 1,
        booking_status: 'confirmed',
        roomno: '101',
        cardno: 'CARD100',
        issuedto: 'Devotee One',
        mobno: '9999999999',
        gender: 'Male',
        center: 'Surat',
        dob: '1985-01-01',
        res_status: 'MUMUKSHU',
        age: 41
      }
    ]);

    // Mock stay days query
    database.query.mockResolvedValueOnce([{ cardno: 'CARD100', stay_days: '35' }]);
    // Mock single day visits query
    database.query.mockResolvedValueOnce([{ cardno: 'CARD100', single_day_visits: '2' }]);
    // Mock PGS query
    database.query.mockResolvedValueOnce([{ cardno: 'CARD100', pgs_count: '6' }]);
    // Mock Non-PGS query
    database.query.mockResolvedValueOnce([{ cardno: 'CARD100', non_pgs_count: '2' }]);
    // Mock past Utsav query
    database.query.mockResolvedValueOnce([{ cardno: 'CARD100', utsav_count: '0' }]);

    await utsavParticipantHistoryReport(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const responseData = res.send.mock.calls[0][0];
    expect(responseData.data).toHaveLength(1);
    expect(responseData.data[0]).toMatchObject({
      cardno: 'CARD100',
      history_1yr: {
        stay_days: 35,
        pgs_adhyayan_count: 6,
        non_pgs_adhyayan_count: 2,
        total_adhyayan_count: 8,
        utsav_count: 0
      },
      tags: expect.arrayContaining(['first_timer', 'regular_stay', 'pgs_regular', 'active_adhyayan', 'frequent_visitor'])
    });
  });

  it('should handle excel export format header setup', async () => {
    req.query = { utsavid: '1', format: 'excel' };
    UtsavDb.findOne.mockResolvedValue({ id: 1, name: 'Diwali Utsav', start_date: '2026-11-01' });

    database.query.mockResolvedValueOnce([
      {
        bookingid: 'UB001',
        utsavid: 1,
        booking_status: 'confirmed',
        cardno: 'CARD100',
        issuedto: 'Devotee One',
        mobno: '9999999999',
        gender: 'Male',
        center: 'Surat',
        age: 41
      }
    ]);
    database.query.mockResolvedValueOnce([]);
    database.query.mockResolvedValueOnce([]);
    database.query.mockResolvedValueOnce([]);
    database.query.mockResolvedValueOnce([]);
    database.query.mockResolvedValueOnce([]);

    await utsavParticipantHistoryReport(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', expect.stringContaining('Utsav_Participant_History_1.xlsx'));
  });
});
