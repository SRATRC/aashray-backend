import ShortLink from '../../models/short_link.model.js';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
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

const VALID_TYPES = [
    'accounts',
    'room',
    'card',
    'office',
    'food',
    'adhyayan',
    'travel',
    'utsav',
    'avt',
    'wifi'
];

export const TYPE_ROLE_MAP = {
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

const isValidUrl = (url) => {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (err) {
        return false;
    }
};

export const createShortLink = async (req, res, next) => {
    const { slug, target_url, type } = req.body;

    if (!slug || !target_url) {
        throw new ApiError(400, 'slug and target_url are required');
    }

    if (!isValidUrl(target_url)) {
        throw new ApiError(400, 'Invalid target_url. Must be a valid HTTP/HTTPS URL');
    }

    const slugRegex = /^[A-Za-z0-9_-]+$/;
    if (!slugRegex.test(slug)) {
        throw new ApiError(400, 'Invalid slug format. Slugs can only contain alphanumeric characters, hyphens, and underscores');
    }

    if (!VALID_TYPES.includes(type)) {
        throw new ApiError(400, `Invalid link type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const allowedRoles = TYPE_ROLE_MAP[type];
    const userRoles = req.roles || [];
    const isAuthorized = allowedRoles.some(role => userRoles.includes(role));
    if (!isAuthorized) {
        throw new ApiError(403, 'You are not authorized to create links of this type');
    }

    const t = await database.transaction();
    req.transaction = t;

    try {
        const existing = await ShortLink.findOne({
            where: { slug },
            transaction: t,
            lock: true
        });

        if (existing) {
            throw new ApiError(400, 'Slug already exists');
        }

        const link = await ShortLink.create({
            slug,
            target_url,
            type,
            createdBy: req.user?.username
        }, { transaction: t });

        await t.commit();
        req.transaction = null;

        res.status(201).json({
            success: true,
            data: link
        });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            throw new ApiError(400, 'Slug already exists');
        }
        throw error;
    }
};

export const getShortLinksByType = async (req, res, next, type) => {
    const links = await ShortLink.findAll({
        where: {
            type
        },
        order: [
            ['createdAt', 'DESC']
        ]
    });

    res.status(200).json({
        success: true,
        data: links
    });
};

export const redirectShortLink = async (req, res, next) => {
    const { slug } = req.params;

    const link = await ShortLink.findOne({
        where: {
            slug,
            active: true
        }
    });

    if (!link) {
        throw new ApiError(404, 'Link not found');
    }

    await link.increment('click_count');

    return res.redirect(link.target_url);
};

export const updateShortLink = async (req, res, next) => {
    const { id } = req.params;
    const { slug, target_url, type, active } = req.body;

    if (type && !VALID_TYPES.includes(type)) {
        throw new ApiError(400, `Invalid link type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    if (target_url && !isValidUrl(target_url)) {
        throw new ApiError(400, 'Invalid target_url. Must be a valid HTTP/HTTPS URL');
    }

    const t = await database.transaction();
    req.transaction = t;

    try {
        const link = await ShortLink.findByPk(id, { transaction: t, lock: true });

        if (!link) {
            throw new ApiError(404, 'Link not found');
        }

        const allowedRoles = TYPE_ROLE_MAP[link.type];
        const userRoles = req.roles || [];
        const isAuthorized = allowedRoles.some(role => userRoles.includes(role));
        if (!isAuthorized) {
            throw new ApiError(403, 'You are not authorized to manage links of this type');
        }

        if (type && type !== link.type) {
            const newAllowedRoles = TYPE_ROLE_MAP[type];
            const isAuthorizedNew = newAllowedRoles.some(role => userRoles.includes(role));
            if (!isAuthorizedNew) {
                throw new ApiError(403, 'You are not authorized to change link to this type');
            }
        }

        const updateData = {};
        if (slug !== undefined && slug.trim() !== '' && slug.trim() !== link.slug) {
            const formattedSlug = slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
            const existingSlug = await ShortLink.findOne({ where: { slug: formattedSlug }, transaction: t });
            if (existingSlug && existingSlug.id !== link.id) {
                throw new ApiError(400, 'Slug already exists');
            }
            updateData.slug = formattedSlug;
        }

        if (target_url !== undefined) updateData.target_url = target_url;
        if (type !== undefined) updateData.type = type;
        if (active !== undefined) updateData.active = active;

        await link.update(updateData, { transaction: t });

        await t.commit();
        req.transaction = null;

        res.status(200).json({
            success: true,
            data: link
        });
    } catch (error) {
        throw error;
    }
};

export const deleteShortLink = async (req, res, next) => {
    const { id } = req.params;

    const t = await database.transaction();
    req.transaction = t;

    try {
        const link = await ShortLink.findByPk(id, { transaction: t, lock: true });

        if (!link) {
            throw new ApiError(404, 'Link not found');
        }

        const allowedRoles = TYPE_ROLE_MAP[link.type];
        const userRoles = req.roles || [];
        const isAuthorized = allowedRoles.some(role => userRoles.includes(role));
        if (!isAuthorized) {
            throw new ApiError(403, 'You are not authorized to manage links of this type');
        }

        await link.destroy({ transaction: t });

        await t.commit();
        req.transaction = null;

        res.status(200).json({
            success: true,
            message: 'Link deleted successfully'
        });
    } catch (error) {
        throw error;
    }
};