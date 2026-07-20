import express from 'express';

const router = express.Router();

import {
    getPublicForm,
    submitFormResponse,
    getPublicResponse,
    updatePublicResponse
} from '../../controllers/admin/customForm.controller.js';

import CatchAsync from '../../utils/CatchAsync.js';

// Public route - get form schema for rendering
router.get('/:id', CatchAsync(getPublicForm));

// Public route - submit a form response
router.post('/:id/submit', CatchAsync(submitFormResponse));

// Public routes for response editing
router.get('/:id/responses/:responseId', CatchAsync(getPublicResponse));
router.post('/:id/responses/:responseId', CatchAsync(updatePublicResponse));

export default router;
