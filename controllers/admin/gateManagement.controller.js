import { CardDb } from '../../models/associations.js';
import {
  STATUS_MUMUKSHU,
  STATUS_ONPREM,
  STATUS_RESIDENT,
  STATUS_SEVA_KUTIR
} from '../../config/constants.js';
import Sequelize from 'sequelize';

export const fetchTotal = async (req, res) => {
  const result = await CardDb.findAll({
    attributes: [
      'res_status',
      [Sequelize.fn('COUNT', Sequelize.literal('*')), 'count']
    ],
    where: { status: STATUS_ONPREM },
    group: ['res_status']
  });

  return res.status(200).send({ message: 'Success', data: result });
};

export const fetchPR = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const total_pr = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_RESIDENT
    },
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Success', data: total_pr });
};

export const fetchMumukshu = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const total_mumukshu = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_MUMUKSHU
    },
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Success', data: total_mumukshu });
};

export const fetchSevaKutir = async (req, res) => {
  const page = parseInt(req.query.page) || req.body.page || 1;
  const pageSize = parseInt(req.query.page_size) || req.body.page_size || 10;
  const offset = (page - 1) * pageSize;

  const total_seva = await CardDb.findAll({
    where: {
      status: STATUS_ONPREM,
      res_status: STATUS_SEVA_KUTIR
    },
    offset,
    limit: pageSize
  });

  return res.status(200).send({ message: 'Success', data: total_seva });
};
