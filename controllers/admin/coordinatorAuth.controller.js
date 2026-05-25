
import jwt from 'jsonwebtoken';

import TravelBusGroup
  from '../../models/travelBusGroup.model.js';

import TravelBusPassengers
  from '../../models/travelBusPassengers.model.js';

import TravelDb
  from '../../models/travel_db.model.js';

import TravelBusStops
  from '../../models/travelBusStops.model.js'

import CoordinatorOtp from '../../models/coordinatorOtp.model.js';
import CardDb from '../../models/card.model.js';
import { sendCoordinatorOtp } from '../../helpers/sendCoordinatorOtp.js';
import ApiError from '../../utils/ApiError.js';
import Sequelize from 'sequelize';
import crypto from 'crypto';

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


  const coordinatorBookingIds =
    assignedBuses.map(
      item =>
        item.coordinator_bookingid
    );

  const matchingBookings =
    await TravelDb.findAll({

      where: {

        bookingid: {

          [Sequelize.Op.in]:
            coordinatorBookingIds,
        },

        cardno:
          coordinator.cardno,
      },
    });

  const isCoordinator =
    matchingBookings.length > 0;

  if (!isCoordinator) {

    throw new ApiError(
      403,
      'You are not assigned as coordinator'
    );
  }

  const recentOtpCount =
    await CoordinatorOtp.count({

      where: {

        mobno,

        createdAt: {

          [Sequelize.Op.gte]:
            new Date(
              Date.now() -
              10 * 60 * 1000
            ),
        },
      },
    });

  if (recentOtpCount >= 5) {

    throw new ApiError(
      429,
      'Too many OTP requests. Try again later.'
    );
  }
  // GENERATE OTP

  const otp =
    crypto.randomInt(
      100000,
      1000000
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

    const latestOtp =
      await CoordinatorOtp.findOne({

        where: {
          mobno,
          verified: false,
        },

        order: [
          ['createdAt', 'DESC'],
        ],
      });

    if (latestOtp) {

      await latestOtp.increment(
        'attempts'
      );

      // BLOCK AFTER 5 ATTEMPTS

      if (
        latestOtp.attempts + 1 >= 5
      ) {

        await latestOtp.update({
          verified: true,
        });

        throw new ApiError(
          429,
          'Too many invalid attempts. OTP blocked.'
        );
      }
    }

    throw new ApiError(
      400,
      'Invalid OTP'
    );
  }
  // CHECK MAX ATTEMPTS

  if (record.attempts >= 5) {

    throw new ApiError(
      429,
      'Too many invalid attempts'
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
    attempts: 0,
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

    process.env.SECRET,

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
      process.env.SECRET
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

  const coordinatorBookingIds =
    assignedBuses.map(
      item =>
        item.coordinator_bookingid
    );

  const matchingBookings =
    await TravelDb.findAll({

      where: {

        bookingid: {

          [Sequelize.Op.in]:
            coordinatorBookingIds,
        },

        cardno:
          user.cardno,
      },
    });

  const matchingBookingIds =
    matchingBookings.map(
      item => item.bookingid
    );

  const assignedBusData =
    assignedBuses.filter(
      item =>

        matchingBookingIds.includes(
          item.coordinator_bookingid
        )
    );
  if (
    !assignedBusData.length
  ) {

    throw new ApiError(
      404,
      'No assigned bus found'
    );
  }
  // FETCH PASSENGERS

  const dashboardBuses = [];

  for (const bus of assignedBusData) {


    const busStops =
      await TravelBusStops.findAll({

        where: {
          bus_group_id:
            bus.id,
        },

        order: [
          ['stop_order', 'ASC']
        ],
      });

    const busPassengers =
      await TravelBusPassengers.findAll({

        where: {
          bus_group_id:
            bus.id,
        },
      });

    const bookingIds =
      busPassengers.map(
        item => item.bookingid
      );

    const bookings =
      await TravelDb.findAll({

        where: {

          bookingid: {

            [Sequelize.Op.in]:
              bookingIds,
          },
        },

        include: [
          {
            model: CardDb,

            attributes: [
              'issuedto',
              'mobno',
            ],
          },
        ],
      });

    const passengers =
      bookings.map(
        booking => {

          const passengerData =
            busPassengers.find(
              item =>

                item.bookingid ===
                booking.bookingid
            );

          const pickupStop =
            busStops.find(
              stop =>

                stop.stop_name ===
                booking.pickup_point
            );

          return {

            passenger_id:
              passengerData?.id,

            boarded:
              passengerData?.boarded,

            boarded_at:
              passengerData?.boarded_at,

            name:
              booking.CardDb
                ?.issuedto || '',

            mobno:
              booking.CardDb
                ?.mobno || '',

            cardno:
              booking.cardno,

            pickup_point:
              booking.pickup_point,

            pickup_timing:
              pickupStop?.timing || '',

            drop_point:
              booking.drop_point,

            comments:
              booking.comments || '',

            luggage:
              booking.luggage || '',
          };
        }
      );
    dashboardBuses.push({

      bus: {

        ...bus.toJSON(),

        stops:
          busStops,

        remaining_seats:
          bus.capacity -
          passengers.length,
      },

      passengers,

      totalPassengers:
        passengers.length,
    });
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

    buses:
      dashboardBuses,
  });
}

export async function
  updateBoardingStatus(
    req,
    res
  ) {

  const {
    passenger_id,
    boarded,
  } = req.body;

  const passenger =
    await TravelBusPassengers.findOne({

      where: {
        id: passenger_id,
      },
    });

  if (!passenger) {

    throw new ApiError(
      404,
      'Passenger not found'
    );
  }

  await passenger.update({

    boarded,

    boarded_at:
      boarded
        ? new Date()
        : null,
  });

  return res.status(200).json({

    message:
      boarded
        ? 'Passenger marked boarded'
        : 'Passenger unboarded',
    passenger,
  });
}