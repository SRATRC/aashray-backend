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
    deleteShortLink
} from '../../controllers/admin/shortLink.controller.js';

import CatchAsync from '../../utils/CatchAsync.js';
import ApiError from '../../utils/ApiError.js';

router.use(auth);

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

const typeRoleMap = {
    accounts: [ROLE_SUPER_ADMIN, ROLE_ACCOUNTS_ADMIN],
    room: [ROLE_SUPER_ADMIN, ROLE_ROOM_ADMIN],
    card: [ROLE_SUPER_ADMIN, ROLE_CARD_ADMIN],
    office: [ROLE_SUPER_ADMIN, ROLE_OFFICE_ADMIN],
    food: [ROLE_SUPER_ADMIN, ROLE_FOOD_ADMIN],
    adhyayan: [ROLE_SUPER_ADMIN, ROLE_ADHYAYAN_ADMIN],
    travel: [ROLE_SUPER_ADMIN, ROLE_TRAVEL_ADMIN],
    utsav: [ROLE_SUPER_ADMIN, ROLE_UTSAV_ADMIN],
    avt: [ROLE_SUPER_ADMIN, ROLE_AVT_ADMIN],
    wifi: [ROLE_SUPER_ADMIN, ROLE_WIFI_ADMIN]
};

router.get(
    '/:type',
    CatchAsync(async (req, res, next) => {
        const { type } = req.params;
        const allowedRoles = typeRoleMap[type];
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