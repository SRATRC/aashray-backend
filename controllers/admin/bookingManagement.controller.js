import {
  RoomBooking,
  Transactions,
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
import {
  checkFlatAlreadyBooked,
  calculateNights,
  validateDate,
  getBlockedDates,
  sendUnifiedEmail
} from '../helper.js';

import Sequelize, { where } from 'sequelize';
import database from '../../config/database.js';
import ApiError from '../../utils/ApiError.js';
import {
  adminCancelTransaction
} from '../../helpers/transactions.helper.js';

export const cancelBooking = async (req, res) => {
  const { type, bookingid } = req.params;

  const t = await database.transaction();
  req.transaction = t;

  var booking = null;
  switch(type) {
    case TYPE_ROOM:
      booking = await RoomBooking.findOne({
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
    result = await adminCancelTransaction(req.user, transaction, t);
  }

  await booking.update(
    {
      status: STATUS_ADMIN_CANCELLED,
      updatedBy: req.user.username
    },
    { transaction: t }
  );

  await t.commit();

  return res
    .status(200)
    .send({ message: MSG_CANCEL_SUCCESSFUL, data: { booking, result } });
};