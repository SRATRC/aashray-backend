import { CardDb, GuestRelationship, FlatBooking, RoomBooking, FoodDb, GateRecord, MaintenanceDb, ShibirBookingDb, TravelDb, UtsavBooking, PermanentWifiCodes, ShibirDb, UtsavDb } from '../../models/associations.js';
import {
  ERR_CARD_NOT_FOUND,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_ACTIVE,
  STATUS_ADMIN_CANCELLED,
  STATUS_CANCELLED,
  STATUS_GUEST,
  STATUS_OFFPREM,
  STATUS_OPEN,
  STATUS_SEATSFULL_CANCELLED,
  STATUS_WRONGFORM_CANCELLED
} from '../../config/constants.js';
import Sequelize from 'sequelize';
import bcrypt from 'bcryptjs';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import { Op } from 'sequelize';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import moment from 'moment-timezone';



export const createCard = async (req, res) => {
  const {
    cardno,
    issuedto,
    gender,
    dob,
    mobno,
    email,
    idType,
    idNo,
    address,
    country,
    state,
    city,
    pin,
    centre,
    res_status,
    referenceCardno,  // parent card for guest
    guestType         // guest type: Driver, VIP, Friend, Family
  } = req.body;

  req.log.info('create_card_start', { cardno, issuedto, res_status });

  // --- Check if cardno already exists ---
  const existingCard = await CardDb.findOne({ where: { cardno } });
  if (existingCard) {
    req.log.warn('create_card_already_exists', { cardno });
    return res.status(400).json({ message: `Card number ${cardno} already exists` });
  }

  // --- Start a transaction ---
  const t = await CardDb.sequelize.transaction();

  try {
    // --- Create the main card ---
    const newCard = await CardDb.create({
      cardno,
      issuedto,
      gender,
      dob,
      mobno,
      email,
      idType,
      idNo,
      address,
      country,
      state,
      city,
      pin,
      center: centre,
      status: STATUS_OFFPREM,
      res_status,
      updatedBy: req.user.username
    }, { transaction: t });

    if (!newCard) throw new ApiError(500, 'Failed to create card');

    // --- If this is a guest card, validate and insert relationship ---
    if (res_status === 'GUEST') {
      if (!referenceCardno || !guestType) {
        throw new ApiError(400, 'Missing referenceCardno or guestType for GUEST');
      }

      // Check that parent card exists
      const parentCard = await CardDb.findOne({ where: { cardno: referenceCardno } });
      if (!parentCard) {
        throw new ApiError(400, `Reference card ${referenceCardno} does not exist`);
      }

      await GuestRelationship.create({
        cardno: referenceCardno,
        guest: cardno,
        type: guestType,
        updatedBy: req.user.username
      }, { transaction: t });
    }

    // --- Commit everything ---
    await t.commit();

    req.log.info('create_card_success', { cardno, issuedto, res_status });

    // --- Send WhatsApp notification if mobno is present ---
    const phone = newCard.mobno;
    if (phone) {
      try {
        const formattedPhone = formatWhatsAppPhone(phone, newCard.country);

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: newCard.issuedto || 'Mumukshu' },
              { type: 'text', text: newCard.cardno }
            ]
          }
        ];

        await sendWhatsAppMessage(formattedPhone, 'card_account_created', components);
      } catch (waErr) {
        console.error('Error sending WhatsApp message in createCard:', waErr.message || waErr);
      }
    }

    // A created record still holds the starter password hash; never send it.
    const { password, token, ...cardData } = newCard.get({ plain: true });

    return res.status(200).json({
      message: 'Card created successfully',
      data: cardData
    });

  } catch (error) {
    // --- Rollback on any error ---
    await t.rollback();

    req.log.error('create_card_error', { cardno, error: error.message });
    const message = error.name === 'SequelizeUniqueConstraintError'
      ? 'Card number must be unique'
      : error.message || 'Internal server error';

    return res.status(400).json({ message });
  }
};

export const fetchAllCards = async (req, res) => {
  req.log.info('fetch_all_cards_start');
  // The push address stays in the backend; staff screens never use it.
  const data = await CardDb.findAll({
    attributes: { exclude: ['token'] }
  });

  req.log.info('fetch_all_cards_success', { count: data.length });
  return res.status(200).send({ message: 'Fetched all cards', data: data });
};


export const searchCardsByName = async (req, res) => {
  try {
    const term = req.params.name;
    req.log.info('search_cards_by_name_start', { term });

    const data = await CardDb.findAll({
      where: {
        [Sequelize.Op.or]: [
          { issuedto: { [Sequelize.Op.like]: `%${term}%` } },
          { mobno: { [Sequelize.Op.like]: `%${term}%` } },
          { cardno: { [Sequelize.Op.like]: `%${term}%` } } // ✅ added this
        ]
      },
      attributes: { exclude: ['token'] }
    });

    // Staff edit a guest card with its current host filled in, so each guest
    // card also gets its host's card number, name and guest type.
    const guestCardnos = data
      .filter((card) => card.res_status === STATUS_GUEST)
      .map((card) => card.cardno);
    if (guestCardnos.length > 0) {
      const links = await GuestRelationship.findAll({
        where: { guest: guestCardnos },
        attributes: ['cardno', 'guest', 'type'],
        order: [['updatedAt', 'DESC']]
      });
      const hostCardnos = [...new Set(links.map((link) => link.cardno))];
      const hosts = hostCardnos.length
        ? await CardDb.findAll({
            where: { cardno: hostCardnos },
            attributes: ['cardno', 'issuedto']
          })
        : [];
      const hostNames = new Map(hosts.map((host) => [host.cardno, host.issuedto]));

      // A guest has one host. If older data left more than one, the newest wins.
      const linkOfGuest = new Map();
      for (const link of links) {
        if (!linkOfGuest.has(link.guest)) linkOfGuest.set(link.guest, link);
      }

      for (const card of data) {
        const link = linkOfGuest.get(card.cardno);
        if (!link) continue;
        card.setDataValue('referenceCardno', link.cardno);
        card.setDataValue('referenceName', hostNames.get(link.cardno) || null);
        card.setDataValue('guestType', link.type);
      }
    }

    req.log.info('search_cards_by_name_success', { term, count: data.length });
    return res.status(200).send({ message: 'Fetched all cards', data });
  } catch (err) {
    req.log.error('search_cards_by_name_error', { term: req.params.name, error: err.message });
    return res.status(500).send({ message: 'Internal server error' });
  }
};


export const updateCard = async (req, res) => {
  const {
    cardno,
    issuedto,
    gender,
    dob,
    mobno,
    email,
    idType,
    idNo,
    address,
    country,
    city,
    state,
    pin,
    center: centre,
    status,
    res_status,
    referenceCardno,
    guestType
  } = req.body;

  req.log.info('update_card_start', { cardno, res_status, status });

  const card = await CardDb.findOne({ where: { cardno } });

  if (!card) {
    req.log.warn('update_card_not_found', { cardno });
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  // Read before the update below overwrites it.
  const wasGuest = card.res_status === STATUS_GUEST;

  // A blank host keeps the guest's links as they are. Many older guest cards
  // have no host on record, and staff must still be able to fix their details.
  const hostCardno = String(referenceCardno ?? '').trim();
  const hostGuestType = String(guestType ?? '').trim();

  // Validation for guest. Checked before the card is saved, so a bad host card
  // cannot leave the card half-updated.
  if (res_status === STATUS_GUEST) {
    if (!hostCardno) {
      if (!wasGuest) {
        throw new ApiError(400, 'Enter the host card number to make this card a guest');
      }
      if (hostGuestType) {
        throw new ApiError(400, 'Enter the host card number to set a guest type');
      }
    } else {
      if (!hostGuestType) {
        throw new ApiError(400, 'Choose a guest type for the host card');
      }
      if (hostCardno === String(cardno)) {
        throw new ApiError(400, 'A guest cannot be their own reference card');
      }
      const hostCard = await CardDb.findOne({ where: { cardno: hostCardno } });
      if (!hostCard) {
        throw new ApiError(400, `Reference card ${hostCardno} does not exist`);
      }
    }
  }

  // --- Compare to find changed fields ---
  const isChanged = (newVal, oldVal) => {
    if (newVal === undefined) return false;
    const normalize = (v) => (v === null || v === undefined ? '' : String(v).trim());
    return normalize(newVal) !== normalize(oldVal);
  };

  const changed = [];
  if (isChanged(issuedto, card.issuedto)) changed.push('Name');
  if (isChanged(gender, card.gender)) changed.push('Gender');
  if (isChanged(dob, card.dob)) changed.push('Date of Birth');
  if (isChanged(mobno, card.mobno)) changed.push('Mobile Number');
  if (isChanged(idType, card.idType)) changed.push('ID Type');
  if (isChanged(idNo, card.idNo)) changed.push('ID Number');
  if (isChanged(email, card.email)) changed.push('Email');
  if (isChanged(address, card.address)) changed.push('Address');
  if (isChanged(country, card.country)) changed.push('Country');
  if (isChanged(city, card.city)) changed.push('City');
  if (isChanged(state, card.state)) changed.push('State');
  if (isChanged(pin, card.pin)) changed.push('Pin');
  if (isChanged(centre, card.center)) changed.push('Center');
  if (isChanged(status, card.status)) changed.push('Status');
  if (isChanged(res_status, card.res_status)) changed.push('Resident Status');

  await card.update({
    issuedto,
    gender,
    dob,
    mobno,
    email,
    idType,
    idNo,
    address,
    country,
    city,
    state,
    pin,
    center: centre,
    status,
    res_status,
    updatedBy: req.user.username
  });

  // A guest link stores the host in `cardno` and the guest in `guest`.
  if (res_status === STATUS_GUEST) {
    if (hostCardno) {
      // A guest has one host, so naming a different host moves the guest. The
      // named host's link is saved first and the other links go after it, so
      // a failed save never leaves the guest with no host.
      const [relation, created] = await GuestRelationship.findOrCreate({
        where: { cardno: hostCardno, guest: cardno },
        defaults: {
          cardno: hostCardno,
          guest: cardno,
          type: hostGuestType,
          updatedBy: req.user.username
        }
      });

      if (!created) {
        await relation.update({
          type: hostGuestType,
          updatedBy: req.user.username
        });
      }

      await GuestRelationship.destroy({
        where: {
          guest: cardno,
          cardno: { [Sequelize.Op.ne]: hostCardno }
        }
      });
    }
  } else if (wasGuest && card.res_status !== STATUS_GUEST) {
    // The card stopped being a guest card: drop the links where it is the
    // guest. Links where it is the host belong to its own guests and stay.
    // Checked on the saved card, not the request: a save that leaves out the
    // member type keeps the card a guest.
    await GuestRelationship.destroy({ where: { guest: cardno } });
  }

  req.log.info('update_card_success', { cardno, res_status });

  // --- Send WhatsApp notification if any details were changed ---
  if (changed.length > 0) {
    const targetPhone = mobno || card.mobno;
    if (targetPhone) {
      try {
        const formattedPhone = formatWhatsAppPhone(targetPhone, country || card.country);

        const formattedTime = moment().tz('Asia/Kolkata').format('DD-MM-YYYY hh:mm A');

        const components = [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: issuedto || card.issuedto || 'Mumukshu' },
              { type: 'text', text: card.cardno },
              { type: 'text', text: formattedTime },
              { type: 'text', text: changed.join(', ') },
              { type: 'text', text: issuedto || card.issuedto || 'Mumukshu' }
            ]
          }
        ];

        await sendWhatsAppMessage(formattedPhone, 'profile_updated', components);
      } catch (waErr) {
        console.error('Error sending WhatsApp profile_updated message in updateCard:', waErr.message || waErr);
      }
    }
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const transferCard = async (req, res) => {
  const { cardno, new_cardno } = req.body;
  req.log.info('transfer_card_start', { cardno, new_cardno });

  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card) {
    req.log.warn('transfer_card_not_found', { cardno });
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  await card.update(
    {
      cardno: new_cardno,
      updatedBy: req.user.username
    }
  );

  req.log.info('transfer_card_success', { oldCardno: cardno, newCardno: new_cardno });
  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

// TODO: FIX this
export const fetchTotalTransactions = async (req, res) => {
  const cardno = req.params.cardno;
  req.log.info('fetch_total_transactions_start', { cardno });

  const [results, _] = await database.query(
    `SELECT 
      category,
      total_expense,
      total_refund,
      total_expense - total_refund AS net_amount
    FROM (
      SELECT 
          category,
          SUM(CASE WHEN status='pending' THEN amount ELSE 0 END) AS total_expense,
          SUM(CASE WHEN status='credited' THEN amount ELSE 0 END) AS total_refund
      FROM 
          transactions 
      WHERE 
          cardno = ${cardno}
      GROUP BY 
          category) as t;`);

  req.log.info('fetch_total_transactions_success', { cardno });
  return res
    .status(200)
    .send({ message: 'fetched all user transactions', data: results });
};



export const resetPasswordDefault = async (req, res) => {
  const { cardno } = req.body;
  req.log.info('reset_password_default_start', { cardno });

  if (!cardno) {
    req.log.warn('reset_password_default_missing_cardno');
    throw new ApiError(400, 'cardno is required');
  }

  const card = await CardDb.findOne({ where: { cardno } });

  if (!card) {
    req.log.warn('reset_password_default_card_not_found', { cardno });
    throw new ApiError(404, 'Card not found');
  }

  // ✅ Use the same default value defined in the model
  const defaultPasswordHash = CardDb.rawAttributes.password.defaultValue;

  await CardDb.update(
    { password: defaultPasswordHash },
    { where: { cardno } }
  );

  req.log.info('reset_password_default_success', { cardno });

  const phone = card.mobno;
  if (phone) {
    try {
      const formattedPhone = formatWhatsAppPhone(phone, card.country);

      const components = [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: card.issuedto || 'Mumukshu'
            }
          ]
        }
      ];

      await sendWhatsAppMessage(formattedPhone, 'password_reset_admin', components);
    } catch (err) {
      console.error('Error sending WhatsApp message in resetPasswordDefault:', err.message || err);
    }
  }

  return res
    .status(200)
    .json({ message: 'Password reset successfully to default.' });
};


export const getCardByMobile = async (req, res) => {
  const { mobno } = req.params;
  req.log.info('get_card_by_mobile_start', { mobno });

  if (!mobno) {
    req.log.warn('get_card_by_mobile_missing_param');
    return res.status(400).json({ message: 'mobno is required' });
  }

  const card = await CardDb.findOne({
    attributes: ['cardno', 'issuedto', 'center', 'mobno', 'res_status', 'gender'],
    where: { mobno }
  });

  if (!card) {
    req.log.warn('get_card_by_mobile_not_found', { mobno });
    return res.status(404).json({ message: 'Card not found' });
  }

  req.log.info('get_card_by_mobile_success', { mobno, cardno: card.cardno });
  return res.status(200).json({ message: 'Found card', data: card });
};


export const getPersonActivity = async (req, res) => {
  const { cardno } = req.query;
  if (!cardno || typeof cardno !== 'string') {
    throw new ApiError(400, 'cardno is required');
  }
  req.log.info('person_activity_start', { cardno });

  const card = await CardDb.findOne({
    where: { cardno },
    attributes: ['cardno', 'issuedto', 'res_status']
  });
  if (!card) throw new ApiError(404, ERR_CARD_NOT_FOUND);

  // Dates are calendar days at the Research Centre (IST), as elsewhere in admin.
  const today = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
  const past30 = moment().tz('Asia/Kolkata').subtract(30, 'days').format('YYYY-MM-DD');

  const [flats, rooms, food, gate, maintenanceOpen, shibirBookings, travel, utsavBookings, wifiCodes] =
    await Promise.all([
      // A stay is in the window when it ends on or after the window start
      // (checkout is never before checkin).
      FlatBooking.findAll({ where: { cardno, checkout: { [Op.gte]: past30 } }, raw: true }),
      RoomBooking.findAll({ where: { cardno, checkout: { [Op.gte]: past30 } }, raw: true }),
      // A cancelled meal day keeps its row with every meal off: leave those out.
      FoodDb.findAll({
        where: {
          cardno,
          date: { [Op.gte]: past30 },
          [Op.or]: [{ breakfast: true }, { lunch: true }, { dinner: true }]
        },
        raw: true
      }),
      // Gate times are timestamps: the window starts at IST midnight, not UTC midnight.
      GateRecord.findAll({
        where: { cardno, createdAt: { [Op.gte]: moment.tz(past30, 'Asia/Kolkata').toDate() } },
        raw: true
      }),
      MaintenanceDb.findAll({ where: { requested_by: cardno, status: STATUS_OPEN }, raw: true }),
      ShibirBookingDb.findAll({
        where: { cardno },
        include: [
          {
            model: ShibirDb,
            attributes: ['start_date', 'end_date', 'name'],
            required: true,
            where: { end_date: { [Op.gte]: past30 } }
          }
        ],
        raw: true,
        nest: true
      }),
      TravelDb.findAll({ where: { cardno, date: { [Op.gte]: past30 } }, raw: true }),
      UtsavBooking.findAll({
        where: { cardno },
        include: [
          {
            model: UtsavDb,
            attributes: ['start_date', 'end_date', 'name'],
            required: true,
            where: { end_date: { [Op.gte]: past30 } }
          }
        ],
        raw: true,
        nest: true
      }),
      // The WiFi code itself is a credential; the WiFi screens show it, this report does not.
      PermanentWifiCodes.findAll({
        where: { cardno },
        attributes: ['id', 'username', 'ssid', 'status', 'requested_at', 'reviewed_at'],
        raw: true
      })
    ]);

  // The row's own fields go first so they can never overwrite the report's
  // type and dates (travel rows have their own "type" column).
  const timeline = [];
  const pushItem = (type, date, endDate, data) =>
    timeline.push({ ...data, type, date, end_date: endDate || date });

  flats.forEach((f) => pushItem('flat_booking', f.checkin, f.checkout, f));
  rooms.forEach((r) => pushItem('room_booking', r.checkin, r.checkout, r));
  food.forEach((f) => pushItem('food_booking', f.date, f.date, f));
  gate.forEach((g) => pushItem('gate_record', g.createdAt, g.createdAt, g));
  // Keep the travel's own type (regular seat or full car) under its own key.
  travel.forEach((t) => pushItem('travel_booking', t.date, t.date, { ...t, travel_type: t.type }));
  shibirBookings.forEach((s) => pushItem('shibir_booking', s.ShibirDb?.start_date, s.ShibirDb?.end_date, s));
  utsavBookings.forEach((u) => pushItem('utsav_booking', u.UtsavDb?.start_date, u.UtsavDb?.end_date, u));

  // Upcoming: starts after today and is not cancelled. Past 30 days:
  // everything else still in the window, including a stay that began earlier
  // and is still going, and cancellations, which show with their status.
  const CANCELLED = [
    STATUS_CANCELLED,
    STATUS_ADMIN_CANCELLED,
    STATUS_SEATSFULL_CANCELLED,
    STATUS_WRONGFORM_CANCELLED
  ];
  // Booking dates are already calendar days; only gate times need converting.
  const day = (d) =>
    typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : moment(d).tz('Asia/Kolkata').format('YYYY-MM-DD');
  const upcoming = [];
  const past30Days = [];
  timeline.forEach((item) => {
    if (!item.date) return;
    if (day(item.date) > today) {
      if (!CANCELLED.includes(item.status)) upcoming.push(item);
    }
    else if (day(item.end_date) >= past30) past30Days.push(item);
  });

  const sortFn = (a, b) => moment(b.date).valueOf() - moment(a.date).valueOf();
  upcoming.sort(sortFn);
  past30Days.sort(sortFn);

  req.log.info('person_activity_success', {
    cardno,
    upcoming: upcoming.length,
    past30Days: past30Days.length
  });
  return res.status(200).json({
    person: card.get({ plain: true }),
    upcoming,
    past30Days,
    maintenanceOpen,
    wifiCodes,
    summary: {
      totalUpcoming: upcoming.length,
      totalPast: past30Days.length,
      openMaintenance: maintenanceOpen.length,
      wifiCodes: wifiCodes.length
    }
  });
};
