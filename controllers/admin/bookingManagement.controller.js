import {
  CardDb,
  RoomBooking,
  FlatBooking,
  TravelDb,
  UtsavBooking,
  UtsavDb,
  UtsavPackagesDb,
  BulkFoodBooking,
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
  MSG_CANCEL_SUCCESSFUL
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

  let booking = null;
  const where = { bookingid };

  switch (type.toLowerCase()) {
    case 'room':
      booking = await RoomBooking.findOne({ where, include: [{ model: CardDb, attributes: ['issuedto'] }] });
      if (!booking) {
        booking = await FlatBooking.findOne({ where, include: [{ model: CardDb, attributes: ['issuedto'] }] });
      }
      break;
    case 'flat':
      booking = await FlatBooking.findOne({ where, include: [{ model: CardDb, attributes: ['issuedto'] }] });
      break;
    case 'travel':
      booking = await TravelDb.findOne({ where });
      break;
    case 'utsav':
      booking = await UtsavBooking.findOne({ where, include: [{ model: CardDb, attributes: ['issuedto'] }] });
      if (!booking) {
        booking = await UtsavBooking.findOne({ where });
      }
      break;
    case 'food':
      booking = await FoodDb.findOne({ where: { id: bookingid } });
      break;
    default:
      return res.status(400).json({ message: 'Invalid booking type' });
  }

  if (!booking) {
    return res.status(404).json({ message: 'Booking not found' });
  }

  return res.status(200).json({ message: 'Fetched booking details successfully', data: booking });
};

export const getBookingHistory = async (req, res) => {
  const { cardno, category } = req.query;
  req.log.info('get_booking_history_start', { cardno, category });

  if (!cardno || !category) {
    return res.status(400).json({ message: 'cardno and category are required' });
  }

  let bookings = [];
  const where = {
    [Sequelize.Op.or]: [
      { cardno },
      { bookedBy: cardno }
    ]
  };

  try {
    switch (category.toLowerCase()) {
      case 'room': {
        const rooms = await RoomBooking.findAll({
          where,
          include: [{ model: CardDb, attributes: ['issuedto'] }],
          order: [['createdAt', 'DESC']]
        });
        const flats = await FlatBooking.findAll({
          where,
          include: [{ model: CardDb, attributes: ['issuedto'] }],
          order: [['createdAt', 'DESC']]
        });
        bookings = [...rooms, ...flats];
        bookings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      }
      case 'flat': {
        bookings = await FlatBooking.findAll({
          where,
          include: [{ model: CardDb, attributes: ['issuedto'] }],
          order: [['createdAt', 'DESC']]
        });
        break;
      }
      case 'travel': {
        bookings = await TravelDb.findAll({
          where,
          order: [['date', 'DESC']]
        });
        break;
      }
      case 'utsav': {
        bookings = await UtsavBooking.findAll({
          where,
          include: [
            { model: CardDb, attributes: ['issuedto'] },
            { model: UtsavDb, attributes: ['name'] },
            { model: UtsavPackagesDb, attributes: ['name'] }
          ],
          order: [['createdAt', 'DESC']]
        });
        break;
      }
      case 'food': {
        bookings = await FoodDb.findAll({
          where,
          order: [['date', 'DESC']]
        });
        break;
      }
      case 'adhyayan': {
        bookings = await ShibirBookingDb.findAll({
          where,
          include: [{ model: ShibirDb }],
          order: [['createdAt', 'DESC']]
        });
        break;
      }
      default:
        return res.status(400).json({ message: 'Invalid category' });
    }

    return res.status(200).json({
      message: 'Fetched booking history successfully',
      data: bookings
    });
  } catch (error) {
    req.log.error('get_booking_history_error', { error: error.message });
    return res.status(500).json({ message: error.message });
  }
};
