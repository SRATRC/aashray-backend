import express from 'express';
const router = express.Router();
import {
  CreateRequest,
  ViewRequest,
  FetchDepartments
} from '../../controllers/client/maintenanceRequest.controller.js';
import { validateCard } from '../../middleware/validate.js';

router.use(validateCard);

router.post('/request', CreateRequest);
router.get('/get', ViewRequest);
router.get('/departments', FetchDepartments);

export default router;
