import { GateRecord, CardDb } from '../../models/associations.js';
import { STATUS_ONPREM, STATUS_OFFPREM } from '../../config/constants.js';

export const gateEntry = async (req, res) => {
  try {
    const [updatedRowsCount] = await CardDb.update(
      { status: STATUS_ONPREM },
      { where: { cardno: req.user.cardno }, returning: true }
    );
    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Error updating the status' });
    }
    const gatein = await GateRecord.create({
      cardno: req.user.cardno,
      status: entryStatus
    });
    return res.status(200).send({ message: 'Success', data: gatein });
  } catch (err) {
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};

export const gateExit = async (req, res) => {
  const cardno = req.params.cardno;
  try {
    const [updatedRowsCount, updatedRows] = await CardDb.update(
      { status: STATUS_OFFPREM },
      { where: { cardno: req.user.cardno }, returning: true }
    );
    if (updatedRowsCount === 0) {
      return res.status(404).json({ error: 'Error updating the status' });
    }
    const gateout = await GateRecord.create({
      cardno: req.user.cardno,
      status: exitStatus
    });
    return res.status(200).send({ message: 'Success', data: gateout });
  } catch (err) {
    return res
      .status(404)
      .send({ error: err.message, message: 'An error Occurred' });
  }
};
