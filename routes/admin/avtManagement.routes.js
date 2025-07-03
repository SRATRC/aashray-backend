console.log('avtManagement.routes.js mounted');
console.log('🧪 authorizeRoles function:', authorizeRoles.toString());

import express from 'express';
const router = express.Router();
import {
  fetchAllCards,
  searchCards,
} from '../../controllers/admin/avtManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_AVT_ADMIN, ROLE_SUPER_ADMIN } from '../../config/constants.js';
console.log('💡 ROLE_AVT_ADMIN =', ROLE_AVT_ADMIN);
console.log('💡 ROLE_SUPER_ADMIN =', ROLE_SUPER_ADMIN);

import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_AVT_ADMIN, ROLE_SUPER_ADMIN));

router.get('/getAll', CatchAsync(fetchAllCards));
router.get('/search/:name', CatchAsync(searchCards));
export default router;
