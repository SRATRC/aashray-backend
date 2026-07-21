import express from 'express';

const router = express.Router();

import {
    auth,
    authorizeRoles
} from '../../middleware/AdminAuth.js';

import {
    ROLE_SUPER_ADMIN,
    ROLE_ROOM_ADMIN,
    ROLE_CARD_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_FOOD_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_TRAVEL_ADMIN,
    ROLE_UTSAV_ADMIN,
    ROLE_AVT_ADMIN,
    ROLE_WIFI_ADMIN,
    ROLE_GATE_ADMIN,
    ROLE_MAINTENANCE_ADMIN,
    ROLE_HOUSEKEEPING_ADMIN,
    ROLE_ELECTRICAL_ADMIN,
    ROLE_ACCOUNTS_ADMIN
} from '../../config/constants.js';

import {
    createForm,
    getForms,
    getFormById,
    updateForm,
    deleteForm,
    getFormResponses,
    cloneForm,
    // Public (no auth)
    getPublicForm,
    submitFormResponse,
    getPublicResponse,
    updatePublicResponse,
    resolveIdentity,
    sendFormOtp,
    verifyFormOtp
} from '../../controllers/admin/customForm.controller.js';

import CatchAsync from '../../utils/CatchAsync.js';

// ── PUBLIC routes (no auth required) ─────────────────────────────────────────
// Must be declared BEFORE router.use(auth) so they are not protected.
router.post('/public/otp/send', CatchAsync(sendFormOtp));
router.post('/public/otp/verify', CatchAsync(verifyFormOtp));
router.get('/public/resolve-identity', CatchAsync(resolveIdentity));
router.get('/public/:id', CatchAsync(getPublicForm));
router.post('/public/:id/submit', CatchAsync(submitFormResponse));
router.get('/public/:id/responses/:responseId', CatchAsync(getPublicResponse));
router.post('/public/:id/responses/:responseId', CatchAsync(updatePublicResponse));


// All routes require authentication
router.use(auth);

// All form admin roles (department-level auth is done inside the controller)
const ALL_FORM_ROLES = [
    ROLE_SUPER_ADMIN,
    ROLE_ROOM_ADMIN,
    ROLE_CARD_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_FOOD_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_TRAVEL_ADMIN,
    ROLE_UTSAV_ADMIN,
    ROLE_AVT_ADMIN,
    ROLE_WIFI_ADMIN,
    ROLE_GATE_ADMIN,
    ROLE_MAINTENANCE_ADMIN,
    ROLE_HOUSEKEEPING_ADMIN,
    ROLE_ELECTRICAL_ADMIN,
    ROLE_ACCOUNTS_ADMIN
];

router.get(
    '/',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(getForms)
);

router.post(
    '/',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(createForm)
);

router.get(
    '/:id',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(getFormById)
);

router.put(
    '/:id',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(updateForm)
);

router.delete(
    '/:id',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(deleteForm)
);

router.get(
    '/:id/responses',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(getFormResponses)
);

router.post(
    '/:id/clone',
    authorizeRoles(...ALL_FORM_ROLES),
    CatchAsync(cloneForm)
);

export default router;
