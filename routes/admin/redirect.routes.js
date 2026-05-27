import express from 'express';

const router = express.Router();

import {
    redirectShortLink
} from '../../controllers/admin/shortLink.controller.js';

router.get('/go/:slug', redirectShortLink);

export default router;