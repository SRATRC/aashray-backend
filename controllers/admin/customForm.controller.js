import { CustomForm, CustomFormResponse, CardDb, Departments } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import ShortLink from '../../models/short_link.model.js';

const mapDeptToShortLinkType = (deptName) => {
    const validTypes = [
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
    const normalized = (deptName || '').toLowerCase();
    if (validTypes.includes(normalized)) {
        return normalized;
    }
    return 'office'; // Default fallback type
};
import {
    ROLE_SUPER_ADMIN,
    ROLE_ROOM_ADMIN,
    ROLE_CARD_ADMIN,
    ROLE_OFFICE_ADMIN,
    ROLE_FOOD_ADMIN,
    ROLE_ADHYAYAN_ADMIN,
    ROLE_TRAVEL_ADMIN,
    ROLE_UTSAV_ADMIN,
    ROLE_AVT_ADMIN,
    ROLE_WIFI_ADMIN,
    ROLE_GATE_ADMIN,
    ROLE_MAINTENANCE_ADMIN,
    ROLE_HOUSEKEEPING_ADMIN,
    ROLE_ELECTRICAL_ADMIN,
    ROLE_ACCOUNTS_ADMIN,
    ROLE_SMILESTONES_ADMIN
} from '../../config/constants.js';
import sequelize from '../../config/database.js';

// Maps department names (lowercase) to the admin roles that can manage forms for that department.
// superAdmin always has access and is checked separately.
const DEPT_ROLE_MAP = {
    utsav: [ROLE_UTSAV_ADMIN],
    food: [ROLE_FOOD_ADMIN],
    wifi: [ROLE_WIFI_ADMIN],
    adhyayan: [ROLE_ADHYAYAN_ADMIN],
    travel: [ROLE_TRAVEL_ADMIN],
    maintenance: [ROLE_MAINTENANCE_ADMIN],
    housekeeping: [ROLE_HOUSEKEEPING_ADMIN],
    electrical: [ROLE_ELECTRICAL_ADMIN],
    room: [ROLE_ROOM_ADMIN, ROLE_OFFICE_ADMIN],
    card: [ROLE_CARD_ADMIN, ROLE_OFFICE_ADMIN],
    accounts: [ROLE_ACCOUNTS_ADMIN],
    avt: [ROLE_AVT_ADMIN],
    gate: [ROLE_GATE_ADMIN],
    smilestone: [ROLE_SMILESTONES_ADMIN],
    office: [ROLE_OFFICE_ADMIN]
};

/**
 * Checks if a user (based on their roles) has access to manage forms for a given department.
 * superAdmin always has access.
 */
function hasAccessToDept(userRoles, deptName) {
    if (userRoles.includes(ROLE_SUPER_ADMIN)) return true;
    const key = deptName.toLowerCase();
    const allowedRoles = DEPT_ROLE_MAP[key];
    if (!allowedRoles) return false;
    return allowedRoles.some((role) => userRoles.includes(role));
}

/**
 * Returns the list of department names the user is allowed to manage based on their roles.
 */
function getAccessibleDepts(userRoles) {
    if (userRoles.includes(ROLE_SUPER_ADMIN)) return null; // null means all departments
    const depts = [];
    for (const [dept, roles] of Object.entries(DEPT_ROLE_MAP)) {
        if (roles.some((role) => userRoles.includes(role))) {
            depts.push(dept);
        }
    }
    return depts;
}

// ── Admin CRUD Operations ───────────────────────────────────────────────────

/**
 * POST /api/v1/admin/forms
 * Create a new form.
 */
export const createForm = async (req, res) => {
    const { title, description, dept_name, fields, isPublic, slug, limitOneResponse, allowEdit, showProgressBar, confirmationMessage, showSubmitAnother } = req.body;

    if (!title || !dept_name || !fields) {
        throw new ApiError(400, 'title, dept_name, and fields are required');
    }

    if (!Array.isArray(fields) || fields.length === 0) {
        throw new ApiError(400, 'fields must be a non-empty array');
    }

    // Validate each field has at minimum an id, label, and type
    for (const field of fields) {
        if (!field.id || !field.label || !field.type) {
            throw new ApiError(400, 'Each field must have id, label, and type');
        }
    }

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, dept_name)) {
        throw new ApiError(403, 'You do not have access to create forms for this department');
    }

    let slugVal = null;
    if (slug && slug.trim() !== '') {
        slugVal = slug.trim().toLowerCase();
        const slugRegex = /^[A-Za-z0-9_-]+$/;
        if (!slugRegex.test(slugVal)) {
            throw new ApiError(400, 'Invalid slug format. Slugs can only contain alphanumeric characters, hyphens, and underscores');
        }
    }

    const t = await database.transaction();
    req.transaction = t;

    try {
        if (slugVal) {
            const existingShortLink = await ShortLink.findOne({
                where: { slug: slugVal },
                transaction: t,
                lock: true
            });
            if (existingShortLink) {
                throw new ApiError(400, 'Slug already exists in short links');
            }
        }

        const form = await CustomForm.create({
            title,
            description: description || null,
            dept_name,
            fields,
            isPublic: isPublic !== undefined ? isPublic : true,
            slug: slugVal,
            limitOneResponse: limitOneResponse !== undefined ? limitOneResponse : false,
            allowEdit: allowEdit !== undefined ? allowEdit : false,
            showProgressBar: showProgressBar !== undefined ? showProgressBar : true,
            confirmationMessage: confirmationMessage || null,
            showSubmitAnother: showSubmitAnother !== undefined ? showSubmitAnother : true,
            createdBy: req.user?.username
        }, { transaction: t });

        if (slugVal) {
            await ShortLink.create({
                slug: slugVal,
                target_url: `/admin/forms/view.html?id=${form.id}`,
                type: mapDeptToShortLinkType(dept_name),
                createdBy: req.user?.username
            }, { transaction: t });
        }

        await t.commit();
        req.transaction = null;

        res.status(201).json({
            success: true,
            data: form
        });
    } catch (error) {
        if (error.name === 'SequelizeUniqueConstraintError') {
            throw new ApiError(400, 'Slug already exists');
        }
        throw error;
    }
};

/**
 * GET /api/v1/admin/forms
 * List all forms the user has access to, with response counts.
 */
export const getForms = async (req, res) => {
    const userRoles = req.roles || [];
    const accessibleDepts = getAccessibleDepts(userRoles);

    const whereClause = {};
    if (accessibleDepts !== null) {
        // Not a superAdmin; filter by accessible departments (case-insensitive)
        whereClause.dept_name = accessibleDepts.map((d) =>
            sequelize.where(
                sequelize.fn('LOWER', sequelize.col('custom_forms.dept_name')),
                d.toLowerCase()
            )
        );
        // Use Op.or for multiple departments
        if (accessibleDepts.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
    }

    const forms = await CustomForm.findAll({
        where: accessibleDepts !== null
            ? sequelize.where(
                sequelize.fn('LOWER', sequelize.col('custom_forms.dept_name')),
                { [sequelize.Sequelize.Op.in]: accessibleDepts.map((d) => d.toLowerCase()) }
            )
            : {},
        attributes: {
            include: [
                [
                    sequelize.literal(
                        '(SELECT COUNT(*) FROM custom_form_responses WHERE custom_form_responses.form_id = custom_forms.id)'
                    ),
                    'responseCount'
                ]
            ]
        },
        order: [['createdAt', 'DESC']]
    });

    res.status(200).json({
        success: true,
        data: forms
    });
};

/**
 * GET /api/v1/admin/forms/:id
 * Get a single form definition.
 */
export const getFormById = async (req, res) => {
    const { id } = req.params;

    const form = await CustomForm.findByPk(id);
    if (!form) {
        throw new ApiError(404, 'Form not found');
    }

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, form.dept_name)) {
        throw new ApiError(403, 'You do not have access to this form');
    }

    res.status(200).json({
        success: true,
        data: form
    });
};

/**
 * PUT /api/v1/admin/forms/:id
 * Update a form's configuration.
 */
export const updateForm = async (req, res) => {
    const { id } = req.params;
    const { title, description, fields, status, isPublic, slug, limitOneResponse, allowEdit, showProgressBar, confirmationMessage, showSubmitAnother } = req.body;

    const t = await database.transaction();
    req.transaction = t;

    try {
        const form = await CustomForm.findByPk(id, { transaction: t, lock: true });
        if (!form) {
            throw new ApiError(404, 'Form not found');
        }

        const userRoles = req.roles || [];
        if (!hasAccessToDept(userRoles, form.dept_name)) {
            throw new ApiError(403, 'You do not have access to this form');
        }

        if (fields) {
            if (!Array.isArray(fields) || fields.length === 0) {
                throw new ApiError(400, 'fields must be a non-empty array');
            }
            for (const field of fields) {
                if (!field.id || !field.label || !field.type) {
                    throw new ApiError(400, 'Each field must have id, label, and type');
                }
            }
        }

        let newSlug = null;
        if (slug !== undefined) {
            if (slug && slug.trim() !== '') {
                newSlug = slug.trim().toLowerCase();
                const slugRegex = /^[A-Za-z0-9_-]+$/;
                if (!slugRegex.test(newSlug)) {
                    throw new ApiError(400, 'Invalid slug format. Slugs can only contain alphanumeric characters, hyphens, and underscores');
                }
            }
        }

        const updateData = {};
        if (title !== undefined) updateData.title = title;
        if (description !== undefined) updateData.description = description;
        if (fields !== undefined) updateData.fields = fields;
        if (status !== undefined) updateData.status = status;
        if (isPublic !== undefined) updateData.isPublic = isPublic;
        if (limitOneResponse !== undefined) updateData.limitOneResponse = limitOneResponse;
        if (allowEdit !== undefined) updateData.allowEdit = allowEdit;
        if (showProgressBar !== undefined) updateData.showProgressBar = showProgressBar;
        if (confirmationMessage !== undefined) updateData.confirmationMessage = confirmationMessage;
        if (showSubmitAnother !== undefined) updateData.showSubmitAnother = showSubmitAnother;

        // If slug is updated
        if (slug !== undefined) {
            const oldSlug = form.slug;
            if (newSlug !== oldSlug) {
                // If old slug existed, delete or update it
                if (oldSlug) {
                    await ShortLink.destroy({
                        where: { slug: oldSlug },
                        transaction: t
                    });
                }

                // If new slug is provided, check uniqueness and create it
                if (newSlug) {
                    const existingShortLink = await ShortLink.findOne({
                        where: { slug: newSlug },
                        transaction: t,
                        lock: true
                    });
                    if (existingShortLink) {
                        throw new ApiError(400, 'Slug already exists in short links');
                    }

                    await ShortLink.create({
                        slug: newSlug,
                        target_url: `/admin/forms/view.html?id=${form.id}`,
                        type: mapDeptToShortLinkType(form.dept_name),
                        createdBy: req.user?.username
                    }, { transaction: t });
                }

                updateData.slug = newSlug;
            }
        }

        await form.update(updateData, { transaction: t });

        await t.commit();
        req.transaction = null;

        res.status(200).json({
            success: true,
            data: form
        });
    } catch (error) {
        throw error;
    }
};

/**
 * DELETE /api/v1/admin/forms/:id
 * Delete a form and all its responses.
 */
export const deleteForm = async (req, res) => {
    const { id } = req.params;

    const t = await database.transaction();
    req.transaction = t;

    try {
        const form = await CustomForm.findByPk(id, { transaction: t, lock: true });
        if (!form) {
            throw new ApiError(404, 'Form not found');
        }

        const userRoles = req.roles || [];
        if (!hasAccessToDept(userRoles, form.dept_name)) {
            throw new ApiError(403, 'You do not have access to this form');
        }

        // Delete short link if exists
        if (form.slug) {
            await ShortLink.destroy({
                where: { slug: form.slug },
                transaction: t
            });
        }

        // Delete all responses first, then the form
        await CustomFormResponse.destroy({
            where: { form_id: id },
            transaction: t
        });

        await form.destroy({ transaction: t });

        await t.commit();
        req.transaction = null;

        res.status(200).json({
            success: true,
            message: 'Form deleted successfully'
        });
    } catch (error) {
        throw error;
    }
};

/**
 * GET /api/v1/admin/forms/:id/responses
 * Get all responses for a form.
 */
export const getFormResponses = async (req, res) => {
    const { id } = req.params;

    const form = await CustomForm.findByPk(id);
    if (!form) {
        throw new ApiError(404, 'Form not found');
    }

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, form.dept_name)) {
        throw new ApiError(403, 'You do not have access to this form');
    }

    const responses = await CustomFormResponse.findAll({
        where: { form_id: id },
        include: [
            {
                model: CardDb,
                as: 'respondent',
                attributes: ['cardno', 'issuedto', 'mobno', 'email']
            }
        ],
        order: [['submittedAt', 'DESC']]
    });

    res.status(200).json({
        success: true,
        data: {
            form: {
                id: form.id,
                title: form.title,
                fields: form.fields
            },
            responses
        }
    });
};

// ── Public / Client Facing ──────────────────────────────────────────────────

/**
 * GET /api/v1/forms/:id
 * Public endpoint to get form schema for rendering.
 */
export const getPublicForm = async (req, res) => {
    const { id } = req.params;

    const form = await CustomForm.findOne({
        where: { id, status: 'active' },
        attributes: ['id', 'title', 'description', 'fields', 'isPublic', 'dept_name', 'slug', 'limitOneResponse', 'allowEdit', 'showProgressBar', 'confirmationMessage', 'showSubmitAnother']
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    res.status(200).json({
        success: true,
        data: form
    });
};

/**
 * POST /api/v1/forms/:id/submit
 * Submit a response to a form.
 */
export const submitFormResponse = async (req, res) => {
    const { id } = req.params;
    const { responses, cardno } = req.body;

    if (!responses || typeof responses !== 'object') {
        throw new ApiError(400, 'responses object is required');
    }

    const form = await CustomForm.findOne({
        where: { id, status: 'active' }
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    // Validate required fields
    const fields = form.fields;
    for (const field of fields) {
        if (field.required) {
            const answer = responses[field.id];
            if (answer === undefined || answer === null || answer === '') {
                throw new ApiError(400, `"${field.label}" is required`);
            }
        }
    }

    // If the form is not public, a cardno should be provided
    if (!form.isPublic && !cardno) {
        throw new ApiError(400, 'cardno is required for this form');
    }

    // If cardno is provided, verify it exists
    if (cardno) {
        const card = await CardDb.findOne({ where: { cardno } });
        if (!card) {
            throw new ApiError(404, 'Invalid card number');
        }
    }

    // Check limit to 1 response for authenticated users
    if (form.limitOneResponse && cardno) {
        const existing = await CustomFormResponse.findOne({
            where: { form_id: parseInt(id), cardno }
        });
        if (existing) {
            throw new ApiError(400, 'You have already submitted a response to this form');
        }
    }

    const submission = await CustomFormResponse.create({
        form_id: parseInt(id),
        cardno: cardno || null,
        responses,
        submittedAt: new Date()
    });

    res.status(201).json({
        success: true,
        message: 'Response submitted successfully',
        data: { id: submission.id }
    });
};

/**
 * GET /api/v1/forms/:id/responses/:responseId
 * Public endpoint to fetch a single response for editing.
 */
export const getPublicResponse = async (req, res) => {
    const { id, responseId } = req.params;

    const form = await CustomForm.findOne({
        where: { id, status: 'active' }
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    if (!form.allowEdit) {
        throw new ApiError(403, 'Editing responses is not allowed for this form');
    }

    const response = await CustomFormResponse.findOne({
        where: { id: responseId, form_id: id }
    });

    if (!response) {
        throw new ApiError(404, 'Response not found');
    }

    res.status(200).json({
        success: true,
        data: response
    });
};

/**
 * POST /api/v1/forms/:id/responses/:responseId
 * Public endpoint to update an existing response.
 */
export const updatePublicResponse = async (req, res) => {
    const { id, responseId } = req.params;
    const { responses, cardno } = req.body;

    if (!responses || typeof responses !== 'object') {
        throw new ApiError(400, 'responses object is required');
    }

    const form = await CustomForm.findOne({
        where: { id, status: 'active' }
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    if (!form.allowEdit) {
        throw new ApiError(403, 'Editing responses is not allowed for this form');
    }

    const response = await CustomFormResponse.findOne({
        where: { id: responseId, form_id: id }
    });

    if (!response) {
        throw new ApiError(404, 'Response not found');
    }

    // Verify card number matches original submission if authenticated
    if (!form.isPublic) {
        if (response.cardno !== cardno) {
            throw new ApiError(403, 'Card number does not match original submission');
        }
    }

    // Validate required fields
    const fields = form.fields;
    for (const field of fields) {
        if (field.required) {
            const answer = responses[field.id];
            if (answer === undefined || answer === null || answer === '') {
                throw new ApiError(400, `"${field.label}" is required`);
            }
        }
    }

    await response.update({
        responses,
        updatedAt: new Date()
    });

    res.status(200).json({
        success: true,
        message: 'Response updated successfully',
        data: { id: response.id }
    });
};
