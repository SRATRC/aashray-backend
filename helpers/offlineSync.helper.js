import {
  CardDb,
  FoodDb,
  ShibirDb,
  ShibirSession,
  ShibirAttendanceDb,
  ShibirBookingDb,
  UtsavDb,
  UtsavBooking,
  RoomBooking,
  FlatBooking,
  WifiDb,
  Transactions
} from '../models/associations.js';
import {
  STATUS_CONFIRMED,
  STATUS_CASH_COMPLETED,
  STATUS_ACTIVE,
  STATUS_INACTIVE,
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_PENDING_CHECKIN
} from '../config/constants.js';
import {
  findUnpaidBookingTransaction,
  UNPAID_TRANSACTION_STATUSES
} from './transactions.helper.js';
import {
  executeRoomCheckout,
  executeFlatCheckout
} from '../controllers/admin/roomManagement.controller.js';
import ApiError from '../utils/ApiError.js';
import { Op } from 'sequelize';
import moment from 'moment-timezone';
import crypto from 'crypto';

/**
 * Returns SHA-256 hash of the configured Station PIN.
 * Fails closed if STATION_PIN is not configured.
 */
export function getStationPinHash() {
  const pin = process.env.STATION_PIN;
  if (!pin) {
    throw new ApiError(500, 'Station PIN is not configured on server');
  }
  return crypto.createHash('sha256').update(pin).digest('hex');
}

/**
 * Returns today's active meal bookings snapshot for offline validation.
 */
export async function getFoodTodaySnapshot(req) {
  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
  req?.log?.info('offline_snapshot_food_start', { today });

  const bookings = await FoodDb.findAll({
    where: {
      date: today,
      [Op.or]: [
        { breakfast: true },
        { lunch: true },
        { dinner: true }
      ]
    },
    include: [
      {
        model: CardDb,
        attributes: ['cardno', 'issuedto'],
        required: false
      }
    ],
    attributes: [
      'cardno',
      'breakfast',
      'breakfast_plate_issued',
      'lunch',
      'lunch_plate_issued',
      'dinner',
      'dinner_plate_issued'
    ],
    raw: true
  });

  const snapshot = bookings.map((b) => ({
    cardno: b.cardno,
    name: b['CardDb.issuedto'] || 'Member',
    breakfast: Boolean(b.breakfast),
    breakfast_plate_issued: Boolean(b.breakfast_plate_issued),
    lunch: Boolean(b.lunch),
    lunch_plate_issued: Boolean(b.lunch_plate_issued),
    dinner: Boolean(b.dinner),
    dinner_plate_issued: Boolean(b.dinner_plate_issued)
  }));

  req?.log?.info('offline_snapshot_food_success', { count: snapshot.length });
  return snapshot;
}

/**
 * Returns Shibir metadata, configured sessions (including Morning Vanchan),
 * and confirmed participants for offline attendance validation.
 */
export async function getAdhyayanSnapshot(shibirId, req) {
  req?.log?.info('offline_snapshot_adhyayan_start', { shibirId });

  let shibir;
  if (shibirId && shibirId !== 'today') {
    shibir = await ShibirDb.findByPk(shibirId, {
      attributes: ['id', 'shibir_name', 'start_date', 'end_date']
    });
  } else {
    const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    shibir = await ShibirDb.findOne({
      where: {
        start_date: { [Op.lte]: today },
        end_date: { [Op.gte]: today }
      },
      order: [['start_date', 'DESC']],
      attributes: ['id', 'shibir_name', 'start_date', 'end_date']
    });
  }

  if (!shibir) {
    throw new ApiError(404, 'No active Shibir found for today');
  }

  const targetShibirId = shibir.id;

  const sessions = await ShibirSession.findAll({
    where: { shibir_id: targetShibirId },
    attributes: ['session_number', 'type', 'date', 'start_time'],
    order: [['session_number', 'ASC']],
    raw: true
  });

  const attendances = await ShibirAttendanceDb.findAll({
    where: { shibir_id: targetShibirId },
    include: [
      {
        model: ShibirBookingDb,
        required: true,
        where: {
          status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED]
        },
        attributes: ['bookingid']
      },
      {
        model: CardDb,
        required: false,
        attributes: ['cardno', 'issuedto']
      }
    ],
    raw: true
  });

  const participants = attendances.map((a) => ({
    cardno: a.cardno,
    name: a['CardDb.issuedto'] || 'Participant',
    bookingid: a['ShibirBookingDb.bookingid']
  }));

  req?.log?.info('offline_snapshot_adhyayan_success', {
    shibirId,
    sessionCount: sessions.length,
    participantCount: participants.length
  });

  return {
    shibir: {
      id: shibir.id,
      name: shibir.shibir_name,
      start_date: shibir.start_date,
      end_date: shibir.end_date
    },
    sessions: sessions.map((s) => ({
      session_number: s.session_number,
      session_type: s.type === 'MV' ? 'mv' : 'regular',
      name: s.type === 'MV' ? 'Morning Vanchan' : `Session ${s.session_number}`,
      date: s.date,
      start_time: s.start_time
    })),
    participants
  };
}

/**
 * Returns active card directory with resident classification for offline Gate scanning.
 */
export async function getGateCardsSnapshot(req) {
  req?.log?.info('offline_snapshot_gate_start');

  const cards = await CardDb.findAll({
    where: { active: true },
    attributes: ['cardno', 'issuedto', 'res_status'],
    raw: true
  });

  req?.log?.info('offline_snapshot_gate_success', { count: cards.length });
  return cards.map((c) => ({
    cardno: c.cardno,
    name: c.issuedto || 'Cardholder',
    res_status: c.res_status || 'Guest'
  }));
}

/**
 * Returns confirmed/paid Utsav attendees for offline check-in and food scanning.
 */
export async function getUtsavSnapshot(utsavId, req) {
  req?.log?.info('offline_snapshot_utsav_start', { utsavId });

  let utsav;
  if (utsavId && utsavId !== 'today') {
    utsav = await UtsavDb.findByPk(utsavId, {
      attributes: ['id', 'name', 'start_date', 'end_date']
    });
  } else {
    const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
    utsav = await UtsavDb.findOne({
      where: {
        start_date: { [Op.lte]: today },
        end_date: { [Op.gte]: today }
      },
      order: [['start_date', 'DESC']],
      attributes: ['id', 'name', 'start_date', 'end_date']
    });
  }

  if (!utsav) {
    throw new ApiError(404, 'No active Utsav found for today');
  }

  const targetUtsavId = utsav.id;

  const bookings = await UtsavBooking.findAll({
    where: {
      utsavid: targetUtsavId,
      status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN]
    },
    include: [
      {
        model: CardDb,
        required: false,
        attributes: ['cardno', 'issuedto']
      }
    ],
    attributes: ['bookingid', 'cardno', 'status', 'package'],
    raw: true
  });

  const participants = bookings.map((b) => ({
    bookingid: b.bookingid,
    cardno: b.cardno,
    name: b['CardDb.issuedto'] || 'Participant',
    status: b.status,
    package: b.package
  }));

  req?.log?.info('offline_snapshot_utsav_success', {
    utsavId,
    count: participants.length
  });

  return {
    utsav: {
      id: utsav.id,
      name: utsav.name,
      start_date: utsav.start_date,
      end_date: utsav.end_date
    },
    participants
  };
}

/**
 * Returns today's active checkin/checkout room bookings with pre-assigned rooms
 * (paid only) along with a pre-allocated pool of 50 active Wi-Fi vouchers.
 */
export async function getKioskTodaySnapshot(req) {
  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
  req?.log?.info('offline_snapshot_kiosk_start', { today });

  const activeStayWhere = {
    [Op.or]: [
      {
        status: ROOM_STATUS_CHECKEDIN,
        checkout: { [Op.gte]: today }
      },
      {
        status: ROOM_STATUS_PENDING_CHECKIN,
        checkin: today
      }
    ]
  };

  const [roomBookings, flatBookings, activeVouchers] = await Promise.all([
    RoomBooking.findAll({
      where: activeStayWhere,
      attributes: ['bookingid', 'cardno', 'roomno', 'roomtype', 'checkin', 'checkout', 'status'],
      include: [
        {
          model: CardDb,
          required: false,
          attributes: ['cardno', 'issuedto']
        }
      ]
    }),
    FlatBooking.findAll({
      where: activeStayWhere,
      attributes: ['bookingid', 'cardno', 'flatno', 'checkin', 'checkout', 'status'],
      include: [
        {
          model: CardDb,
          required: false,
          attributes: ['cardno', 'issuedto']
        }
      ]
    }),
    WifiDb.findAll({
      where: { status: STATUS_ACTIVE },
      attributes: ['pwd_id', 'password'],
      order: [['pwd_id', 'DESC']],
      limit: 50,
      raw: true
    })
  ]);

  const allEligibleBookings = [
    ...roomBookings.filter((b) => b.roomno),
    ...flatBookings.filter((b) => b.flatno)
  ];
  const allBookingIds = allEligibleBookings.map((b) => b.bookingid);

  const unpaidTxList = allBookingIds.length > 0 ? await Transactions.findAll({
    where: {
      bookingid: allBookingIds,
      status: UNPAID_TRANSACTION_STATUSES,
      amount: { [Op.gt]: 0 }
    },
    attributes: ['bookingid'],
    raw: true
  }) : [];
  const unpaidBookingSet = new Set(unpaidTxList.map((t) => t.bookingid));

  const validRoomBookings = [];
  for (const b of roomBookings) {
    if (!b.roomno) continue; // Require pre-assigned room
    if (!unpaidBookingSet.has(b.bookingid)) {
      validRoomBookings.push({
        bookingid: b.bookingid,
        cardno: b.cardno,
        name: b.CardDb?.issuedto || 'Guest',
        roomno: b.roomno,
        roomtype: b.roomtype,
        isFlat: false,
        checkin: b.checkin,
        checkout: b.checkout,
        status: b.status
      });
    }
  }

  const validFlatBookings = [];
  for (const b of flatBookings) {
    if (!b.flatno) continue; // Require pre-assigned flat
    if (!unpaidBookingSet.has(b.bookingid)) {
      validFlatBookings.push({
        bookingid: b.bookingid,
        cardno: b.cardno,
        name: b.CardDb?.issuedto || 'Guest',
        roomno: b.flatno,
        roomtype: 'Flat',
        isFlat: true,
        checkin: b.checkin,
        checkout: b.checkout,
        status: b.status
      });
    }
  }

  const allBookings = [...validRoomBookings, ...validFlatBookings];

  req?.log?.info('offline_snapshot_kiosk_success', {
    bookingCount: allBookings.length,
    wifiPoolCount: activeVouchers.length
  });

  return {
    bookings: allBookings,
    wifiPool: activeVouchers
  };
}

/**
 * Reconciles offline room kiosk check-ins, check-outs, and Wi-Fi vouchers.
 */
export async function syncKioskBatch(payload, req, t) {
  const checkins = Array.isArray(payload?.checkins) ? payload.checkins : [];
  const checkouts = Array.isArray(payload?.checkouts) ? payload.checkouts : [];
  const wifiAssignments = Array.isArray(payload?.wifiAssignments) ? payload.wifiAssignments : [];

  req?.log?.info('offline_sync_kiosk_batch_start', {
    checkinCount: checkins.length,
    checkoutCount: checkouts.length,
    wifiCount: wifiAssignments.length
  });

  const results = {
    checkins: [],
    checkouts: [],
    wifiAssignments: []
  };

  const todayIST = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');

  // Process check-ins
  for (const item of checkins) {
    if (!item || !item.bookingid) continue;
    try {
      const model = item.isFlat ? FlatBooking : RoomBooking;
      const booking = await model.findOne({
        where: { bookingid: item.bookingid },
        transaction: t
      });

      if (!booking || booking.status !== ROOM_STATUS_PENDING_CHECKIN) {
        results.checkins.push({
          bookingid: item.bookingid,
          status: 'skipped',
          reason: booking?.status || 'not_found'
        });
        continue;
      }

      if (booking.checkin > todayIST) {
        results.checkins.push({
          bookingid: item.bookingid,
          status: 'skipped',
          reason: 'future_booking'
        });
        continue;
      }

      const unpaid = await findUnpaidBookingTransaction(booking.bookingid, t);
      if (unpaid) {
        results.checkins.push({
          bookingid: item.bookingid,
          status: 'skipped',
          reason: 'unpaid_transaction'
        });
        continue;
      }

      await booking.update(
        {
          status: ROOM_STATUS_CHECKEDIN,
          updatedBy: req.user?.username || 'KIOSK_OFFLINE'
        },
        { transaction: t }
      );
      results.checkins.push({ bookingid: item.bookingid, status: 'success' });
    } catch (err) {
      results.checkins.push({ bookingid: item.bookingid, status: 'error', error: err.message });
    }
  }

  // Process check-outs
  for (const item of checkouts) {
    if (!item || !item.bookingid) continue;
    try {
      const model = item.isFlat ? FlatBooking : RoomBooking;
      const booking = await model.findOne({
        where: { bookingid: item.bookingid },
        include: [
          {
            model: CardDb,
            attributes: ['cardno', 'issuedto', 'token']
          }
        ],
        transaction: t
      });

      if (!booking || booking.status !== ROOM_STATUS_CHECKEDIN) {
        results.checkouts.push({
          bookingid: item.bookingid,
          status: 'skipped',
          reason: booking?.status || 'not_found'
        });
        continue;
      }

      const checkoutUser = req.user || { username: 'KIOSK_OFFLINE' };
      if (item.isFlat) {
        await executeFlatCheckout({
          booking,
          checkoutDateTime: item.scannedAt,
          dbTransaction: t,
          user: checkoutUser
        });
      } else {
        await executeRoomCheckout({
          booking,
          checkoutDateTime: item.scannedAt,
          dbTransaction: t,
          user: checkoutUser
        });
      }

      results.checkouts.push({ bookingid: item.bookingid, status: 'success' });
    } catch (err) {
      results.checkouts.push({ bookingid: item.bookingid, status: 'error', error: err.message });
    }
  }

  // Process Wi-Fi voucher allocations
  for (const item of wifiAssignments) {
    if (!item || !item.pwd_id) continue;
    try {
      const [affectedRows] = await WifiDb.update(
        {
          cardno: item.cardno,
          roombookingid: item.bookingid,
          status: STATUS_INACTIVE,
          updatedBy: req.user?.username || 'KIOSK_OFFLINE'
        },
        {
          where: { pwd_id: item.pwd_id, status: STATUS_ACTIVE },
          transaction: t
        }
      );

      if (affectedRows > 0) {
        results.wifiAssignments.push({ pwd_id: item.pwd_id, status: 'success' });
      } else {
        results.wifiAssignments.push({
          pwd_id: item.pwd_id,
          status: 'error',
          reason: 'already_assigned_or_inactive'
        });
      }
    } catch (err) {
      results.wifiAssignments.push({ pwd_id: item.pwd_id, status: 'error', error: err.message });
    }
  }

  req?.log?.info('offline_sync_kiosk_batch_success', { results });
  return results;
}
