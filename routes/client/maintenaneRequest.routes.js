import express from 'express';
const router = express.Router();
import {
  CreateRequest,
  ViewRequest,
  FetchDepartments
} from '../../controllers/client/maintenanceRequest.controller.js';
import { validateCard } from '../../middleware/validate.js';

router.post('/request', validateCard, CreateRequest);
router.get('/get/:cardno', validateCard, ViewRequest);
router.get('/departments', validateCard, FetchDepartments);

export default router;
