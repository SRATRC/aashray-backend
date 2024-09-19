import { RoomBooking, WifiDb } from '../../models/associations.js';
import {
  ROOM_STATUS_CHECKEDIN,
  STATUS_ACTIVE,
  STATUS_INACTIVE
} from '../../config/constants.js';
import APIError from '../../utils/ApiError.js';

export const generatePassword = async (req, res) => {
  const isCheckedin = await RoomBooking.findOne({
    where: {
      cardno: req.user.cardno,
      status: ROOM_STATUS_CHECKEDIN
    }
  });
  if (!isCheckedin) {
    throw new APIError(401, 'User not checkedin');
  }

  const count = await WifiDb.count({
    where: {
      cardno: req.user.cardno,
      status: STATUS_INACTIVE,
      roombookingid: isCheckedin.bookingid
    }
  });
  if (count < 5) {
    const [updatedRows, updatedRowsCount] = await WifiDb.update(
      {
        status: STATUS_INACTIVE,
        roombookingid: isCheckedin.bookingid,
        cardno: req.user.cardno
      },
      {
        where: { status: STATUS_ACTIVE },
        order: [['pwd_id', 'ASC']],
        limit: 1,
        returning: true
      }
    );
    const updatedRow = await WifiDb.findOne({
      attributes: ['password'],
      where: { status: STATUS_INACTIVE },
      order: [['pwd_id', 'DESC']],
      limit: 1
    });
    if (updatedRowsCount === 0) {
      throw new APIError(404, 'Error updating the status');
    }

    return res.status(200).send({
      data: updatedRow,
      message: 'Your wifi password has been generated'
    });
  } else {
    throw new APIError(400, 'Cannot generate more than 4 passwords');
  }
};

export const getPassword = async (req, res) => {
  const isCheckedIn = await RoomBooking.findOne({
    where: {
      cardno: req.user.cardno,
      status: ROOM_STATUS_CHECKEDIN
    }
  });

  if (!isCheckedIn) {
    throw new APIError(401, 'User not checkedin');
  }

  const passwords = await WifiDb.findAll({
    attributes: ['password', 'createdAt'],
    where: {
      cardno: req.user.cardno,
      roombookingid: isCheckedIn.bookingid
    },
    order: [['createdAt', 'ASC']]
  });
  return res.status(200).send({ message: 'Wifi Passwords', data: passwords });
};
