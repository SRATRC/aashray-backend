import dotenv from 'dotenv';

dotenv.config({
  path: '.env.dev',
});

import jwt from 'jsonwebtoken';

import TravelBusGroup
from '../../models/travelBusGroup.model.js';

import TravelBusPassengers
from '../../models/travelBusPassengers.model.js';

import TravelDb
from '../../models/travel_db.model.js';

import CoordinatorOtp from '../../models/coordinatorOtp.model.js';
import CardDb from '../../models/card.model.js';
import { sendCoordinatorOtp } from '../../helpers/sendCoordinatorOtp.js';
import ApiError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';

export async function sendOtp(
  req,
  res
) {

  const { mobno } = req.body;

  if (!mobno) {
    throw new ApiError(
      400,
      'Mobile number required'
    );
  }

  // VALIDATE COORDINATOR EXISTS

  const coordinator =
    await CardDb.findOne({
      where: { mobno },
    });

  if (!coordinator) {

    throw new ApiError(
      404,
      'Coordinator not found'
    );
  }

  const travelBooking =
  await TravelDb.findOne({

    where: {
      cardno:
        coordinator.cardno,
    },
  });

if (!travelBooking) {

  throw new ApiError(
    403,
    'Travel booking not found'
  );
}

// FIND ALL UPCOMING COORDINATOR BUSES

const assignedBuses =
  await TravelBusGroup.findAll({

    where: {

      coordinator_bookingid: {
        [Sequelize.Op.ne]:
          null,
      },

      event_date: {
        [Sequelize.Op.gte]:
          new Date(),
      },
    },
  });

let isCoordinator =
  false;

for (const bus of assignedBuses) {

  const travelBooking =
    await TravelDb.findOne({

      where: {
        bookingid:
          bus.coordinator_bookingid,
      },
    });

  if (
    travelBooking &&
    travelBooking.cardno ===
      coordinator.cardno
  ) {

    isCoordinator = true;

    break;
  }
}

if (!isCoordinator) {

  throw new ApiError(
    403,
    'You are not assigned as coordinator'
  );
}

// GENERATE OTP

  const otp =
    Math.floor(
      100000 + Math.random() * 900000
    );

  // SAVE OTP

  await CoordinatorOtp.create({

    mobno,

    otp: String(otp),

    expires_at:
      new Date(
        Date.now() + 5 * 60 * 1000
      ),
  });

  // SEND WHATSAPP

  await sendCoordinatorOtp(
    mobno,
    otp
  );

  return res.status(200).json({

    message:
      'OTP sent successfully',
  });
}

export async function verifyOtp(
  req,
  res
) {
    console.log('verify otp hit');

  const {
    mobno,
    otp,
  } = req.body;

  const record =
    await CoordinatorOtp.findOne({

      where: {
        mobno,
        otp,
        verified: false,
      },

      order: [
        ['createdAt', 'DESC'],
      ],
    });

  if (!record) {

    throw new ApiError(
      400,
      'Invalid OTP'
    );
  }

  // CHECK EXPIRY

  if (
    new Date() >
    new Date(record.expires_at)
  ) {

    throw new ApiError(
      400,
      'OTP expired'
    );
  }

  // MARK VERIFIED

  await record.update({
    verified: true,
  });

  // FETCH USER

  const user =
    await CardDb.findOne({
      where: { mobno },
    });

  // GENERATE JWT

  const token = jwt.sign(

    {
      cardno: user.cardno,
      mobno: user.mobno,
    },

    process.env.JWT_SECRET,

    {
      expiresIn: '7d',
    }
  );

return res.status(200).json({

  message:
    'Login successful',

  token,

  user: {
    cardno: user.cardno,
    mobno: user.mobno,
    issuedto: user.issuedto,
    center: user.center,
  },
});
}

export async function
fetchCoordinatorDashboard(
  req,
  res
) {

  const authHeader =
    req.headers.authorization;

  if (!authHeader) {

    throw new ApiError(
      401,
      'Token missing'
    );
  }

  const token =
    authHeader.split(' ')[1];

  if (!token) {

    throw new ApiError(
      401,
      'Invalid token'
    );
  }

  let decoded;

  try {

    decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

  } catch {

    throw new ApiError(
      401,
      'Invalid token'
    );
  }

  // FETCH USER

  const user =
    await CardDb.findOne({

      where: {
        cardno:
          decoded.cardno,
      },
    });

  if (!user) {

    throw new ApiError(
      404,
      'Coordinator not found'
    );
  }

  // FETCH BUS

    // FETCH TRAVEL BOOKING

let bus = null;

const assignedBuses =
  await TravelBusGroup.findAll({

    where: {

      coordinator_bookingid: {
        [Sequelize.Op.ne]:
          null,
      },

      event_date: {
        [Sequelize.Op.gte]:
          new Date(),
      },
    },
  });

for (const item of assignedBuses) {

  const travelBooking =
    await TravelDb.findOne({

      where: {
        bookingid:
          item.coordinator_bookingid,
      },
    });

  if (
    travelBooking &&
    travelBooking.cardno ===
      user.cardno
  ) {

    bus = item;

    break;
  }
}

if (!bus) {

  throw new ApiError(
    404,
    'No assigned bus found'
  );
}
  // FETCH PASSENGERS

const busPassengers =
  await TravelBusPassengers.findAll({

    where: {
      bus_group_id:
        bus.id,
    },
  });

const passengers = [];

for (const item of busPassengers) {

  const booking =
    await TravelDb.findOne({

      where: {
        bookingid:
          item.bookingid,
      },
    });

  if (booking) {

    const cardUser =
  await CardDb.findOne({

    where: {
      cardno:
        booking.cardno,
    },
  });

passengers.push({

  name:
    cardUser?.issuedto || '',

  mobno:
    cardUser?.mobno || '',

  cardno:
    booking.cardno,

  pickup_point:
    booking.pickup_point,

  drop_point:
    booking.drop_point,

  total_people:
    booking.total_people,
});
  }
}

return res.status(200).json({

  coordinator: {

    name:
      user.issuedto,

    mobno:
      user.mobno,

    cardno:
      user.cardno,

    center:
      user.center,
  },

  bus,

  passengers,

  totalPassengers:
    passengers.length,

  remainingSeats:
    bus.capacity -
    passengers.length,
});
}