import { CardDb,GuestRelationship, FlatBooking, RoomBooking, FoodDb, GateRecord, MaintenanceDb, ShibirBookingDb, TravelDb, UtsavBooking,  PermanentWifiCodes, ShibirDb, UtsavDb } from '../../models/associations.js';
import { ERR_CARD_NOT_FOUND, MSG_UPDATE_SUCCESSFUL, STATUS_ACTIVE, STATUS_OFFPREM, STATUS_OPEN } from '../../config/constants.js';
import Sequelize from 'sequelize';
import bcrypt from 'bcryptjs';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import { Op } from 'sequelize';
import moment from "moment";


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

  // --- Check if cardno already exists ---
  const existingCard = await CardDb.findOne({ where: { cardno } });
  if (existingCard) {
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

    return res.status(200).json({
      message: 'Card created successfully',
      data: newCard
    });

  } catch (error) {
    // --- Rollback on any error ---
    await t.rollback();

    console.error('Error creating card:', error);
    const message = error.name === 'SequelizeUniqueConstraintError'
      ? 'Card number must be unique'
      : error.message || 'Internal server error';

    return res.status(400).json({ message });
  }
};

export const fetchAllCards = async (req, res) => {
  
  const data = await CardDb.findAll({
  });

  return res.status(200).send({ message: 'Fetched all cards', data: data });
};


export const searchCardsByName = async (req, res) => {
  try {
    const term = req.params.name;

    const data = await CardDb.findAll({
      where: {
        [Sequelize.Op.or]: [
          { issuedto: { [Sequelize.Op.like]: `%${term}%` } },
          { mobno: { [Sequelize.Op.like]: `%${term}%` } },
          { cardno: { [Sequelize.Op.like]: `%${term}%` } } // ✅ added this
        ]
      }
    });

    return res.status(200).send({ message: 'Fetched all cards', data });
  } catch (err) {
    console.error('Error in searchCardsByName:', err);
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

  const card = await CardDb.findOne({ where: { cardno } });

  if (!card) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  // Validation for guest
  if (res_status === 'GUEST') {
    if (!referenceCardno || !guestType) {
      throw new ApiError(400, 'Missing referenceCardno or guestType for guest');
    }
  }

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

  // Update or create guest relationship
  if (res_status === 'GUEST') {
    const [relation, created] = await GuestRelationship.findOrCreate({
      where: { cardno: cardno },
      defaults: {
        cardno: cardno,
        referenceCardno,
        guestType,
        createdBy: req.user.username
      }
    });

    if (!created) {
      await relation.update({
        referenceCardno,
        guestType,
        updatedBy: req.user.username
      });
    }
  } else {
    // If not a guest anymore, remove guest_relationship if it exists
    await GuestRelationship.destroy({ where: { cardno: cardno } });
  }

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

export const transferCard = async (req, res) => {
  const { cardno, new_cardno } = req.body;

  const card = await CardDb.findOne({
    where: { cardno: cardno }
  });

  if (!card) {
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  await card.update(
    {
      cardno: new_cardno,
      updatedBy: req.user.username
    }
  );

  return res.status(200).send({ message: MSG_UPDATE_SUCCESSFUL });
};

// TODO: FIX this
export const fetchTotalTransactions = async (req, res) => {
  const cardno = req.params.cardno;

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

  return res
    .status(200)
    .send({ message: 'fetched all user transactions', data: results });
};



export const resetPasswordDefault = async (req, res) => {
  const { cardno } = req.body;

  if (!cardno) {
    throw new ApiError(400, 'cardno is required');
  }

  const card = await CardDb.findOne({ where: { cardno } });

  if (!card) {
    throw new ApiError(404, 'Card not found');
  }

  // ✅ Use the same default value defined in the model
  const defaultPasswordHash = CardDb.rawAttributes.password.defaultValue;

  await CardDb.update(
    { password: defaultPasswordHash },
    { where: { cardno } }
  );

  return res
    .status(200)
    .json({ message: 'Password reset successfully to default.' });
};

export const getCardByMobile = async (req, res) => {
  const { mobno } = req.params;

  if (!mobno) {
    return res.status(400).json({ message: 'mobno is required' });
  }

  const card = await CardDb.findOne({
    attributes: ['cardno', 'issuedto', 'center', 'mobno', 'res_status', 'gender'],
    where: { mobno }
  });

  if (!card) {
    return res.status(404).json({ message: 'Card not found' });
  }

  return res.status(200).json({ message: 'Found card', data: card });
};


export const getPersonActivity = async (req, res) => {
  try {
    const { cardno } = req.query;

    if (!cardno) {
      return res.status(400).json({ message: "cardno is required" });
    }

    const today = moment().format("YYYY-MM-DD");
    const past30 = moment().subtract(30, "days").format("YYYY-MM-DD");

    // =================================================
    // 🚀 PARALLEL QUERIES
    // =================================================

    const [
      flats,
      rooms,
      food,
      gate,
      maintenanceOpen,
      shibirBookings,
      travel,
      utsavBookings,
      wifiCodes
    ] = await Promise.all([
      // 🏠 FLAT
      FlatBooking.findAll({
        where: {
          cardno,
          [Op.or]: [
            { checkin: { [Op.gte]: past30 } },
            { checkout: { [Op.gte]: past30 } }
          ]
        },
        raw: true
      }),

      // 🛏 ROOM
      RoomBooking.findAll({
        where: {
          cardno,
          [Op.or]: [
            { checkin: { [Op.gte]: past30 } },
            { checkout: { [Op.gte]: past30 } }
          ]
        },
        raw: true
      }),

      // 🍽 FOOD
      FoodDb.findAll({
        where: {
          cardno,
          date: { [Op.gte]: past30 }
        },
        raw: true
      }),

      // 🚪 GATE
      GateRecord.findAll({
        where: {
          cardno,
          createdAt: { [Op.gte]: past30 }
        },
        raw: true
      }),

      // 🔧 MAINTENANCE → ONLY OPEN (NO DATE)
      MaintenanceDb.findAll({
        where: {
          requested_by: cardno,
          status: STATUS_OPEN
        },
        raw: true
      }),

      // 📿 SHIBIR (JOIN MASTER)
      ShibirBookingDb.findAll({
        where: { cardno },
        include: [
          {
            model: ShibirDb,
            attributes: ["start_date", "end_date", "name"],
            required: true
          }
        ],
        raw: true,
        nest: true
      }),

      // 🚗 TRAVEL
      TravelDb.findAll({
        where: {
          cardno,
          date: { [Op.gte]: past30 }
        },
        raw: true
      }),

      // 🎉 UTSAV (JOIN MASTER)
      UtsavBooking.findAll({
        where: { cardno },
        include: [
          {
            model: UtsavDb,
            attributes: ["start_date", "end_date", "name"],
            required: true
          }
        ],
        raw: true,
        nest: true
      }),

      // 📶 WIFI (NO DATE FILTER)
      PermanentWifiCodes.findAll({
        where: { cardno },
        raw: true
      })
    ]);

    // =================================================
    // 🧩 NORMALIZE
    // =================================================

    const timeline = [];
    const pushItem = (type, date, data) =>
      timeline.push({ type, date, ...data });

    // ===== DATE BASED =====

    flats.forEach(f => pushItem("flat_booking", f.checkin, f));
    rooms.forEach(r => pushItem("room_booking", r.checkin, r));
    food.forEach(f => pushItem("food_booking", f.date, f));
    gate.forEach(g => pushItem("gate_record", g.createdAt, g));
    travel.forEach(t => pushItem("travel_booking", t.date, t));

    // ✅ SHIBIR (FROM MASTER DATE)
    shibirBookings.forEach(s =>
      pushItem(
        "shibir_booking",
        s.ShibirDb?.start_date,
        s
      )
    );

    // ✅ UTSAV (FROM MASTER DATE)
    utsavBookings.forEach(u =>
      pushItem(
        "utsav_booking",
        u.UtsavDb?.start_date,
        u
      )
    );

    // =================================================
    // 📊 SPLIT
    // =================================================

    const upcoming = [];
    const past30Days = [];

    timeline.forEach(item => {
      if (!item.date) return;

      const d = moment(item.date).format("YYYY-MM-DD");

      if (d > today) upcoming.push(item);
      else if (d >= past30) past30Days.push(item);
    });

    const sortFn = (a, b) =>
      moment(b.date).valueOf() - moment(a.date).valueOf();

    upcoming.sort(sortFn);
    past30Days.sort(sortFn);

    // =================================================
    // 🎁 FINAL RESPONSE
    // =================================================

    return res.json({
      upcoming,
      past30Days,
      maintenanceOpen, // 👈 separate section
      wifiCodes, // 👈 separate section
      summary: {
        totalUpcoming: upcoming.length,
        totalPast: past30Days.length,
        openMaintenance: maintenanceOpen.length,
        wifiCodes: wifiCodes.length
      }
    });
  } catch (error) {
    console.error("Person activity error:", error);
    return res.status(500).json({
      message: "Failed to fetch person activity",
      error: error.message
    });
  }
};