import { CardDb } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';

export const updateProfile = async (req, res) => {
  const {
    issuedto,
    gender,
    dob,
    address,
    mobno,
    email,
    country,
    state,
    city,
    pin,
    centre
  } = req.body;
  const updatedProfile = await CardDb.update(
    {
      issuedto,
      gender,
      dob,
      address,
      mobno,
      email,
      country,
      state,
      city,
      pin,
      centre
    },
    {
      where: {
        cardno: req.user.cardno
      }
    }
  );
  if (!updatedProfile) {
    throw new ApiError(404, 'user not updated');
  }
  return res.status(200).send({ message: 'Profile Updated' });
};
