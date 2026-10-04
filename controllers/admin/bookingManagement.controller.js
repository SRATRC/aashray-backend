import {
  CardDb,
  RoomBooking,
  FlatBooking,
  TravelDb,
  UtsavBooking,
  UtsavDb,
  UtsavPackagesDb,
  FoodDb,
  ShibirBookingDb,
  ShibirDb,
  Transactions
} from '../../models/associations.js';
import {
  ROOM_STATUS_CHECKEDIN,
  ROOM_STATUS_CHECKEDOUT,
  STATUS_CANCELLED,
  ERR_BOOKING_NOT_FOUND,
  STATUS_ADMIN_CANCELLED,
  TYPE_ROOM,
  TYPE_FLAT,
  TYPE_TRAVEL,
  TYPE_UTSAV,
  TYPE_FOOD,
  TYPE_ADHYAYAN,
  ERR_INVALID_BOOKING_TYPE,
  ERR_INVALID_BOOKING_CATEGORY,
  ERR_BOOKING_HISTORY_PARAMS_REQUIRED,
  MSG_CANCEL_SUCCESSFUL,
  MSG_BOOKING_DETAILS_FETCHED,
  MSG_BOOKING_HISTORY_FETCHED
} from '../../config/constants.js';
import { adminCancelTransaction } from '../../helpers/transactions.helper.js';
import { sendDualUserNotifications } from '../../helpers/notification.helper.js';
import { sendRoomStatusChangeWhatsApp } from '../../helpers/whatsapp.helper.js';
import Sequelize from 'sequelize';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import moment from 'moment';

export const cancelBooking = async (req, res) => {
  const { type, bookingid } = req.params;

  const t = await database.transaction();
  req.transaction = t;

  var booking = null;
  switch (type) {
    case TYPE_ROOM:
      booking = await RoomBooking.findOne({
        include: [
          {
            model: CardDb,
            attributes: ['issuedto']
          }
        ],
        where: {
          bookingid,
          status: {
            [Sequelize.Op.notIn]: [
              ROOM_STATUS_CHECKEDIN,
              ROOM_STATUS_CHECKEDOUT,
              STATUS_ADMIN_CANCELLED,
              STATUS_CANCELLED
            ]
          }
        }
      });
      break;

    default:
      throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  var transaction = await Transactions.findOne({
    where: { bookingid: booking.bookingid }
  });

  var result = null;
  if (transaction) {
    result = await adminCancelTransaction(req.user, null, transaction, t);
  }

  const originalStatus = booking.status;

  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();

  try {
    await sendRoomStatusChangeWhatsApp(booking, originalStatus, { updatedBy: req.user.username });
  } catch (waErr) {
    console.error("Error sending room status change WhatsApp:", waErr);
  }

  sendDualUserNotifications({
    primary: {
      cardno: booking.cardno,
      title: 'Raj Sharan Booking Cancelled by Admin',
      body: `Your stay from ${moment(booking.checkin).format(
        'Do MMM, YYYY'
      )} to ${moment(booking.checkout).format(
        'Do MMM, YYYY'
      )} has been cancelled by admin.`
    },
    bookedBy: booking.bookedBy && {
      cardno: booking.bookedBy,
      title: 'Raj Sharan Booking Cancelled by Admin',
      body: `Stay for ${booking.CardDb.issuedto.split(' ')[0]} from ${moment(
        booking.checkin
      ).format('Do MMM, YYYY')} to ${moment(booking.checkout).format(
        'Do MMM, YYYY'
      )} has been cancelled by admin.`
    },
    screen: '/bookings'
  });

  return res
    .status(200)
    .send({ message: MSG_CANCEL_SUCCESSFUL, data: { booking, result } });
};

export const getBookingDetails = async (req, res) => {
  const { type, bookingid } = req.params;
  req.log.info('get_booking_details_start', { type, bookingid });

  const withName = [{ model: CardDb, attributes: ['issuedto'] }];
  const where = { bookingid };

  let booking = null;
  switch (type.toLowerCase()) {
    case TYPE_ROOM:
      // A room booking id may belong to a flat booking.
      booking =
        (await RoomBooking.findOne({ where, include: withName })) ||
        (await FlatBooking.findOne({ where, include: withName }));
      break;
    case TYPE_FLAT:
      booking = await FlatBooking.findOne({ where, include: withName });
      break;
    case TYPE_TRAVEL:
      booking = await TravelDb.findOne({ where });
      break;
    case TYPE_UTSAV:
      booking = await UtsavBooking.findOne({ where, include: withName });
      break;
    case TYPE_FOOD:
      booking = await FoodDb.findOne({ where: { id: bookingid } });
      break;
    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_TYPE);
  }

  if (!booking) {
    throw new ApiError(404, ERR_BOOKING_NOT_FOUND);
  }

  return res
    .status(200)
    .json({ message: MSG_BOOKING_DETAILS_FETCHED, data: booking });
};

const HISTORY_DEFAULT_PAGE_SIZE = 20;
const HISTORY_MAX_PAGE_SIZE = 100;
const HISTORY_MAX_PAGE = 1000;

export const getBookingHistory = async (req, res) => {
  const { cardno, category } = req.query;
  req.log.info('get_booking_history_start', { cardno, category });

  if (!cardno || !category) {
    throw new ApiError(400, ERR_BOOKING_HISTORY_PARAMS_REQUIRED);
  }

  const parsedPage = parseInt(req.query.page, 10);
  const page = parsedPage > 0 ? Math.min(parsedPage, HISTORY_MAX_PAGE) : 1;
  const parsedSize = parseInt(req.query.page_size, 10);
  const pageSize = Math.min(
    parsedSize > 0 ? parsedSize : HISTORY_DEFAULT_PAGE_SIZE,
    HISTORY_MAX_PAGE_SIZE
  );

  const where = {
    [Sequelize.Op.or]: [{ cardno }, { bookedBy: cardno }]
  };
  const withName = { model: CardDb, attributes: ['issuedto'] };
  const newestFirst = [['createdAt', 'DESC']];

  // Each entry is the query for one page of a category.
  const pageOf = (model, extra = {}, order = newestFirst) =>
    model.findAndCountAll({
      where,
      order,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      ...extra
    });

  let rows = [];
  let count = 0;

  switch (category.toLowerCase()) {
    case TYPE_ROOM: {
      // Rooms and flats are two tables shown as one list: take the first
      // page * pageSize of each, merge by date, then cut out this page.
      const window = { limit: page * pageSize, offset: 0 };
      const [rooms, flats] = await Promise.all([
        RoomBooking.findAndCountAll({
          where,
          include: [withName],
          order: newestFirst,
          ...window
        }),
        FlatBooking.findAndCountAll({
          where,
          include: [withName],
          order: newestFirst,
          ...window
        })
      ]);
      count = rooms.count + flats.count;
      rows = [...rooms.rows, ...flats.rows]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice((page - 1) * pageSize, page * pageSize);
      break;
    }
    case TYPE_FLAT:
      ({ rows, count } = await pageOf(FlatBooking, { include: [withName] }));
      break;
    case TYPE_TRAVEL:
      ({ rows, count } = await pageOf(TravelDb, {}, [['date', 'DESC']]));
      break;
    case TYPE_UTSAV:
      ({ rows, count } = await pageOf(UtsavBooking, {
        include: [
          withName,
          { model: UtsavDb, attributes: ['name'] },
          { model: UtsavPackagesDb, attributes: ['name'] }
        ],
        distinct: true
      }));
      break;
    case TYPE_FOOD:
      ({ rows, count } = await pageOf(FoodDb, {}, [['date', 'DESC']]));
      break;
    case TYPE_ADHYAYAN:
      ({ rows, count } = await pageOf(ShibirBookingDb, {
        include: [{ model: ShibirDb }],
        distinct: true
      }));
      break;
    default:
      throw new ApiError(400, ERR_INVALID_BOOKING_CATEGORY);
  }

  // `data` stays a plain list so existing callers keep working.
  return res.status(200).json({
    message: MSG_BOOKING_HISTORY_FETCHED,
    data: rows,
    pagination: {
      page,
      page_size: pageSize,
      totalCount: count,
      totalPages: Math.ceil(count / pageSize)
    }
  });
};
