import ShortLink from '../../models/short_link.model.js';
import ApiError from '../../utils/ApiError.js';

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

export const createShortLink = async (req, res, next) => {
    const { slug, target_url, type } = req.body;

    if (!slug || !target_url) {
        throw new ApiError(400, 'slug and target_url are required');
    }

    if (!VALID_TYPES.includes(type)) {
        throw new ApiError(400, `Invalid link type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const existing = await ShortLink.findOne({
        where: { slug }
    });

    if (existing) {
        throw new ApiError(400, 'Slug already exists');
    }

    const link = await ShortLink.create({
        slug,
        target_url,
        type
    });

    res.status(201).json({
        success: true,
        data: link
    });
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
    const { type } = req.body;

    if (type && !VALID_TYPES.includes(type)) {
        throw new ApiError(400, `Invalid link type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const link = await ShortLink.findByPk(id);

    if (!link) {
        throw new ApiError(404, 'Link not found');
    }

    await link.update(req.body);

    res.status(200).json({
        success: true,
        data: link
    });
};

export const deleteShortLink = async (req, res, next) => {
    const { id } = req.params;

    const link = await ShortLink.findByPk(id);

    if (!link) {
        throw new ApiError(404, 'Link not found');
    }

    await link.destroy();

    res.status(200).json({
        success: true,
        message: 'Link deleted successfully'
    });
};