import express from 'express';
import CatchAsync from '../../utils/CatchAsync.js';

const router = express.Router();

import {
    redirectShortLink
} from '../../controllers/admin/shortLink.controller.js';

router.get('/go/:slug', CatchAsync(redirectShortLink));

export default router;