import fs from 'fs';
import database from '../../config/database.js';
import {
  Countries,
  States,
  Cities,
  CentreDb
} from '../../models/associations.js';
import _ from 'lodash';
const { chunk } = _;

export const addData = async (req, res) => {
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const t = await database.transaction();

  const chunkSize = 1000;
  const dataChunks = chunk(data, chunkSize);

  for (const dataChunk of dataChunks) {
    const countryPromises = dataChunk.map((element) => ({
      name: element.name
    }));

    const countries = await Countries.bulkCreate(countryPromises, {
      transaction: t,
      returning: true
    });

    const statePromises = [];
    const cityPromises = [];

    dataChunk.forEach((element, countryIndex) => {
      const country = countries[countryIndex];

      element.states.forEach((state) => {
        statePromises.push({
          country_id: country.id,
          name: state.name
        });
      });
    });

    const states = await States.bulkCreate(statePromises, {
      transaction: t,
      returning: true
    });

    let stateIndex = 0;
    dataChunk.forEach((element) => {
      element.states.forEach((state) => {
        const insertedState = states[stateIndex++];

        state.cities.forEach((city) => {
          cityPromises.push({
            state_id: insertedState.id,
            name: city.name
          });
        });
      });
    });

    await Cities.bulkCreate(cityPromises, { transaction: t });
  }

  await t.commit();
  res.status(200).send({ message: 'Added all data successfully' });
};

export const getCountries = async (req, res) => {
  req.log.info('fetch_countries_start');
  const data = await Countries.findAll({
    attributes: [
      ['id', 'key'],
      ['name', 'value']
    ],
    order: [['name', 'ASC']]
  });
  req.log.info('fetch_countries_success', { count: data.length });
  return res.status(200).send({ message: 'fetched countries', data: data });
};

export const getStates = async (req, res) => {
  req.log.info('fetch_states_start', { country: req.params.country });
  const data = await States.findAll({
    include: [
      {
        model: Countries,
        where: { name: req.params.country },
        attributes: []
      }
    ],
    attributes: [
      ['id', 'key'],
      ['name', 'value']
    ],
    order: [['name', 'ASC']]
  });
  req.log.info('fetch_states_success', { country: req.params.country, count: data.length });
  return res.status(200).send({ message: 'fetched states', data: data });
};

export const getCities = async (req, res) => {
  req.log.info('fetch_cities_start', { country: req.params.country, state: req.params.state });
  const data = await Cities.findAll({
    include: [
      {
        model: States,
        include: [
          {
            model: Countries,
            where: { name: req.params.country },
            attributes: []
          }
        ],
        where: { name: req.params.state },
        attributes: []
      }
    ],
    attributes: [
      ['id', 'key'],
      ['name', 'value']
    ],
    order: [['name', 'ASC']]
  });
  req.log.info('fetch_cities_success', { country: req.params.country, state: req.params.state, count: data.length });
  return res.status(200).send({ message: 'fetched cities', data: data });
};

export const getCentres = async (req, res) => {
  req.log.info('fetch_centres_start');
  const data = await CentreDb.findAll({
    attributes: [
      ['id', 'key'],
      ['name', 'value']
    ],
    order: [['name', 'ASC']]
  });
  req.log.info('fetch_centres_success', { count: data.length });
  return res.status(200).send({ message: 'fetched centres', data: data });
};
