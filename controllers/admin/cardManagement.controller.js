import {
  CardDb,
  GuestRelationship,
  Departments
} from '../../models/associations.js';
import {
  ERR_CARD_NOT_FOUND,
  MSG_UPDATE_SUCCESSFUL,
  STATUS_OFFPREM
} from '../../config/constants.js';
import Sequelize from 'sequelize';
import bcrypt from 'bcryptjs';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import { Op } from 'sequelize';
import { sendWhatsAppMessage } from '../../utils/sendWhatsAppMessage.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import moment from 'moment-timezone';

// export const createCard = async (req, res) => {
//   const {
//     cardno,
//     issuedto,
//     gender,
//     dob,
//     mobno,
//     email,
//     idType,
//     idNo,
//     address,
//     country,
//     state,
//     city,
//     pin,
//     centre,
//     res_status,
//     referenceCardno,  // New: cardno of mumukshu
//     guestType         // New: guest type (Driver, VIP, Friend, Family)
//   } = req.body;

//   const alreadyExists = await CardDb.findOne({ where: { cardno } });
//   if (alreadyExists) {
//     throw new ApiError(400, 'Card already exists');
//   }

//   const t = await CardDb.sequelize.transaction();

//   try {
//     const user = await CardDb.create({
//       cardno,
//       issuedto,
//       gender,
//       dob,
//       mobno,
//       email,
//       idType,
//       idNo,
//       address,
//       country,
//       state,
//       city,
//       pin,
//       center: centre,
//       status: STATUS_OFFPREM,
//       res_status,
//       updatedBy: req.user.username
//     }, { transaction: t });

//     if (!user) {
//       throw new ApiError(500, 'Error occurred while registering the card');
//     }

//     // 🔄 If the person is a guest, add an entry in guest_relationship table
//     if (res_status === 'GUEST') {
//       if (!referenceCardno || !guestType) {
//         throw new ApiError(400, 'Missing referenceCardno or guestType for guest');
//       }

//       await GuestRelationship.create({
//         cardno: referenceCardno,
//         guest: cardno,
//         type: guestType,
//         updatedBy: req.user.username
//       }, { transaction: t });
//     }

//     await t.commit();

//     return res
//       .status(200)
//       .send({ message: 'Successfully registered card', data: user });

//   } catch (error) {
//     await t.rollback();
//     console.error("Sequelize Validation Error:", error.errors || error);
//     return res.status(500).json({
//       message: "Validation error",
//       details: error.errors || error.message
//     });
//   }
// };

export const createCard = async (req, res) => {
  const {
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
    department, // for SEVA KUTIR
    referenceCardno, // parent card for guest
    referencePhone, // parent phone for guest
    ref_mobno, // parent phone for guest (alt name)
    guestType // guest type: Driver, VIP, Friend, Family
  } = req.body;

  // ── Auto-generate cardno (MAX(id)+1 zero-padded to 10 digits) ───────────
  const maxId = await CardDb.max('id');
  const cardno = String((maxId || 0) + 1).padStart(10, '0');

  req.log.info('create_card_start', { cardno, issuedto, res_status });

  // ── Validate SEVA KUTIR department ───────────────────────────────────────
  if (res_status === 'SEVA KUTIR') {
    if (!department)
      throw new ApiError(400, 'Department is required for Seva Kutir cards');
    const dept = await Departments.findOne({
      where: { dept_name: department }
    });
    if (!dept) throw new ApiError(400, 'Invalid department selected');
  }

  // --- Start a transaction ---
  const t = await CardDb.sequelize.transaction();

  try {
    // --- Create the main card ---
    const newCard = await CardDb.create(
      {
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
        ...(res_status === 'SEVA KUTIR' && { department }),
        updatedBy: req.user.username
      },
      { transaction: t }
    );

    if (!newCard) throw new ApiError(500, 'Failed to create card');

    // --- If this is a guest card, validate and insert relationship ---
    if (res_status === 'GUEST') {
      const refPhone = referencePhone || ref_mobno;
      let parentCardno = referenceCardno;

      if (refPhone) {
        const parentCard = await CardDb.findOne({
          where: { mobno: refPhone }
        });
        if (!parentCard) {
          throw new ApiError(
            400,
            `Reference phone number ${refPhone} does not belong to a registered user`
          );
        }
        parentCardno = parentCard.cardno;
      } else if (parentCardno && /^\d{10}$/.test(parentCardno)) {
        const parentCard = await CardDb.findOne({
          where: { mobno: parentCardno }
        });
        if (parentCard) {
          parentCardno = parentCard.cardno;
        }
      }

      if (!parentCardno || !guestType) {
        throw new ApiError(400, 'Missing reference phone number or guest type');
      }

      // Check that parent card exists
      const parentCard = await CardDb.findOne({
        where: { cardno: parentCardno }
      });
      if (!parentCard) {
        throw new ApiError(
          400,
          `Reference card ${parentCardno} does not exist`
        );
      }

      await GuestRelationship.create(
        {
          cardno: parentCardno,
          guest: cardno,
          type: guestType,
          updatedBy: req.user.username
        },
        { transaction: t }
      );
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

        await sendWhatsAppMessage(
          formattedPhone,
          'card_account_created',
          components
        );
      } catch (waErr) {
        console.error(
          'Error sending WhatsApp message in createCard:',
          waErr.message || waErr
        );
      }
    }

    return res.status(200).json({
      message: 'Card created successfully',
      data: newCard
    });
  } catch (error) {
    // --- Rollback on any error ---
    await t.rollback();

    req.log.error('create_card_error', { cardno, error: error.message });
    let message = 'Internal server error';
    if (error.name === 'SequelizeUniqueConstraintError') {
      const field = error.errors?.[0]?.path;
      if (field === 'mobno') {
        message = 'Phone number is already registered';
      } else if (field === 'cardno') {
        message = 'Card number must be unique';
      } else {
        message =
          error.errors?.[0]?.message || 'Unique constraint validation failed';
      }
    } else {
      message = error.message || 'Internal server error';
    }

    return res.status(400).json({ message });
  }
};

export const fetchAllCards = async (req, res) => {
  req.log.info('fetch_all_cards_start');
  const data = await CardDb.findAll({});

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
          { cardno: { [Sequelize.Op.like]: `%${term}%` } }
        ]
      }
    });

    const serializedData = await Promise.all(
      data.map(async (card) => {
        const cardJson = card.toJSON();
        if (cardJson.res_status === 'GUEST') {
          const relation = await GuestRelationship.findOne({
            where: { guest: cardJson.cardno }
          });
          if (relation) {
            cardJson.referenceCardno = relation.cardno;
            cardJson.guestType = relation.type;
            const parentCard = await CardDb.findOne({
              where: { cardno: relation.cardno },
              attributes: ['mobno']
            });
            if (parentCard) {
              cardJson.referencePhone = parentCard.mobno;
            }
          }
        }
        return cardJson;
      })
    );

    req.log.info('search_cards_by_name_success', {
      term,
      count: serializedData.length
    });
    return res
      .status(200)
      .send({ message: 'Fetched all cards', data: serializedData });
  } catch (err) {
    req.log.error('search_cards_by_name_error', {
      term: req.params.name,
      error: err.message
    });
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
    department, // for SEVA KUTIR
    referenceCardno,
    referencePhone, // parent phone for guest
    ref_mobno, // parent phone for guest (alt name)
    guestType
  } = req.body;

  req.log.info('update_card_start', { cardno, res_status, status });

  const card = await CardDb.findOne({ where: { cardno } });

  if (!card) {
    req.log.warn('update_card_not_found', { cardno });
    throw new ApiError(400, ERR_CARD_NOT_FOUND);
  }

  let parentCardno = referenceCardno;
  const refPhone = referencePhone || ref_mobno;

  // Validation for guest
  if (res_status === 'GUEST') {
    if (refPhone) {
      const parentCard = await CardDb.findOne({
        where: { mobno: refPhone }
      });
      if (!parentCard) {
        throw new ApiError(
          400,
          `Reference phone number ${refPhone} does not belong to a registered user`
        );
      }
      parentCardno = parentCard.cardno;
    } else if (parentCardno && /^\d{10}$/.test(parentCardno)) {
      const parentCard = await CardDb.findOne({
        where: { mobno: parentCardno }
      });
      if (parentCard) {
        parentCardno = parentCard.cardno;
      }
    }

    if (!parentCardno || !guestType) {
      throw new ApiError(
        400,
        'Missing reference phone number or guestType for guest'
      );
    }
  }

  // Validation for seva kutir
  if (res_status === 'SEVA KUTIR' && department) {
    const dept = await Departments.findOne({
      where: { dept_name: department }
    });
    if (!dept) throw new ApiError(400, 'Invalid department selected');
  }

  // --- Compare to find changed fields ---
  const isChanged = (newVal, oldVal) => {
    if (newVal === undefined) return false;
    const normalize = (v) =>
      v === null || v === undefined ? '' : String(v).trim();
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
  if (isChanged(department, card.department)) changed.push('Department');

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
    // Only update department for SEVA KUTIR; clear it for other statuses
    department:
      res_status === 'SEVA KUTIR' ? department || card.department : null,
    updatedBy: req.user.username
  });

  // Update or create guest relationship
  if (res_status === 'GUEST') {
    const existingRelation = await GuestRelationship.findOne({
      where: { guest: cardno }
    });

    if (existingRelation) {
      await existingRelation.update({
        cardno: parentCardno,
        type: guestType,
        updatedBy: req.user.username
      });
    } else {
      await GuestRelationship.create({
        cardno: parentCardno,
        guest: cardno,
        type: guestType,
        updatedBy: req.user.username
      });
    }
  } else {
    // If not a guest anymore, remove guest_relationship if it exists
    await GuestRelationship.destroy({ where: { guest: cardno } });
  }

  req.log.info('update_card_success', { cardno, res_status });

  // --- Send WhatsApp notification if any details were changed ---
  if (changed.length > 0) {
    const targetPhone = mobno || card.mobno;
    if (targetPhone) {
      try {
        const formattedPhone = formatWhatsAppPhone(
          targetPhone,
          country || card.country
        );

        const formattedTime = moment()
          .tz('Asia/Kolkata')
          .format('DD-MM-YYYY hh:mm A');

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

        await sendWhatsAppMessage(
          formattedPhone,
          'profile_updated',
          components
        );
      } catch (waErr) {
        console.error(
          'Error sending WhatsApp profile_updated message in updateCard:',
          waErr.message || waErr
        );
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

  await card.update({
    cardno: new_cardno,
    updatedBy: req.user.username
  });

  req.log.info('transfer_card_success', {
    oldCardno: cardno,
    newCardno: new_cardno
  });
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
          category) as t;`
  );

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

  await CardDb.update({ password: defaultPasswordHash }, { where: { cardno } });

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

      await sendWhatsAppMessage(
        formattedPhone,
        'password_reset_admin',
        components
      );
    } catch (err) {
      console.error(
        'Error sending WhatsApp message in resetPasswordDefault:',
        err.message || err
      );
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
    attributes: [
      'cardno',
      'issuedto',
      'center',
      'mobno',
      'res_status',
      'gender'
    ],
    where: { mobno }
  });

  if (!card) {
    req.log.warn('get_card_by_mobile_not_found', { mobno });
    return res.status(404).json({ message: 'Card not found' });
  }

  req.log.info('get_card_by_mobile_success', { mobno, cardno: card.cardno });
  return res.status(200).json({ message: 'Found card', data: card });
};
