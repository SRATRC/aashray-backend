import express from 'express';
const router = express.Router();
import {
  createCard,
  fetchAllCards,
  searchCardsByName,
  updateCard,
  transferCard,
  fetchTotalTransactions,
  resetPasswordDefault,
  getCardByMobile,
  getCardByCardno,
  getPersonActivity
} from '../../controllers/admin/cardManagement.controller.js';
import { auth, authorizeRoles } from '../../middleware/AdminAuth.js';
import { ROLE_CARD_ADMIN, ROLE_FOOD_ADMIN, ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN, ROLE_WIFI_ADMIN } from '../../config/constants.js';
import CatchAsync from '../../utils/CatchAsync.js';

router.use(auth);
router.use(authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_CARD_ADMIN, ROLE_UTSAV_ADMIN, ROLE_WIFI_ADMIN,  ROLE_FOOD_ADMIN));

router.post('/create', CatchAsync(createCard));
router.get('/getAll', CatchAsync(fetchAllCards));
router.get('/search/:name', CatchAsync(searchCardsByName));
router.get('/by-mobile/:mobno', CatchAsync(getCardByMobile));
router.put('/update', CatchAsync(updateCard));
router.put('/transfer', CatchAsync(transferCard));
router.get('/transactions/:cardno', CatchAsync(fetchTotalTransactions));
router.post('/reset-pwd', CatchAsync(resetPasswordDefault));
// Office, card and super admins only: the same roles the staff panel opens
// the card screens to. The report shows stays, gate movements and WiFi rows.
router.get(
  '/person-activity',
  authorizeRoles(ROLE_OFFICE_ADMIN, ROLE_SUPER_ADMIN, ROLE_CARD_ADMIN),
  CatchAsync(getPersonActivity)
);
// Generic param route goes last so it never shadows a named route above.
router.get('/:cardno', CatchAsync(getCardByCardno));

export default router;

