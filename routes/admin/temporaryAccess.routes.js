import express from 'express';
import {
    generateTemporaryAccessLink,
    listTemporaryAccessLinks,
    toggleTemporaryAccessLink
} from '../../controllers/admin/temporaryAccess.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_SUPER_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

// Strictly restricted to superAdmin
router.use(auth);
router.use(authorizeRoles(ROLE_SUPER_ADMIN));

router.post('/generate', CatchAsync(generateTemporaryAccessLink));
router.get('/list', CatchAsync(listTemporaryAccessLinks));
router.patch('/:id/toggle', CatchAsync(toggleTemporaryAccessLink));

export default router;
