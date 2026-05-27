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

router.get(
    '/accounts',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_ACCOUNTS_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'accounts'
        )
    )
);

router.get(
    '/room',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_ROOM_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'room'
        )
    )
);

router.get(
    '/card',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_CARD_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'card'
        )
    )
);

router.get(
    '/office',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_OFFICE_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'office'
        )
    )
);

router.get(
    '/food',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_FOOD_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'food'
        )
    )
);

router.get(
    '/adhyayan',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_ADHYAYAN_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'adhyayan'
        )
    )
);

router.get(
    '/travel',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_TRAVEL_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'travel'
        )
    )
);

router.get(
    '/utsav',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_UTSAV_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'utsav'
        )
    )
);

router.get(
    '/avt',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_AVT_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'avt'
        )
    )
);

router.get(
    '/wifi',
    authorizeRoles(
        ROLE_SUPER_ADMIN,
        ROLE_WIFI_ADMIN
    ),
    CatchAsync((req, res, next) =>
        getShortLinksByType(
            req,
            res,
            next,
            'wifi'
        )
    )
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