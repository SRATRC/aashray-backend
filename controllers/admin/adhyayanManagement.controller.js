import {
  ShibirDb,
  ShibirBookingDb,
  CardDb
} from '../../models/associations.js';
import {
  STATUS_WAITING,
  STATUS_CLOSED,
  STATUS_OPEN,
  STATUS_CONFIRMED
} from '../../config/constants.js';
import moment from 'moment';
import ApiError from '../../utils/ApiError.js';
import { Sequelize } from 'sequelize';

export const createAdhyayan = async (req, res) => {
  const { name, start_date, end_date, speaker, total_seats, comments } =
    req.body;

  const alreadyExists = await ShibirDb.findOne({
    where: {
      speaker: speaker,
      start_date: start_date
    }
  });
  if (alreadyExists) throw new ApiError(400, 'Adhyayan Already Exists');

  const adhyayan_details = await ShibirDb.create({
    name: name,
    speaker: speaker,
    start_date: start_date,
    end_date: end_date,
    total_seats: total_seats,
    available_seats: total_seats,
    comments: comments,
    updatedBy: req.user.username
  });

  res.status(201).send({ message: 'Created Adhyayan', data: adhyayan_details });
};

export const fetchAllAdhyayan = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const shibirs = await ShibirDb.findAll({
    where: {
      start_date: {
        [Sequelize.Op.gte]: today
      }
    },
    offset,
    limit: pageSize,
    order: [['start_date', 'ASC']]
  });
  return res.status(200).send({ message: 'fetched results', data: shibirs });
};

export const updateAdhyayan = async (req, res) => {
  const { name, start_date, end_date, speaker, total_seats, comments } =
    req.body;

  const id = req.params.id;

  const data = await ShibirDb.findByPk(id);
  var available_seats = data.dataValues.available_seats;
  const diff = Math.abs(data.dataValues.total_seats - total_seats);

  if (data.dataValues.total_seats > total_seats) {
    available_seats -= diff;
    if (available_seats < 0) available_seats = 0;
  } else if (data.dataValues.total_seats < total_seats) {
    available_seats += diff;
  }

  const updatedItem = await ShibirDb.update(
    {
      name: name,
      speaker: speaker,
      start_date: start_date,
      end_date: end_date,
      total_seats: total_seats,
      available_seats: available_seats,
      comments: comments,
      updatedBy: req.user.username
    },
    {
      where: {
        id: id
      }
    }
  );
  if (updatedItem != 1)
    throw new ApiError(500, 'Error occured while updating adhyayan');
  res.status(200).send({ message: 'Updated Adhyayan' });
};

// TODO: ask what shall be done in this function
export const adhyayanReport = async (req, res) => {
  res.status(200).send({ message: 'Fetched Adhyayan Report' });
};

export const adhyayanWaitlist = async (req, res) => {
  const today = moment().format('YYYY-MM-DD');

  const page = req.body.page || 1;
  const pageSize = req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const data = await ShibirBookingDb.findAll({
    include: [
      {
        model: ShibirDb,
        attributes: ['name', 'speaker', 'start_date', 'end_date'],
        where: {
          start_date: {
            [Sequelize.Op.gte]: today
          }
        },
        required: true,
        order: [['start_date', 'ASC']]
      },
      {
        model: CardDb,
        attributes: ['issuedto', 'mobno', 'centre'],
        required: true
      }
    ],
    where: {
      status: STATUS_WAITING
    },
    attributes: ['id', 'shibir_id', 'cardno', 'status'],
    offset,
    limit: pageSize
  });
  res.status(200).send({ message: 'Fetched Adhyayan', data: data });
};

export const confirmWaiting = async (req, res) => {
  const itemsUpdated = await ShibirBookingDb.update(
    {
      status: STATUS_CONFIRMED
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemsUpdated != 1)
    throw new ApiError(500, 'Error occured while confirming waitlist');

  return res.status(200).send({ message: 'Confirmed Waitlist' });
};

export const closeAdhyayan = async (req, res) => {
  const itemUpdated = await ShibirDb.update(
    {
      status: STATUS_CLOSED
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemUpdated != 1)
    throw new ApiError(500, 'Error occured while closing adhyayan');
  res.status(200).send({ message: 'Closed Adhyayan' });
};

export const openAdhyayan = async (req, res) => {
  const itemUpdated = await ShibirDb.update(
    {
      status: STATUS_OPEN
    },
    {
      where: {
        id: req.params.id
      }
    }
  );

  if (itemUpdated != 1)
    throw new ApiError(500, 'Error occured while closing adhyayan');
  res.status(200).send({ message: 'Opened Adhyayan' });
};
