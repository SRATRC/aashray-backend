import {
  getFoodTodaySnapshot,
  getAdhyayanSnapshot,
  getGateCardsSnapshot,
  getUtsavSnapshot,
  getKioskTodaySnapshot,
  getStationPinHash,
  syncKioskBatch
} from '../../helpers/offlineSync.helper.js';
import database from '../../config/database.js';

export const getFoodSnapshot = async (req, res) => {
  const data = await getFoodTodaySnapshot(req);
  return res.status(200).json({ message: 'Success', data });
};

export const getAdhyayanSnapshotController = async (req, res) => {
  const data = await getAdhyayanSnapshot(req.params.shibir_id, req);
  return res.status(200).json({ message: 'Success', data });
};

export const getGateSnapshot = async (req, res) => {
  const data = await getGateCardsSnapshot(req);
  return res.status(200).json({ message: 'Success', data });
};

export const getUtsavSnapshotController = async (req, res) => {
  const data = await getUtsavSnapshot(req.params.utsavid, req);
  return res.status(200).json({ message: 'Success', data });
};

export const getKioskSnapshot = async (req, res) => {
  const data = await getKioskTodaySnapshot(req);
  return res.status(200).json({ message: 'Success', data });
};

export const getPinHash = async (req, res) => {
  const hash = getStationPinHash();
  return res.status(200).json({ message: 'Success', pinHash: hash });
};

export const syncKiosk = async (req, res) => {
  const t = await database.transaction();
  req.transaction = t;

  const results = await syncKioskBatch(req.body, req, t);
  await t.commit();

  return res.status(200).json({ message: 'Kiosk offline sync completed', results });
};
