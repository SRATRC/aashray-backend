import express from 'express';
import { validateCard } from '../../middleware/validate.js';
import ApiError from '../../utils/ApiError.js';

const router = express.Router();

const deprecatedEndpoint = (req, res, next) => {
  throw new ApiError(
    410,
    'Please update Aashray app to continue using it.',
    {}
  );
};

router.use(validateCard);

router.post('/booking', deprecatedEndpoint);
router.post('/validate', deprecatedEndpoint);

export default router;