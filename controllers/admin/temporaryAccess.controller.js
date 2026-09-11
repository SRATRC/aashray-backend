import jwt from 'jsonwebtoken';
import ShortLink from '../../models/short_link.model.js';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import { ROLE_UTSAV_READ_ONLY, ROLE_ADHYAYAN_READ_ONLY } from '../../config/constants.js';

const ADMIN_DOMAIN = 'https://aashray.vitraagvigyaan.org';

const SLUG_REGEX = /^[A-Za-z0-9_-]+$/;

/**
 * Generate a temporary signed access link + shortlink
 * Restricted to superAdmin
 */
export const generateTemporaryAccessLink = async (req, res) => {
    const {
        resource = 'utsav_report',
        scope = {},
        targetPath,
        slug,
        days = 14,
        notes = '',
        role: customRole
    } = req.body;

    if (!slug || !slug.trim()) {
        throw new ApiError(400, 'Slug is required');
    }

    const trimmedSlug = slug.trim();
    if (!SLUG_REGEX.test(trimmedSlug)) {
        throw new ApiError(400, 'Invalid slug format. Use only letters, numbers, hyphens, and underscores');
    }

    let validDays = 14;
    let tokenExpirySeconds;
    let expiresAtDate;

    if (req.body.expiresAt) {
        expiresAtDate = new Date(req.body.expiresAt);
        // If date-only string like YYYY-MM-DD, set to end of day (23:59:59)
        if (typeof req.body.expiresAt === 'string' && req.body.expiresAt.length === 10) {
            expiresAtDate.setHours(23, 59, 59, 999);
        }
        const diffMs = expiresAtDate.getTime() - Date.now();
        if (isNaN(diffMs) || diffMs <= 0) {
            throw new ApiError(400, 'Expiration date must be in the future');
        }
        tokenExpirySeconds = Math.floor(diffMs / 1000);
        validDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000));
    } else {
        validDays = parseInt(days, 10);
        if (isNaN(validDays) || validDays < 1 || validDays > 365) {
            throw new ApiError(400, 'Validity days must be a number between 1 and 365');
        }
        tokenExpirySeconds = validDays * 24 * 60 * 60;
        expiresAtDate = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);
    }

    // Determine target admin path and role based on resource preset or provided values
    let resolvedPath = targetPath;
    let linkType = 'utsav';
    let role = customRole || ROLE_UTSAV_READ_ONLY;

    if (resource === 'utsav_report') {
        resolvedPath = 'utsav/utsavReport.html';
        linkType = 'utsav';
        role = ROLE_UTSAV_READ_ONLY;
    } else if (resource === 'adhyayan_report') {
        resolvedPath = 'adhyayan/adhyayanReport.html';
        linkType = 'adhyayan';
        role = ROLE_ADHYAYAN_READ_ONLY;
    } else if (!resolvedPath) {
        throw new ApiError(400, 'targetPath is required for custom resources');
    }

    // Clean up path: strip leading /admin/ or /
    resolvedPath = resolvedPath.replace(/^\/?(admin\/)?/, '');

    // Build JWT payload
    const payload = {
        type: 'temporary_share_access',
        resource,
        scope,
        role,
        notes: notes || undefined,
        createdBy: req.user?.username || 'superAdmin'
    };

    // For backwards and direct compatibility with utsav report endpoints
    if (scope.utsavId) payload.utsavId = scope.utsavId;
    if (scope.location) payload.location = scope.location;

    const token = jwt.sign(payload, process.env.SECRET, {
        expiresIn: tokenExpirySeconds
    });

    // Construct full target URL dynamically from all scope parameters
    const queryParams = new URLSearchParams();
    for (const [key, val] of Object.entries(scope)) {
        if (val !== undefined && val !== null && val !== '') {
            queryParams.set(key, val);
        }
    }
    queryParams.set('token', token);

    const fullTargetUrl = `${ADMIN_DOMAIN}/admin/${resolvedPath}?${queryParams.toString()}`;
    const shortUrl = `${ADMIN_DOMAIN}/go/${trimmedSlug}`;
    const expiresAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);

    // Save or update in short_links table
    const [linkRecord, created] = await ShortLink.findOrCreate({
        where: { slug: trimmedSlug },
        defaults: {
            slug: trimmedSlug,
            target_url: fullTargetUrl,
            type: linkType,
            active: true,
            createdBy: req.user?.username || 'superAdmin'
        }
    });

    if (!created) {
        linkRecord.target_url = fullTargetUrl;
        linkRecord.type = linkType;
        linkRecord.active = true;
        linkRecord.createdBy = req.user?.username || linkRecord.createdBy;
        await linkRecord.save();
    }

    res.status(200).json({
        success: true,
        message: 'Temporary access link generated successfully',
        data: {
            slug: trimmedSlug,
            shortUrl,
            fullTargetUrl,
            resource,
            scope,
            days: validDays,
            expiresAt: expiresAt.toISOString(),
            isNew: created
        }
    });
};

/**
 * List temporary access shortlinks
 */
export const listTemporaryAccessLinks = async (req, res) => {
    const { Op } = (await import('sequelize')).default;

    // Fetch all shortlinks that contain an embedded access token
    const links = await ShortLink.findAll({
        where: {
            target_url: { [Op.like]: '%token=%' }
        },
        order: [['createdAt', 'DESC']],
        limit: 100
    });

    const parsedLinks = links.map((link) => {
        let isExpired = false;
        let expiresAt = null;
        let resource = link.type;
        let scope = {};

        try {
            const url = new URL(link.target_url);
            const token = url.searchParams.get('token');
            if (token) {
                const decoded = jwt.decode(token);
                if (decoded && decoded.exp) {
                    expiresAt = new Date(decoded.exp * 1000).toISOString();
                    isExpired = decoded.exp * 1000 < Date.now();
                }
                if (decoded?.resource) resource = decoded.resource;
                if (decoded?.scope) scope = decoded.scope;
                if (decoded?.location && !scope.location) scope.location = decoded.location;
                if (decoded?.utsavId && !scope.utsavId) scope.utsavId = decoded.utsavId;
            }
        } catch {
            // Ignore URL parsing errors for old/custom static links
        }

        return {
            id: link.id,
            slug: link.slug,
            shortUrl: `${ADMIN_DOMAIN}/go/${link.slug}`,
            target_url: link.target_url,
            type: link.type,
            resource,
            scope,
            active: link.active,
            click_count: link.click_count,
            createdBy: link.createdBy,
            createdAt: link.createdAt,
            expiresAt,
            isExpired
        };
    });

    res.status(200).json({
        success: true,
        data: parsedLinks
    });
};

/**
 * Toggle active/inactive status of a shortlink
 */
export const toggleTemporaryAccessLink = async (req, res) => {
    const { id } = req.params;

    const link = await ShortLink.findByPk(id);
    if (!link) {
        throw new ApiError(404, 'Shortlink not found');
    }

    link.active = !link.active;
    await link.save();

    res.status(200).json({
        success: true,
        message: `Shortlink ${link.active ? 'activated' : 'deactivated'} successfully`,
        data: {
            id: link.id,
            slug: link.slug,
            active: link.active
        }
    });
};
