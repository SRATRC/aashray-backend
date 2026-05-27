import ShortLink from '../../models/short_link.model.js';

export const createShortLink = async (req, res, next) => {
    try {
        const { slug, target_url, type } = req.body;

        if (!slug || !target_url) {
            return res.status(400).json({
                success: false,
                message: 'slug and target_url are required'
            });
        }

        const existing = await ShortLink.findOne({
            where: { slug }
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Slug already exists'
            });
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
    } catch (error) {
        next(error);
    }
};

export const getShortLinksByType =
    async (
        req,
        res,
        next,
        type
    ) => {

        try {

            const links =
                await ShortLink.findAll({

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

        } catch (error) {

            next(error);
        }
    };

export const redirectShortLink = async (req, res, next) => {
    try {
        const { slug } = req.params;

        const link = await ShortLink.findOne({
            where: {
                slug,
                active: true
            }
        });

        if (!link) {
            return res.status(404).send('Link not found');
        }

        await link.increment('click_count');

        return res.redirect(link.target_url);
    } catch (error) {
        next(error);
    }
};

export const updateShortLink = async (req, res, next) => {
    try {
        const { id } = req.params;

        const link = await ShortLink.findByPk(id);

        if (!link) {
            return res.status(404).json({
                success: false,
                message: 'Link not found'
            });
        }

        await link.update(req.body);

        res.status(200).json({
            success: true,
            data: link
        });
    } catch (error) {
        next(error);
    }
};

export const deleteShortLink = async (req, res, next) => {
    try {
        const { id } = req.params;

        const link = await ShortLink.findByPk(id);

        if (!link) {
            return res.status(404).json({
                success: false,
                message: 'Link not found'
            });
        }

        await link.destroy();

        res.status(200).json({
            success: true,
            message: 'Link deleted successfully'
        });
    } catch (error) {
        next(error);
    }
};