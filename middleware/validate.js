import { CardDb, UtsavBooking, UtsavDb } from '../models/associations.js';
import {
  ERR_CARD_NOT_FOUND,
  ERR_CARD_NOT_PROVIDED,
  STATUS_CANCELLED,
  STATUS_ADMIN_CANCELLED,
  TYPE_UTSAV,
  TYPE_ROOM,
  TYPE_FOOD,
  TYPE_TRAVEL
} from '../config/constants.js';
import { getBlockedDates } from '../controllers/helper.js';
import { Sequelize } from 'sequelize';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/CatchAsync.js';
import moment from 'moment';

export const validateCard = catchAsync(async (req, res, next) => {
  const cardno = req.params.cardno || req.body.cardno || req.query.cardno;
  if (cardno === undefined) throw new ApiError(404, ERR_CARD_NOT_PROVIDED);
  const cardData = await CardDb.findOne({
    where: { cardno: cardno }
  });
  if (!cardData) throw new ApiError(404, ERR_CARD_NOT_FOUND);
  req.user = cardData;
  next();
});

export const CheckDatesBlocked = catchAsync(async (req, res, next) => {
  // Validate required fields
  if (!req.body.primary_booking) {
    throw new ApiError(400, 'Primary booking is required');
  }

  // Helper function to extract card numbers from a specific booking
  const extractCardNumbersFromBooking = (booking, rootCardno) => {
    const cardNumbers = new Set();
    const details = booking.details || {};

    // For self bookings (no guests/mumukshus specified), use root cardno
    const hasSpecificUsers =
      details.guests?.length > 0 ||
      details.guestGroup?.length > 0 ||
      details.mumukshus?.length > 0 ||
      details.mumukshuGroup?.length > 0;

    if (!hasSpecificUsers && rootCardno) {
      cardNumbers.add(rootCardno);
      return Array.from(cardNumbers);
    }

    // Direct guests array
    if (Array.isArray(details.guests)) {
      details.guests.forEach((guest) => {
        // Handle both string cardno and object with cardno property
        const cardno = typeof guest === 'string' ? guest : guest.cardno;
        if (cardno) cardNumbers.add(cardno);
      });
    }

    // Guest groups
    if (Array.isArray(details.guestGroup)) {
      details.guestGroup.forEach((group) => {
        if (Array.isArray(group.guests)) {
          group.guests.forEach((cardno) => {
            if (cardno) cardNumbers.add(cardno);
          });
        }
      });
    }

    // Direct mumukshus array
    if (Array.isArray(details.mumukshus)) {
      details.mumukshus.forEach((mumukshu) => {
        // Handle both string cardno and object with cardno property
        const cardno =
          typeof mumukshu === 'string' ? mumukshu : mumukshu.cardno;
        if (cardno) cardNumbers.add(cardno);
      });
    }

    // Mumukshu groups
    if (Array.isArray(details.mumukshuGroup)) {
      details.mumukshuGroup.forEach((group) => {
        if (Array.isArray(group.mumukshus)) {
          group.mumukshus.forEach((cardno) => {
            if (cardno) cardNumbers.add(cardno);
          });
        }
      });
    }

    return Array.from(cardNumbers);
  };

  // Helper function to check if dates have any overlap with blocked dates
  const hasAnyOverlap = (
    checkInDate,
    checkOutDate,
    blockedStartDate,
    blockedEndDate
  ) => {
    const checkIn = moment(checkInDate);
    const checkOut = moment(checkOutDate);
    const blockedStart = moment(blockedStartDate);
    const blockedEnd = moment(blockedEndDate);

    // Any overlap occurs when the periods intersect
    return (
      checkIn.isSameOrBefore(blockedEnd, 'day') &&
      checkOut.isSameOrAfter(blockedStart, 'day')
    );
  };

  // Helper function to check if dates have boundary overlap only
  const hasBoundaryOverlapOnly = (
    checkInDate,
    checkOutDate,
    blockedStartDate,
    blockedEndDate
  ) => {
    const checkIn = moment(checkInDate);
    const checkOut = moment(checkOutDate);
    const blockedStart = moment(blockedStartDate);
    const blockedEnd = moment(blockedEndDate);

    // Boundary overlap means either:
    // 1. Check-out equals blocked start (touching at the start boundary)
    // 2. Check-in equals blocked end (touching at the end boundary)
    // But NOT extending into the blocked period

    const touchesStartBoundary =
      checkOut.isSame(blockedStart, 'day') &&
      !checkIn.isAfter(blockedStart, 'day');
    const touchesEndBoundary =
      checkIn.isSame(blockedEnd, 'day') &&
      !checkOut.isBefore(blockedEnd, 'day');

    return touchesStartBoundary || touchesEndBoundary;
  };

  const checkUsersForUtsavBooking = async (
    cardNumbers,
    requestBody,
    dateRange
  ) => {
    const utsavStatus = {};

    // Extract all users who have Utsav in current request
    const currentRequestUtsavUsers = new Set();

    // Check primary booking
    if (requestBody.primary_booking?.booking_type === TYPE_UTSAV) {
      // Extract users from primary Utsav booking
      const primaryUtsavUsers = extractCardNumbersFromBooking(
        requestBody.primary_booking,
        requestBody.cardno
      );
      primaryUtsavUsers.forEach((cardno) =>
        currentRequestUtsavUsers.add(cardno)
      );
    }

    // Check addons for Utsav bookings
    if (Array.isArray(requestBody.addons)) {
      requestBody.addons.forEach((addon) => {
        if (addon.booking_type === TYPE_UTSAV) {
          // Extract card numbers from this Utsav addon
          const utsavAddonUsers = extractCardNumbersFromBooking(
            addon,
            requestBody.cardno
          );
          utsavAddonUsers.forEach((cardno) =>
            currentRequestUtsavUsers.add(cardno)
          );
        }
      });
    }

    // Now check each user from the specific booking
    for (const cardno of cardNumbers) {
      // User has Utsav if:
      // 1. Current request includes Utsav booking for them
      // 2. They have existing Utsav booking that overlaps with the date range
      if (currentRequestUtsavUsers.has(cardno)) {
        utsavStatus[cardno] = true;
      } else if (dateRange) {
        // Check if they have an overlapping Utsav booking in the database
        utsavStatus[cardno] = await hasOverlappingUtsavBooking(
          cardno,
          dateRange.start,
          dateRange.end
        );
      } else {
        // If no date range provided, check if they have ANY Utsav booking
        utsavStatus[cardno] = await hasAnyUtsavBooking(cardno);
      }
    }

    return utsavStatus;
  };

  const formatBlockingInfo = (blockedDates) => {
    return blockedDates
      .map(
        (block) =>
          `${moment(block.checkin).format('Do MMMM')} to ${moment(
            block.checkout
          ).format('Do MMMM, YYYY')} for ${block.comments}`
      )
      .join(', ');
  };

  // Helper function to extract date ranges from bookings
  const extractDateRanges = (bookings) => {
    const dateRanges = [];

    bookings.forEach((booking) => {
      const { booking_type, details } = booking;

      switch (booking_type) {
        case TYPE_ROOM:
          if (details.checkin_date && details.checkout_date) {
            dateRanges.push({
              type: 'room',
              start: details.checkin_date,
              end: details.checkout_date,
              booking
            });
          }
          break;

        case TYPE_FOOD:
          if (details.start_date && details.end_date) {
            dateRanges.push({
              type: 'food',
              start: details.start_date,
              end: details.end_date,
              booking
            });
          }
          break;

        case TYPE_TRAVEL:
          if (details.date) {
            dateRanges.push({
              type: 'travel',
              start: details.date,
              end: details.date,
              booking
            });
          }
          break;
      }
    });

    return dateRanges;
  };

  // Collect all bookings
  const allBookings = [req.body.primary_booking];
  if (Array.isArray(req.body.addons)) {
    allBookings.push(...req.body.addons);
  }

  const isUtsavPrimaryBooking =
    req.body.primary_booking.booking_type === TYPE_UTSAV;

  if (isUtsavPrimaryBooking) {
    // Rule 1: If primary booking is Utsav
    // Check addons with date ranges (room, food, travel)
    const addonDateRanges = extractDateRanges(req.body.addons || []);

    for (const dateRange of addonDateRanges) {
      // Extract card numbers ONLY from this specific addon
      const addonCardNumbers = extractCardNumbersFromBooking(
        dateRange.booking,
        req.body.cardno
      );

      const blockedDates = await getBlockedDates(
        dateRange.start,
        dateRange.end
      );

      if (blockedDates.length > 0) {
        // Check if dates exceed boundary
        for (const block of blockedDates) {
          const hasOverlap = hasAnyOverlap(
            dateRange.start,
            dateRange.end,
            block.checkin,
            block.checkout
          );

          if (hasOverlap) {
            const isBoundaryOnly = hasBoundaryOverlapOnly(
              dateRange.start,
              dateRange.end,
              block.checkin,
              block.checkout
            );

            if (!isBoundaryOnly) {
              const blockingInfo = formatBlockingInfo(blockedDates);
              const userList =
                addonCardNumbers.length > 0
                  ? ` for users: ${addonCardNumbers.join(', ')}`
                  : '';
              throw new ApiError(
                400,
                `Dates exceed the boundary of blocked periods: ${blockingInfo}${userList}. Only boundary overlaps are allowed.`
              );
            }
          }
        }
      }
    }
  } else {
    // Rule 2: If primary booking is NOT Utsav
    // Check only room and travel dates
    const relevantDateRanges = extractDateRanges(allBookings).filter(
      (dr) => dr.type === 'room' || dr.type === 'travel'
    );

    for (const dateRange of relevantDateRanges) {
      // Extract card numbers ONLY from this specific booking
      const bookingCardNumbers = extractCardNumbersFromBooking(
        dateRange.booking,
        req.body.cardno
      );

      // Check Utsav booking status for these specific users and date range
      const utsavStatus = await checkUsersForUtsavBooking(
        bookingCardNumbers,
        req.body,
        dateRange
      );

      const blockedDates = await getBlockedDates(
        dateRange.start,
        dateRange.end
      );

      if (blockedDates.length > 0) {
        // Check if any of the booking participants hasn't booked Utsav for this date range
        const usersWithoutUtsav = bookingCardNumbers.filter(
          (cardno) => !utsavStatus[cardno]
        );
        const usersWithUtsav = bookingCardNumbers.filter(
          (cardno) => utsavStatus[cardno]
        );

        // If ANY participant doesn't have Utsav booking for this period, check for ANY overlap
        if (usersWithoutUtsav.length > 0) {
          for (const block of blockedDates) {
            const hasOverlap = hasAnyOverlap(
              dateRange.start,
              dateRange.end,
              block.checkin,
              block.checkout
            );

            if (hasOverlap) {
              const blockingInfo = formatBlockingInfo(blockedDates);
              throw new ApiError(
                400,
                `Booking not allowed during blocked periods: ${blockingInfo}. Users without Utsav booking (${usersWithoutUtsav.join(
                  ', '
                )}) cannot book on these dates.`
              );
            }
          }
        }

        // For participants with Utsav booking for this period, only boundary overlaps are allowed
        if (usersWithUtsav.length > 0 && usersWithoutUtsav.length === 0) {
          for (const block of blockedDates) {
            const hasOverlap = hasAnyOverlap(
              dateRange.start,
              dateRange.end,
              block.checkin,
              block.checkout
            );

            if (hasOverlap) {
              const isBoundaryOnly = hasBoundaryOverlapOnly(
                dateRange.start,
                dateRange.end,
                block.checkin,
                block.checkout
              );

              if (!isBoundaryOnly) {
                const blockingInfo = formatBlockingInfo(blockedDates);
                throw new ApiError(
                  400,
                  `Dates exceed the boundary of blocked periods: ${blockingInfo}. Users with Utsav booking can only book on boundary dates.`
                );
              }
            }
          }
        }
      }
    }
  }

  next();
});

async function hasAnyUtsavBooking(cardno) {
  const utsavBookings = await UtsavBooking.findAll({
    where: {
      cardno,
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    }
  });

  return utsavBookings.length > 0;
}

async function hasOverlappingUtsavBooking(cardno, checkin_date, checkout_date) {
  const utsavBookings = await UtsavBooking.findAll({
    where: {
      cardno,
      status: {
        [Sequelize.Op.notIn]: [STATUS_CANCELLED, STATUS_ADMIN_CANCELLED]
      }
    },
    include: [
      {
        model: UtsavDb,
        where: {
          [Sequelize.Op.or]: [
            {
              [Sequelize.Op.and]: [
                { start_date: { [Sequelize.Op.lte]: checkout_date } },
                { end_date: { [Sequelize.Op.gte]: checkin_date } }
              ]
            }
          ]
        }
      }
    ]
  });

  return utsavBookings.length > 0;
}
