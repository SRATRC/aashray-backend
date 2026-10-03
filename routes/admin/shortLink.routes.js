import express from 'express';

const router = express.Router();

import {
    auth,
    authorizeRoles
} from '../../middleware/AdminAuth.js';

import {
    ROLE_SUPER_ADMIN,
    ROLE_ACCOUNTS_ADMIN,
    ROLE_ROOM_ADMIN,
    ROLE_CARD_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_FOOD_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_TRAVEL_ADMIN,
    ROLE_UTSAV_ADMIN,
    ROLE_AVT_ADMIN,
    ROLE_WIFI_ADMIN
} from '../../config/constants.js';

import {
    createShortLink,
    getShortLinksByType,
    updateShortLink,
    deleteShortLink,
    TYPE_ROLE_MAP
} from '../../controllers/admin/shortLink.controller.js';

import CatchAsync from '../../utils/CatchAsync.js';
import ApiError from '../../utils/ApiError.js';

router.use(auth);

/* 
 * NOTE: The route-level authorizeRoles checks below act as a broad gate ensuring 
 * that the user has at least one valid administrative role in the system. 
 * Fine-grained, type-specific role authorization is handled inside the controller functions.
 */
router.post(
    '/',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_ACCOUNTS_ADMIN,
        ROLE_ROOM_ADMIN,
        ROLE_CARD_ADMIN,
        ROLE_OFFICE_ADMIN,
        ROLE_FOOD_ADMIN,
        ROLE_ADHYAYAN_ADMIN,
        ROLE_TRAVEL_ADMIN,
        ROLE_UTSAV_ADMIN,
        ROLE_AVT_ADMIN,
        ROLE_WIFI_ADMIN
    ),
    CatchAsync(createShortLink)
);

router.get(
    '/:type',
    CatchAsync(async (req, res, next) => {
        const { type } = req.params;
        const allowedRoles = TYPE_ROLE_MAP[type];
        if (!allowedRoles) {
            throw new ApiError(404, 'Invalid short link type');
        }

        const userRoles = req.roles || [];
        const isAuthorized = allowedRoles.some((role) => userRoles.includes(role));
        if (!isAuthorized) {
            throw new ApiError(401, 'Unauthorized');
        }

        return getShortLinksByType(req, res, next, type);
    })
);

router.put(
    '/:id',
    /* Redundant route-level role check (controller verifies type-specific access) */
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_ACCOUNTS_ADMIN,
        ROLE_ROOM_ADMIN,
        ROLE_CARD_ADMIN,
        ROLE_OFFICE_ADMIN,
        ROLE_FOOD_ADMIN,
        ROLE_ADHYAYAN_ADMIN,
        ROLE_TRAVEL_ADMIN,
        ROLE_UTSAV_ADMIN,
        ROLE_AVT_ADMIN,
        ROLE_WIFI_ADMIN
    ),
    CatchAsync(updateShortLink)
);

router.delete(
    '/:id',
    /* Redundant route-level role check (controller verifies type-specific access) */
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_ACCOUNTS_ADMIN,
        ROLE_ROOM_ADMIN,
        ROLE_CARD_ADMIN,
        ROLE_OFFICE_ADMIN,
        ROLE_FOOD_ADMIN,
        ROLE_ADHYAYAN_ADMIN,
        ROLE_TRAVEL_ADMIN,
        ROLE_UTSAV_ADMIN,
        ROLE_AVT_ADMIN,
        ROLE_WIFI_ADMIN
    ),
    CatchAsync(deleteShortLink)
);

export default router;