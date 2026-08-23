import { CustomForm, CustomFormResponse, CustomFormDraft, CardDb, Departments, CustomFormOtpAllowlist, UtsavDb, ShibirDb, UtsavBooking, ShibirBookingDb, FlatDb } from '../../models/associations.js';
import ApiError from '../../utils/ApiError.js';
import database from '../../config/database.js';
import ShortLink from '../../models/short_link.model.js';
import { handleFormSubmissionActions } from '../../utils/customFormActions.js';
import CoordinatorOtp from '../../models/coordinatorOtp.model.js';
import { sendCoordinatorOtp } from '../../helpers/sendCoordinatorOtp.js';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import sendMail from '../../utils/sendMail.js';
import crypto from 'crypto';
import Sequelize from 'sequelize';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { title, description, dept_name, fields, isPublic, authType, slug, limitOneResponse, allowEdit, showProgressBar, confirmationMessage, showSubmitAnother, section1Action, themeColor, expiresAt, closeMessage, maxResponses, requireOtp, requireRegistration, event_id, event_name, event_type } = req.body;

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
            authType: authType || 'cardno',
            slug: slugVal,
            limitOneResponse: limitOneResponse !== undefined ? limitOneResponse : false,
            allowEdit: allowEdit !== undefined ? allowEdit : false,
            showProgressBar: showProgressBar !== undefined ? showProgressBar : true,
            confirmationMessage: confirmationMessage || null,
            showSubmitAnother: showSubmitAnother !== undefined ? showSubmitAnother : true,
            section1Action: section1Action || 'next',
            themeColor: themeColor || '#204060',
            expiresAt: expiresAt || null,
            closeMessage: closeMessage || null,
            maxResponses: maxResponses ? parseInt(maxResponses) : null,
            requireOtp: requireOtp !== undefined ? requireOtp : false,
            requireRegistration: requireRegistration !== undefined ? requireRegistration : false,
            event_id: event_id ? parseInt(event_id, 10) : null,
            event_name: event_name || null,
            event_type: event_type || null,

            createdBy: req.user?.username
        }, { transaction: t });

        if (slugVal) {
            await ShortLink.create({
                slug: slugVal,
                target_url: `${FRONTEND_URL}/admin/forms/view.html?id=${form.id}`,
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
        if (accessibleDepts.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }
        whereClause[sequelize.Sequelize.Op.or] = accessibleDepts.map((d) =>
            sequelize.where(
                sequelize.fn('LOWER', sequelize.col('custom_forms.dept_name')),
                d.toLowerCase()
            )
        );
    }

    const forms = await CustomForm.findAll({
        where: whereClause,
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

    const allowlist = await CustomFormOtpAllowlist.findAll({
        where: { form_id: id, status: 'active' },
        order: [['id', 'ASC']]
    });

    const enrichedAllowlist = await Promise.all(allowlist.map(async (entry) => {
        const cleanMob = entry.mobno ? String(entry.mobno).replace(/\D/g, '').slice(-10) : null;
        const parsedMob = cleanMob ? parseInt(cleanMob, 10) : null;
        const card = parsedMob ? await CardDb.findOne({
            where: { mobno: parsedMob },
            attributes: ['cardno', 'issuedto', 'center', 'email', 'res_status']
        }) : null;

        return {
            id: entry.id,
            form_id: entry.form_id,
            mobno: cleanMob || null,
            cardno: card ? card.cardno : null,
            department: entry.department,
            status: entry.status,
            name: card ? card.issuedto : (cleanMob ? 'Ashram Member' : '— (Pending assignment)'),
            center: card ? card.center : null,
            res_status: card ? card.res_status : null
        };
    }));

    const formObj = form.toJSON ? form.toJSON() : JSON.parse(JSON.stringify(form));
    formObj.otpAllowlist = enrichedAllowlist;

    res.status(200).json({
        success: true,
        data: formObj
    });
};

/**
 * PUT /api/v1/admin/forms/:id
 * Update a form's configuration.
 */
export const updateForm = async (req, res) => {
    const { id } = req.params;
    const { title, description, fields, status, isPublic, authType, slug, limitOneResponse, allowEdit, showProgressBar, confirmationMessage, showSubmitAnother, section1Action, themeColor, expiresAt, closeMessage, maxResponses, requireOtp } = req.body;

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
        if (req.body.dept_name !== undefined) updateData.dept_name = req.body.dept_name;
        if (description !== undefined) updateData.description = description;
        if (fields !== undefined) updateData.fields = fields;
        if (status !== undefined) updateData.status = status;
        if (isPublic !== undefined) updateData.isPublic = isPublic;
        if (authType !== undefined) updateData.authType = authType;
        if (limitOneResponse !== undefined) updateData.limitOneResponse = limitOneResponse;
        if (allowEdit !== undefined) updateData.allowEdit = allowEdit;
        if (showProgressBar !== undefined) updateData.showProgressBar = showProgressBar;
        if (confirmationMessage !== undefined) updateData.confirmationMessage = confirmationMessage;
        if (showSubmitAnother !== undefined) updateData.showSubmitAnother = showSubmitAnother;
        if (section1Action !== undefined) updateData.section1Action = section1Action;
        if (themeColor !== undefined) updateData.themeColor = themeColor;
        if (expiresAt !== undefined) updateData.expiresAt = expiresAt || null;
        if (closeMessage !== undefined) updateData.closeMessage = closeMessage || null;
        if (maxResponses !== undefined) updateData.maxResponses = maxResponses ? parseInt(maxResponses) : null;
        if (requireOtp !== undefined) updateData.requireOtp = requireOtp;
        if (req.body.requireRegistration !== undefined) updateData.requireRegistration = req.body.requireRegistration;
        if (req.body.event_id !== undefined) updateData.event_id = req.body.event_id ? parseInt(req.body.event_id, 10) : null;
        if (req.body.event_name !== undefined) updateData.event_name = req.body.event_name || null;
        if (req.body.event_type !== undefined) updateData.event_type = req.body.event_type || null;


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
                        target_url: `${FRONTEND_URL}/admin/forms/view.html?id=${form.id}`,
                        type: mapDeptToShortLinkType(form.dept_name),
                        createdBy: req.user?.username
                    }, { transaction: t });
                }

                updateData.slug = newSlug;
            }
        }

        await form.update(updateData, { transaction: t });

        if (req.body.otpAllowlist && Array.isArray(req.body.otpAllowlist)) {
            await CustomFormOtpAllowlist.destroy({ where: { form_id: id }, transaction: t });
            for (const item of req.body.otpAllowlist) {
                const clean = item.mobno ? String(item.mobno).replace(/\D/g, '').slice(-10) : null;
                const dept = item.department ? String(item.department).trim() : null;
                let cardno = item.cardno ? String(item.cardno).trim() : null;
                if (clean && clean.length === 10 && !cardno) {
                    const card = await CardDb.findOne({
                        where: { mobno: parseInt(clean, 10) },
                        attributes: ['cardno'],
                        transaction: t
                    });
                    if (card) cardno = card.cardno;
                }
                if (dept || (clean && clean.length === 10)) {
                    await CustomFormOtpAllowlist.create({
                        form_id: parseInt(id, 10),
                        mobno: (clean && clean.length === 10) ? clean : null,
                        cardno: cardno || null,
                        department: dept,
                        status: 'active',
                        createdBy: req.user?.username || 'admin'
                    }, { transaction: t });
                }
            }
        }

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

        // Delete all responses and in-progress drafts first, then the form
        await CustomFormResponse.destroy({
            where: { form_id: id },
            transaction: t
        });

        await CustomFormDraft.destroy({
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
                attributes: ['cardno', 'issuedto', 'mobno', 'email', 'center', 'res_status']
            }
        ],
        order: [['submittedAt', 'DESC']]
    });

    // Identify the mobile field, if any
    const mobField = (form.fields || []).find(f => {
        const lbl = (f.label || '').toLowerCase();
        return lbl.includes('mob') || lbl.includes('phone') || lbl.includes('contact');
    });

    let enrichedResponses = responses;

    if (mobField) {
        // Collect indices and 10-digit clean numbers for lookup
        const mobToResponseMap = {};
        const mobNumbersToLookup = [];

        responses.forEach((resp, rIdx) => {
            // Only lookup if the respondent relation is not already loaded
            if (!resp.respondent) {
                const val = resp.responses ? resp.responses[mobField.id] : null;
                if (val) {
                    const cleaned = String(val).replace(/\D/g, '');
                    const tenDigits = cleaned.slice(-10);
                    if (tenDigits.length === 10) {
                        const parsedNum = parseInt(tenDigits, 10);
                        if (!isNaN(parsedNum)) {
                            mobToResponseMap[rIdx] = tenDigits;
                            mobNumbersToLookup.push(parsedNum);
                            mobNumbersToLookup.push(parseInt('91' + tenDigits, 10)); // Handle with country code 91
                        }
                    }
                }
            }
        });

        if (mobNumbersToLookup.length > 0) {
            const cards = await CardDb.findAll({
                where: {
                    mobno: mobNumbersToLookup
                },
                attributes: ['cardno', 'issuedto', 'mobno', 'email', 'center', 'res_status']
            });

            const cardMapByMob = {};
            cards.forEach(card => {
                const cleanMob = String(card.mobno).replace(/\D/g, '').slice(-10);
                cardMapByMob[cleanMob] = card;
            });

            enrichedResponses = responses.map((resp, rIdx) => {
                const respJson = resp.toJSON();
                if (!respJson.respondent) {
                    const tenDigits = mobToResponseMap[rIdx];
                    if (tenDigits && cardMapByMob[tenDigits]) {
                        const card = cardMapByMob[tenDigits];
                        respJson.respondent = {
                            cardno: card.cardno,
                            issuedto: card.issuedto,
                            mobno: card.mobno,
                            email: card.email,
                            center: card.center,
                            res_status: card.res_status
                        };
                    }
                }
                return respJson;
            });
        }
    }

    res.status(200).json({
        success: true,
        data: {
            form: {
                id: form.id,
                title: form.title,
                fields: form.fields
            },
            responses: enrichedResponses
        }
    });
};

/**
 * DELETE /api/v1/admin/forms/:id/responses/:responseId
 * Delete a single response to a form.
 */
export const deleteFormResponse = async (req, res) => {
    const { id, responseId } = req.params;

    const form = await CustomForm.findByPk(id);
    if (!form) {
        throw new ApiError(404, 'Form not found');
    }

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, form.dept_name)) {
        throw new ApiError(403, 'You do not have access to this form');
    }

    const response = await CustomFormResponse.findOne({
        where: { id: responseId, form_id: id }
    });

    if (!response) {
        throw new ApiError(404, 'Response not found');
    }

    await response.destroy();

    res.status(200).json({
        success: true,
        message: 'Response deleted successfully'
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
        attributes: ['id', 'title', 'description', 'fields', 'isPublic', 'authType', 'dept_name', 'slug', 'limitOneResponse', 'allowEdit', 'showProgressBar', 'confirmationMessage', 'showSubmitAnother', 'section1Action', 'themeColor', 'expiresAt', 'closeMessage', 'maxResponses', 'requireOtp']
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    // Check if form is closed (by expiry date or maximum submissions count)
    const responseCount = await CustomFormResponse.count({ where: { form_id: form.id } });
    let isClosed = false;
    let closeReason = '';

    if (form.expiresAt && new Date() > new Date(form.expiresAt)) {
        isClosed = true;
        closeReason = 'expired';
    } else if (form.maxResponses && responseCount >= form.maxResponses) {
        isClosed = true;
        closeReason = 'limit_reached';
    }

    const responseData = {
        ...form.toJSON(),
        isClosed,
        closeReason,
        currentResponseCount: responseCount
    };

    res.status(200).json({
        success: true,
        data: responseData
    });
};

/**
 * POST /api/v1/forms/:id/submit
 * Submit a response to a form.
 */
export const submitFormResponse = async (req, res) => {
    const { id } = req.params;
    const { responses, cardno, mobno, email } = req.body;

    if (!responses || typeof responses !== 'object') {
        throw new ApiError(400, 'responses object is required');
    }

    let normalizedEmail = null;
    if (email !== undefined && email !== null && String(email).trim() !== '') {
        normalizedEmail = String(email).trim().toLowerCase();
        if (!EMAIL_REGEX.test(normalizedEmail)) {
            throw new ApiError(400, 'A valid email address is required');
        }
    }

    const form = await CustomForm.findOne({
        where: { id, status: 'active' }
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    // Expiry and max limit checks
    const responseCount = await CustomFormResponse.count({ where: { form_id: parseInt(id) } });
    if (form.expiresAt && new Date() > new Date(form.expiresAt)) {
        throw new ApiError(403, form.closeMessage || 'This form has expired and is no longer accepting responses');
    }
    if (form.maxResponses && responseCount >= form.maxResponses) {
        throw new ApiError(403, form.closeMessage || 'This form has reached its response limit and is no longer accepting responses');
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

    validateDateConstraints(form.fields, responses);
    validateShortAnswerLimits(form.fields, responses);

    // Validate number field min/max constraints
    for (const field of form.fields) {
        if (field.type === 'number' && responses[field.id] !== undefined && responses[field.id] !== null && String(responses[field.id]).trim() !== '') {
            const num = parseFloat(responses[field.id]);
            if (isNaN(num)) {
                throw new ApiError(400, `"${field.label}" must be a valid number`);
            }
            if (field.min !== undefined && field.min !== null && num < parseFloat(field.min)) {
                throw new ApiError(400, `"${field.label}" must be at least ${field.min}`);
            }
            if (field.max !== undefined && field.max !== null && num > parseFloat(field.max)) {
                throw new ApiError(400, `"${field.label}" cannot exceed ${field.max}`);
            }
        }
    }

    // Validate Flat Host Guest Details: If guest capacity > 0, every guest must have a valid mobile & cardno
    const isFlatHost = (form.event_type === 'flat_host' || (form.title || '').toLowerCase().includes('flat host'));
    if (isFlatHost) {
        const guestCap = parseInt(responses.guest_capacity_count, 10) || 0;
        const guestList = Array.isArray(responses.guests_list) ? responses.guests_list : [];
        if (guestCap > 0) {
            if (guestList.length < guestCap || guestList.some(g => !g.mobno || !g.cardno)) {
                throw new ApiError(400, `Please provide valid, confirmed mobile numbers for all ${guestCap} guest(s)`);
            }

            const guestCardNos = guestList.map(g => String(g.cardno).trim()).filter(Boolean);

            // Check for duplicates
            const uniqueCardNos = new Set(guestCardNos);
            if (uniqueCardNos.size !== guestCardNos.length) {
                throw new ApiError(400, 'Duplicate guests found in your guest list. Each guest can only be listed once.');
            }
        }
    }

    let resolvedCardNo = null;

    // Authenticate user if not public
    if (!form.isPublic) {
        if (form.authType === 'mobno') {
            if (!mobno) {
                throw new ApiError(400, 'Mobile number is required for this form');
            }
            const cleanMob = String(mobno).replace(/\D/g, '').slice(-10);
            if (cleanMob.length !== 10) {
                throw new ApiError(400, 'Invalid mobile number format. Please enter a 10-digit number.');
            }
            const parsedMob = parseInt(cleanMob, 10);
            const card = await CardDb.findOne({ where: { mobno: parsedMob } });
            if (!card) {
                throw new ApiError(404, 'Mobile number is not registered');
            }
            resolvedCardNo = card.cardno;

            // Enforce allowlist restriction if configured for this form
            const configuredAllowlistCount = await CustomFormOtpAllowlist.count({
                where: {
                    form_id: form.id,
                    status: 'active',
                    mobno: { [Sequelize.Op.ne]: null }
                }
            });
            if (configuredAllowlistCount > 0) {
                const isAllowed = await CustomFormOtpAllowlist.findOne({
                    where: { form_id: form.id, mobno: cleanMob, status: 'active' }
                });
                if (!isAllowed) {
                    throw new ApiError(403, 'This mobile number is not authorized to submit this form');
                }
            }

            // OTP gate — must come AFTER mobno is validated
            if (form.requireOtp) {
                await assertOtpVerified(String(cleanMob), form);
            }
        } else {
            // Default cardno auth
            if (!cardno) {
                throw new ApiError(400, 'Card number is required for this form');
            }
            const card = await CardDb.findOne({ where: { cardno } });
            if (!card) {
                throw new ApiError(404, 'Invalid card number');
            }
            resolvedCardNo = card.cardno;
        }
    }

    // Upsert: if an authenticated user already has a response for this form,
    // update it instead of creating a duplicate row.
    let submission;
    let isUpdate = false;

    if (resolvedCardNo) {
        let existing = null;

        if (isFlatHost && responses.flatno) {
            const allFormResponses = await CustomFormResponse.findAll({
                where: { form_id: parseInt(id) },
                order: [['submittedAt', 'DESC']]
            });
            existing = allFormResponses.find(r => {
                const resp = r.responses || {};
                return String(resp.flatno || '').trim() === String(responses.flatno).trim();
            });
        } else {
            // Check if this form has a department field (e.g. Vendor / Department Seva form)
            const deptField = (form.fields || []).find(f => f.vendorRole === 'department' || f.id === 'name_of_department' || (f.label || '').toLowerCase().includes('department'));
            const targetDept = deptField && responses[deptField.id]
                ? String(responses[deptField.id]).trim().toLowerCase()
                : (responses.name_of_department ? String(responses.name_of_department).trim().toLowerCase() : (responses.department ? String(responses.department).trim().toLowerCase() : null));

            if (targetDept) {
                const allFormResponses = await CustomFormResponse.findAll({
                    where: { form_id: parseInt(id) },
                    order: [['submittedAt', 'DESC']]
                });
                existing = allFormResponses.find(r => {
                    const resp = r.responses || {};
                    return Object.values(resp).some(v => typeof v === 'string' && v.trim().toLowerCase() === targetDept);
                }) || null;
            } else {
                const existingResponses = await CustomFormResponse.findAll({
                    where: { form_id: parseInt(id), cardno: resolvedCardNo },
                    order: [['submittedAt', 'DESC']]
                });
                existing = existingResponses[0] || null;
            }
        }

        if (existing) {
            await existing.update({
                cardno: resolvedCardNo,
                responses,
                email: normalizedEmail !== null ? normalizedEmail : existing.email,
                submittedAt: new Date()
            });
            submission = existing;
            isUpdate = true;
        }
    }

    if (!submission) {
        if (form.maxResponses) {
            const freshCount = await CustomFormResponse.count({ where: { form_id: parseInt(id) } });
            if (freshCount >= form.maxResponses) {
                throw new ApiError(403, form.closeMessage || 'This form has reached its response limit and is no longer accepting responses');
            }
        }
        submission = await CustomFormResponse.create({
            form_id: parseInt(id),
            cardno: resolvedCardNo || null,
            email: normalizedEmail,
            responses,
            submittedAt: new Date()
        });
    }

    // Run any registered action hooks (non-blocking — errors are caught inside)
    await handleFormSubmissionActions(form, responses, resolvedCardNo);

    // Best-effort: a finished submission means any in-progress draft for this
    // email is no longer useful — clear it so it doesn't resurface later.
    if (normalizedEmail) {
        try {
            await CustomFormDraft.destroy({ where: { form_id: parseInt(id), email: normalizedEmail } });
        } catch (err) {
            req.log?.warn?.('Failed to clear form draft after submission', { formId: id, error: err.message });
        }
    }

    res.status(isUpdate ? 200 : 201).json({
        success: true,
        message: isUpdate ? 'Response updated successfully' : 'Response submitted successfully',
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
        where: { id: responseId, form_id: id },
        include: [
            {
                model: CardDb,
                as: 'respondent',
                attributes: ['cardno', 'issuedto', 'mobno', 'email', 'center', 'res_status']
            }
        ]
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
    const { responses, cardno, mobno, email } = req.body;

    if (!responses || typeof responses !== 'object') {
        throw new ApiError(400, 'responses object is required');
    }

    let normalizedEmail = null;
    if (email !== undefined && email !== null && String(email).trim() !== '') {
        normalizedEmail = String(email).trim().toLowerCase();
        if (!EMAIL_REGEX.test(normalizedEmail)) {
            throw new ApiError(400, 'A valid email address is required');
        }
    }

    const form = await CustomForm.findOne({
        where: { id, status: 'active' }
    });

    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    if (form.expiresAt && new Date() > new Date(form.expiresAt)) {
        throw new ApiError(403, form.closeMessage || 'This form has expired and is no longer accepting response edits');
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

    let resolvedCardNo = null;

    // Verify authentication matches original submission
    if (!form.isPublic) {
        if (form.authType === 'mobno') {
            if (!mobno) {
                throw new ApiError(400, 'Mobile number is required for this form');
            }
            const cleanMob = String(mobno).replace(/\D/g, '').slice(-10);
            if (cleanMob.length !== 10) {
                throw new ApiError(400, 'Invalid mobile number format. Please enter a 10-digit number.');
            }
            const parsedMob = parseInt(cleanMob, 10);
            const card = await CardDb.findOne({ where: { mobno: parsedMob } });
            if (!card) {
                throw new ApiError(404, 'Mobile number is not registered');
            }
            resolvedCardNo = card.cardno;
        } else {
            if (!cardno) {
                throw new ApiError(400, 'Card number is required for this form');
            }
            const card = await CardDb.findOne({ where: { cardno } });
            if (!card) {
                throw new ApiError(404, 'Invalid card number');
            }
            resolvedCardNo = card.cardno;
        }

        if (response.cardno !== resolvedCardNo) {
            throw new ApiError(403, 'Identity does not match original submission');
        }
    }

    // Stop user from submitting multiple entries for the same date if a date field exists
    const dateField = form.fields.find(f => f.type === 'date');
    if (dateField && resolvedCardNo) {
        const submittedDate = responses[dateField.id];
        if (submittedDate) {
            const existingResponses = await CustomFormResponse.findAll({
                where: {
                    form_id: parseInt(id),
                    cardno: resolvedCardNo
                }
            });
            for (const exist of existingResponses) {
                if (exist.id === parseInt(responseId)) continue;
                const existAnswers = exist.responses || {};
                if (existAnswers[dateField.id] === submittedDate) {
                    throw new ApiError(400, `You have already submitted a response for the date ${submittedDate}`);
                }
            }
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

    validateDateConstraints(form.fields, responses);
    validateShortAnswerLimits(form.fields, responses);

    await response.update({
        responses,
        email: normalizedEmail !== null ? normalizedEmail : response.email,
        updatedAt: new Date()
    });

    // Re-run action hooks on edit (e.g. tapp choice changed)
    await handleFormSubmissionActions(form, responses, resolvedCardNo);

    // Best-effort: an updated submission means any in-progress draft for this
    // email is no longer useful — clear it so it doesn't resurface later.
    if (normalizedEmail) {
        try {
            await CustomFormDraft.destroy({ where: { form_id: parseInt(id), email: normalizedEmail } });
        } catch (err) {
            req.log?.warn?.('Failed to clear form draft after response update', { formId: id, error: err.message });
        }
    }

    res.status(200).json({
        success: true,
        message: 'Response updated successfully',
        data: { id: response.id }
    });
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Formats a single field's answer for display in the "email me my response" email.
 */
function formatAnswerForEmail(answer) {
    if (answer === undefined || answer === null || answer === '') {
        return '<span style="color:#888;">(no answer)</span>';
    }
    // Guest list or array of objects
    if (Array.isArray(answer)) {
        if (!answer.length) return '<span style="color:#888;">(no answer)</span>';
        if (typeof answer[0] === 'object' && answer[0] !== null) {
            return '<div style="margin-top:4px;">' + answer.map((g, idx) => {
                const name = g.name || `Mumukshu #${idx + 1}`;
                const mob = g.mobno ? ` (${g.mobno})` : '';
                const center = g.center ? ` [${g.center}]` : '';
                return `<div style="margin:2px 0;"><strong>${idx + 1}. ${escapeHtml(name)}</strong>${escapeHtml(mob)}${escapeHtml(center)}</div>`;
            }).join('') + '</div>';
        }
        return escapeHtml(answer.join(', '));
    }
    if (typeof answer === 'object') {
        const entries = Object.entries(answer);
        if (!entries.length) return '<span style="color:#888;">(no answer)</span>';
        return '<div style="margin-top:4px;">' + entries.map(([key, val]) => {
            if (val === null || val === undefined) return `<div><strong>${escapeHtml(key)}:</strong> —</div>`;
            if (typeof val === 'object' && !Array.isArray(val)) {
                const sub = Object.entries(val).map(([k, v]) => `${k} (${v})`).join(', ');
                return `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(sub)}</div>`;
            }
            if (Array.isArray(val)) {
                return `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(val.join(', '))}</div>`;
            }
            return `<div><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(val))}</div>`;
        }).join('') + '</div>';
    }
    return escapeHtml(String(answer)).replace(/\n/g, '<br>');
}

/**
 * POST /api/v1/forms/:id/responses/:responseId/email
 * Public endpoint — emails the respondent a copy of their submitted answers.
 */
export const emailFormResponse = async (req, res) => {
    const { id, responseId } = req.params;
    const { email } = req.body;

    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
        throw new ApiError(400, 'A valid email address is required');
    }

    const form = await CustomForm.findOne({
        where: { id, status: 'active' }
    });
    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    const response = await CustomFormResponse.findOne({
        where: { id: responseId, form_id: id }
    });
    if (!response) {
        throw new ApiError(404, 'Response not found');
    }

    const qa = (form.fields || [])
        .filter((field) => field.type !== 'section')
        .map((field) => ({
            label: field.label,
            answer: formatAnswerForEmail(response.responses ? response.responses[field.id] : undefined)
        }));

    sendMail({
        email: String(email).trim(),
        subject: `Your response to "${form.title}"`,
        template: 'customFormResponseEmail',
        context: {
            formTitle: form.title,
            submittedAt: new Date(response.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
            qa
        }
    }, req.log);

    res.status(200).json({
        success: true,
        message: 'Response emailed successfully'
    });
};

/**
 * POST /api/v1/admin/forms/:id/clone
 * Duplicate form configuration and settings.
 */
export const cloneForm = async (req, res) => {
    const { id } = req.params;

    const t = await database.transaction();
    req.transaction = t;

    try {
        const sourceForm = await CustomForm.findByPk(id, { transaction: t });
        if (!sourceForm) {
            throw new ApiError(404, 'Source form not found');
        }

        const userRoles = req.roles || [];
        if (!hasAccessToDept(userRoles, sourceForm.dept_name)) {
            throw new ApiError(403, 'You do not have access to this form');
        }

        const duplicatedForm = await CustomForm.create({
            title: `${sourceForm.title} (Copy)`,
            description: sourceForm.description,
            dept_name: sourceForm.dept_name,
            fields: sourceForm.fields,
            isPublic: sourceForm.isPublic,
            authType: sourceForm.authType || 'cardno',
            status: 'inactive',
            limitOneResponse: sourceForm.limitOneResponse,
            allowEdit: sourceForm.allowEdit,
            showProgressBar: sourceForm.showProgressBar,
            confirmationMessage: sourceForm.confirmationMessage,
            showSubmitAnother: sourceForm.showSubmitAnother,
            section1Action: sourceForm.section1Action,
            themeColor: sourceForm.themeColor,
            expiresAt: sourceForm.expiresAt,
            closeMessage: sourceForm.closeMessage,
            maxResponses: sourceForm.maxResponses,
            requireOtp: sourceForm.requireOtp,
            requireRegistration: sourceForm.requireRegistration,
            event_id: sourceForm.event_id,
            event_name: sourceForm.event_name,
            event_type: sourceForm.event_type,
            createdBy: req.user?.username
        }, { transaction: t });

        await t.commit();
        req.transaction = null;

        res.status(201).json({
            success: true,
            message: 'Form cloned successfully',
            data: duplicatedForm
        });
    } catch (error) {
        throw error;
    }
};

/**
 * GET /api/v1/forms/resolve-identity
 * Resolve card/mobile number to user details (publicly accessible).
 */
export const resolveIdentity = async (req, res) => {
    const { type, value, formId } = req.query;
    if (!type || !value) {
        throw new ApiError(400, 'type and value are required');
    }

    let card = null;
    let cleanMob = null;
    if (type === 'mobno') {
        cleanMob = String(value).replace(/\D/g, '').slice(-10);
        if (cleanMob.length === 10) {
            const parsedMob = parseInt(cleanMob, 10);
            card = await CardDb.findOne({
                where: { mobno: parsedMob },
                attributes: ['cardno', 'issuedto', 'center', 'email']
            });
        }
    } else {
        card = await CardDb.findOne({
            where: { cardno: value },
            attributes: ['cardno', 'issuedto', 'center', 'email']
        });
    }

    if (!card) {
        return res.status(200).json({
            success: false,
            message: type === 'mobno' ? 'Mobile number is not registered in Ashram database' : 'Card number is not registered in Ashram database'
        });
    }

    let flatno = null;
    let confirmedResidentsCount = 0;

    if (formId) {
        try {
            const formObj = await CustomForm.findByPk(formId);
            if (formObj) {
                const isFlatHost = (formObj.event_type === 'flat_host' || (formObj.title || '').toLowerCase().includes('flat host'));
                if (isFlatHost) {
                    const flatRecord = await FlatDb.findOne({ where: { owner: card.cardno } });
                    if (!flatRecord) {
                        return res.status(200).json({
                            success: false,
                            message: 'Access restricted: Only registered flat owners can fill this form.'
                        });
                    }
                    flatno = flatRecord.flatno;

                    // Calculate permanent residents with confirmed registrations for this utsav
                    const coOwners = await FlatDb.findAll({ where: { flatno }, attributes: ['owner'] });
                    const ownerCardNos = coOwners.map(o => o.owner);

                    if (formObj.event_id) {
                        const bookings = await UtsavBooking.findAll({
                            where: {
                                utsavid: formObj.event_id,
                                cardno: { [Sequelize.Op.in]: ownerCardNos },
                                status: {
                                    [Sequelize.Op.in]: [
                                        'confirmed',
                                        'completed',
                                        'cash_completed',
                                        'checkedin',
                                        'open'
                                    ]
                                }
                            }
                        });
                        confirmedResidentsCount = bookings.length;
                    }
                } else if (formObj.requireRegistration) {
                    await assertEventRegistration(formObj, card.cardno);
                }
            }
        } catch (err) {
            return res.status(200).json({
                success: false,
                message: err.message
            });
        }
    }

    let department = null;
    let departments = [];
    if (formId && cleanMob) {
        const configuredCount = await CustomFormOtpAllowlist.count({
            where: {
                form_id: formId,
                status: 'active',
                mobno: { [Sequelize.Op.ne]: null }
            }
        });

        const allowed = await CustomFormOtpAllowlist.findAll({
            where: { form_id: formId, mobno: cleanMob, status: 'active' }
        });

        if (configuredCount > 0 && (!allowed || allowed.length === 0)) {
            return res.status(200).json({
                success: false,
                message: 'Access restricted: This mobile number is not authorized to fill out this form.'
            });
        }

        departments = [...new Set(allowed.map(a => a.department).filter(Boolean))];
        department = departments[0] || null;
    }

    // Look up Tapascharya / Tapp details for this member if available
    let tappDetails = null;
    let isPaarnaEligible = false;
    try {
        const allTappForms = await CustomForm.findAll({
            where: {
                title: { [Sequelize.Op.like]: '%Tapascharya%' },
                status: 'active'
            },
            attributes: ['id']
        });
        const tappFormIds = allTappForms.map(f => f.id);
        if (tappFormIds.length > 0) {
            const userTappResp = await CustomFormResponse.findOne({
                where: {
                    form_id: { [Sequelize.Op.in]: tappFormIds },
                    cardno: card.cardno
                },
                order: [['submittedAt', 'DESC']]
            });
            if (userTappResp && userTappResp.responses) {
                const matrix = userTappResp.responses.tapascharya_matrix || {};
                const entries = Object.entries(matrix).filter(([_, v]) => v && v !== 'Regular Meal' && v !== 'Regular Meals' && v !== 'Regular' && !String(v).toLowerCase().includes('regular'));
                if (entries.length > 0) {
                    const upvaasCount = entries.filter(([_, v]) => v === 'Upvaas').length;
                    const aayambilCount = entries.filter(([_, v]) => v === 'Aayambil').length;
                    const ekasnaCount = entries.filter(([_, v]) => String(v).includes('Ekasna')).length;
                    const biyasnaCount = entries.filter(([_, v]) => String(v).includes('Biyasna')).length;
                    const liquidCount = entries.filter(([_, v]) => String(v).includes('Liquid')).length;
                    const rasTyaagCount = entries.filter(([_, v]) => String(v).includes('Ras Tyaag')).length;

                    // Paarna eligible tap days: Upvaas, Aayambil, Ekasna, Only Liquid (excludes Biyasna & Ras Tyaag)
                    const eligibleTappDays = upvaasCount + aayambilCount + ekasnaCount + liquidCount;

                    // Check for 3 consecutive Upvaas across the 8 Paryushan dates
                    const sortedDates = ['8th Sep', '9th Sep', '10th Sep', '11th Sep', '12th Sep', '13th Sep', '14th Sep', '15th Sep'];
                    let consecutiveUpvaas = 0;
                    let has3ConsecutiveUpvaas = false;
                    for (const d of sortedDates) {
                        if (matrix[d] === 'Upvaas') {
                            consecutiveUpvaas++;
                            if (consecutiveUpvaas >= 3) {
                                has3ConsecutiveUpvaas = true;
                                break;
                            }
                        } else {
                            consecutiveUpvaas = 0;
                        }
                    }

                    isPaarnaEligible = (eligibleTappDays >= 8 || has3ConsecutiveUpvaas);

                    const parts = [];
                    if (upvaasCount > 0) parts.push(`${upvaasCount} Upvaas`);
                    if (aayambilCount > 0) parts.push(`${aayambilCount} Aayambil`);
                    if (ekasnaCount > 0) parts.push(`${ekasnaCount} Ekasna`);
                    if (biyasnaCount > 0) parts.push(`${biyasnaCount} Biyasna`);
                    if (liquidCount > 0) parts.push(`${liquidCount} Only Liquid`);
                    if (rasTyaagCount > 0) parts.push(`${rasTyaagCount} Ras Tyaag`);
                    tappDetails = parts.join(', ') || entries.map(([d, v]) => `${d}: ${v}`).join(', ');
                }
            }
        }
    } catch (e) {
        logger.warn('Could not fetch tapp details in resolveIdentity:', e);
    }

    res.status(200).json({
        success: true,
        data: {
            cardno: card.cardno,
            name: card.issuedto,
            center: card.center,
            email: card.email,
            department,
            departments,
            flatno,
            confirmed_residents_count: confirmedResidentsCount,
            tapp_details: tappDetails,
            is_paarna_eligible: isPaarnaEligible
        }
    });
};

export const validateGuest = async (req, res) => {
    const { id } = req.params;
    const { mobno } = req.query;

    if (!mobno) {
        throw new ApiError(400, 'Mobile number is required');
    }

    const form = await CustomForm.findByPk(id);
    if (!form) throw new ApiError(404, 'Form not found');

    const cleanMob = String(mobno).replace(/\D/g, '').slice(-10);
    if (cleanMob.length !== 10) {
        return res.status(200).json({ success: false, message: 'Please enter a valid 10-digit mobile number' });
    }

    const parsedMob = parseInt(cleanMob, 10);
    const card = await CardDb.findOne({
        where: { mobno: parsedMob },
        attributes: ['cardno', 'issuedto', 'center', 'email']
    });

    if (!card) {
        return res.status(200).json({
            success: false,
            message: 'Mobile number is not registered in Ashram database'
        });
    }

    const eventId = form.event_id;
    const eventName = form.event_name || 'this event';

    if (eventId) {
        const booking = await UtsavBooking.findOne({
            where: {
                utsavid: eventId,
                cardno: card.cardno,
                status: {
                    [Sequelize.Op.in]: [
                        'confirmed',
                        'completed',
                        'cash_completed',
                        'checkedin',
                        'open'
                    ]
                }
            }
        });

        if (!booking) {
            return res.status(200).json({
                success: false,
                message: `${card.issuedto} (${card.center || 'Member'}) does not have a confirmed booking for ${eventName}`
            });
        }
    }

    // Look up Tapascharya / Tapp details for this member if available
    let tappDetails = null;
    let isPaarnaEligible = false;
    try {
        const allTappForms = await CustomForm.findAll({
            where: {
                title: { [Sequelize.Op.like]: '%Tapascharya%' },
                status: 'active'
            },
            attributes: ['id']
        });
        const tappFormIds = allTappForms.map(f => f.id);
        if (tappFormIds.length > 0) {
            const userTappResp = await CustomFormResponse.findOne({
                where: {
                    form_id: { [Sequelize.Op.in]: tappFormIds },
                    cardno: card.cardno
                },
                order: [['submittedAt', 'DESC']]
            });
            if (userTappResp && userTappResp.responses) {
                const matrix = userTappResp.responses.tapascharya_matrix || {};
                const entries = Object.entries(matrix).filter(([_, v]) => v && v !== 'Regular Meal' && v !== 'Regular Meals' && v !== 'Regular' && !String(v).toLowerCase().includes('regular'));
                if (entries.length > 0) {
                    const upvaasCount = entries.filter(([_, v]) => v === 'Upvaas').length;
                    const aayambilCount = entries.filter(([_, v]) => v === 'Aayambil').length;
                    const ekasnaCount = entries.filter(([_, v]) => String(v).includes('Ekasna')).length;
                    const biyasnaCount = entries.filter(([_, v]) => String(v).includes('Biyasna')).length;
                    const liquidCount = entries.filter(([_, v]) => String(v).includes('Liquid')).length;
                    const rasTyaagCount = entries.filter(([_, v]) => String(v).includes('Ras Tyaag')).length;

                    // Paarna eligible tap days: Upvaas, Aayambil, Ekasna, Only Liquid (excludes Biyasna & Ras Tyaag)
                    const eligibleTappDays = upvaasCount + aayambilCount + ekasnaCount + liquidCount;

                    // Check for 3 consecutive Upvaas across the 8 Paryushan dates
                    const sortedDates = ['8th Sep', '9th Sep', '10th Sep', '11th Sep', '12th Sep', '13th Sep', '14th Sep', '15th Sep'];
                    let consecutiveUpvaas = 0;
                    let has3ConsecutiveUpvaas = false;
                    for (const d of sortedDates) {
                        if (matrix[d] === 'Upvaas') {
                            consecutiveUpvaas++;
                            if (consecutiveUpvaas >= 3) {
                                has3ConsecutiveUpvaas = true;
                                break;
                            }
                        } else {
                            consecutiveUpvaas = 0;
                        }
                    }

                    isPaarnaEligible = (eligibleTappDays >= 8 || has3ConsecutiveUpvaas);

                    const parts = [];
                    if (upvaasCount > 0) parts.push(`${upvaasCount} Upvaas`);
                    if (aayambilCount > 0) parts.push(`${aayambilCount} Aayambil`);
                    if (ekasnaCount > 0) parts.push(`${ekasnaCount} Ekasna`);
                    if (biyasnaCount > 0) parts.push(`${biyasnaCount} Biyasna`);
                    if (liquidCount > 0) parts.push(`${liquidCount} Only Liquid`);
                    if (rasTyaagCount > 0) parts.push(`${rasTyaagCount} Ras Tyaag`);
                    tappDetails = parts.join(', ') || entries.map(([d, v]) => `${d}: ${v}`).join(', ');
                }
            }
        }
    } catch (e) {
        logger.warn('Could not fetch tapp details in resolveIdentity:', e);
    }

    return res.status(200).json({
        success: true,
        data: {
            cardno: card.cardno,
            name: card.issuedto,
            center: card.center,
            email: card.email,
            tapp_details: tappDetails,
            is_paarna_eligible: isPaarnaEligible
        }
    });
};

export const getMyResponse = async (req, res) => {
    const { id } = req.params;
    const { type, value, department, flatno } = req.query;

    if (!type || !value) {
        return res.status(200).json({ success: true, data: null });
    }

    let resolvedCardNo = null;

    if (type === 'mobno') {
        const cleanMob = String(value).replace(/\D/g, '').slice(-10);
        if (cleanMob.length === 10) {
            const parsedMob = parseInt(cleanMob, 10);
            const card = await CardDb.findOne({ where: { mobno: parsedMob }, attributes: ['cardno'] });
            if (card) resolvedCardNo = card.cardno;
        }
    } else {
        const card = await CardDb.findOne({ where: { cardno: value }, attributes: ['cardno'] });
        if (card) resolvedCardNo = card.cardno;
    }

    if (!resolvedCardNo) {
        return res.status(200).json({ success: true, data: null });
    }

    if (flatno) {
        const allFormResponses = await CustomFormResponse.findAll({
            where: { form_id: parseInt(id) },
            order: [['submittedAt', 'DESC']],
            attributes: ['id', 'cardno', 'responses', 'submittedAt']
        });
        const matchByFlat = allFormResponses.find(r => {
            const resp = r.responses || {};
            return String(resp.flatno || '').trim() === String(flatno).trim();
        });
        if (matchByFlat) {
            let submittedByName = null;
            if (matchByFlat.cardno) {
                const subCard = await CardDb.findOne({ where: { cardno: matchByFlat.cardno }, attributes: ['issuedto'] });
                if (subCard) submittedByName = subCard.issuedto;
            }
            return res.status(200).json({
                success: true,
                data: {
                    responseId: matchByFlat.id,
                    responses: matchByFlat.responses,
                    submittedAt: matchByFlat.submittedAt,
                    cardno: matchByFlat.cardno,
                    submittedByName,
                    flatno
                }
            });
        }
        return res.status(200).json({ success: true, data: null });
    }

    if (department) {
        const cleanTargetDept = String(department).trim().toLowerCase();
        const allFormResponses = await CustomFormResponse.findAll({
            where: { form_id: parseInt(id) },
            order: [['submittedAt', 'DESC']],
            attributes: ['id', 'cardno', 'responses', 'submittedAt']
        });
        const matchByDept = allFormResponses.find(r => {
            const resp = r.responses || {};
            return Object.values(resp).some(v => typeof v === 'string' && v.trim().toLowerCase() === cleanTargetDept);
        });
        if (matchByDept) {
            let submittedByName = null;
            if (matchByDept.cardno) {
                const subCard = await CardDb.findOne({ where: { cardno: matchByDept.cardno }, attributes: ['issuedto'] });
                if (subCard) submittedByName = subCard.issuedto;
            }
            return res.status(200).json({
                success: true,
                data: {
                    responseId: matchByDept.id,
                    responses: matchByDept.responses,
                    submittedAt: matchByDept.submittedAt,
                    cardno: matchByDept.cardno,
                    submittedByName,
                    department
                }
            });
        }
        return res.status(200).json({ success: true, data: null });
    }

    const existingResponses = await CustomFormResponse.findAll({
        where: { form_id: parseInt(id), cardno: resolvedCardNo },
        order: [['submittedAt', 'DESC']],
        attributes: ['id', 'cardno', 'responses', 'submittedAt']
    });

    if (!existingResponses || existingResponses.length === 0) {
        return res.status(200).json({ success: true, data: null });
    }

    const existing = existingResponses[0];
    let submittedByName = null;
    if (existing.cardno) {
        const subCard = await CardDb.findOne({ where: { cardno: existing.cardno }, attributes: ['issuedto'] });
        if (subCard) submittedByName = subCard.issuedto;
    }

    res.status(200).json({
        success: true,
        data: {
            responseId: existing.id,
            responses: existing.responses,
            submittedAt: existing.submittedAt,
            cardno: existing.cardno,
            submittedByName
        }
    });
};

/**
 * POST /api/v1/admin/forms/public/:id/draft
 * Save (create or update) an in-progress, unsubmitted set of answers for a
 * form, keyed by the respondent's email, so they can resume later if they
 * navigate away mid-fill. Opt-in on the frontend — only called once the user
 * has checked "save my progress" and provided a valid email.
 */
export const saveFormDraft = async (req, res) => {
    const { id } = req.params;
    const { email, cardno, mobno, responses } = req.body;

    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
        throw new ApiError(400, 'A valid email address is required');
    }
    if (!responses || typeof responses !== 'object') {
        throw new ApiError(400, 'responses object is required');
    }

    const form = await CustomForm.findOne({ where: { id, status: 'active' } });
    if (!form) {
        throw new ApiError(404, 'Form not found or inactive');
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await CustomFormDraft.findOne({
        where: { form_id: parseInt(id), email: normalizedEmail }
    });

    if (existing) {
        await existing.update({
            responses,
            cardno: cardno || existing.cardno,
            mobno: mobno || existing.mobno
        });
    } else {
        await CustomFormDraft.create({
            form_id: parseInt(id),
            email: normalizedEmail,
            cardno: cardno || null,
            mobno: mobno || null,
            responses
        });
    }

    res.status(200).json({
        success: true,
        message: 'Draft saved'
    });
};

/**
 * GET /api/v1/admin/forms/public/:id/draft?email=...
 * Fetch a previously saved in-progress draft for a form, if one exists.
 * Also returns the mobile/card number the draft was last saved under, so an
 * authenticated form can restore that field too once the visitor has proven
 * who they are by typing their email — no separate "remember me" needed.
 */
export const getFormDraft = async (req, res) => {
    const { id } = req.params;
    const { email } = req.query;

    if (!email || !EMAIL_REGEX.test(String(email).trim())) {
        throw new ApiError(400, 'A valid email address is required');
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const draft = await CustomFormDraft.findOne({
        where: { form_id: parseInt(id), email: normalizedEmail }
    });

    res.status(200).json({
        success: true,
        data: draft ? {
            responses: draft.responses,
            cardno: draft.cardno,
            mobno: draft.mobno,
            updatedAt: draft.updatedAt
        } : null
    });
};

/**
 * Internal helper to validate date fields against min, max, and cutoff hour constraints.
 */
function validateDateConstraints(fields, responses) {
    for (const field of fields) {
        if (field.type === 'date') {
            const answer = responses[field.id];
            if (answer && field.dateConstraints) {
                const dateConstraints = field.dateConstraints;
                const chosenDate = new Date(answer);
                if (isNaN(chosenDate.getTime())) {
                    throw new ApiError(400, `"${field.label}" must be a valid date`);
                }

                const getISTDateString = (d) => {
                    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
                    return formatter.format(d);
                };

                const getISTHour = (d) => {
                    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
                    return parseInt(formatter.format(d), 10);
                };

                const chosenStr = getISTDateString(chosenDate);
                const now = new Date();
                const nowStr = getISTDateString(now);

                let minDateStr = null;
                if (dateConstraints.minType === 'today') {
                    minDateStr = nowStr;
                } else if (dateConstraints.minType === 'tomorrow') {
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    minDateStr = getISTDateString(tomorrow);
                } else if (dateConstraints.minType === 'fixed' && dateConstraints.minFixed) {
                    minDateStr = dateConstraints.minFixed;
                }

                // Once date settings exist for a field, never allow a date before today,
                // regardless of the configured minType (including "no minimum" or a past fixed date).
                if (!minDateStr || minDateStr < nowStr) {
                    minDateStr = nowStr;
                }

                if (minDateStr && chosenStr < minDateStr) {
                    throw new ApiError(400, `"${field.label}" must be on or after ${minDateStr}`);
                }

                let maxDateStr = null;
                if (dateConstraints.maxType === 'today') {
                    maxDateStr = nowStr;
                } else if (dateConstraints.maxType === 'fixed' && dateConstraints.maxFixed) {
                    maxDateStr = dateConstraints.maxFixed;
                }

                if (maxDateStr && chosenStr > maxDateStr) {
                    throw new ApiError(400, `"${field.label}" must be on or before ${maxDateStr}`);
                }

                if (dateConstraints.cutoffHour !== null && dateConstraints.cutoffHour !== undefined) {
                    const cutoffDay = new Date(chosenStr);
                    cutoffDay.setUTCDate(cutoffDay.getUTCDate() - 1);
                    const cutoffDayStr = cutoffDay.toISOString().split('T')[0];

                    const currentHour = getISTHour(now);
                    if (nowStr > cutoffDayStr || (nowStr === cutoffDayStr && currentHour >= dateConstraints.cutoffHour)) {
                        throw new ApiError(400, `Booking/Selection for ${chosenStr} has closed (Cutoff was ${dateConstraints.cutoffHour}:00 of previous day)`);
                    }
                }
            }
        }
    }
}

const SHORT_ANSWER_MAX_WORDS = 20;

/**
 * Internal helper to enforce the 20-word limit on "Short Answer" (type: 'text') fields.
 */
function validateShortAnswerLimits(fields, responses) {
    for (const field of fields) {
        if (field.type === 'text') {
            const answer = responses[field.id];
            if (typeof answer === 'string' && answer.trim() !== '') {
                const wordCount = answer.trim().split(/\s+/).length;
                if (wordCount > SHORT_ANSWER_MAX_WORDS) {
                    throw new ApiError(400, `"${field.label}" must not exceed ${SHORT_ANSWER_MAX_WORDS} words`);
                }
            }
        }
    }
}

/**
 * Internal helper — throws ApiError if there is no recent verified OTP for this mobile.
 * Called inside submitFormResponse when form.requireOtp === true.
 */

/**
 * Internal helper to verify that a card is registered for the event if requireRegistration is enabled.
 */
async function assertEventRegistration(form, cardno) {
    if (!form || !form.requireRegistration || !form.event_id || !cardno) return;

    const eventType = (form.event_type || form.dept_name || '').toLowerCase();
    const eventId = parseInt(form.event_id, 10);
    const eventName = form.event_name || 'this event';

    if (eventType.includes('utsav')) {
        const booking = await UtsavBooking.findOne({
            where: {
                utsavid: eventId,
                cardno,
                status: {
                    [Sequelize.Op.in]: [
                        'confirmed',
                        'completed',
                        'cash_completed',
                        'checkedin',
                        'open'
                    ]
                }
            }
        });
        if (!booking) {
            throw new ApiError(403, `You are not registered for ${eventName}. Access is restricted to registered participants only.`);
        }
    } else if (eventType.includes('adhyay') || eventType.includes('shibir')) {
        const booking = await ShibirBookingDb.findOne({
            where: {
                shibir_id: eventId,
                cardno,
                status: {
                    [Sequelize.Op.in]: [
                        'confirmed',
                        'completed',
                        'open'
                    ]
                }
            }
        });
        if (!booking) {
            throw new ApiError(403, `You are not registered for ${eventName}. Access is restricted to registered participants only.`);
        }
    }
}

async function assertOtpVerified(mobno, form) {
    // Look for a verified OTP created in the last 10 minutes
    const record = await CoordinatorOtp.findOne({
        where: {
            mobno,
            verified: true,
            createdAt: {
                [Sequelize.Op.gte]: new Date(Date.now() - 10 * 60 * 1000)
            }
        },
        order: [['createdAt', 'DESC']]
    });

    if (!record) {
        throw new ApiError(403, 'OTP verification required. Please verify your mobile number before submitting.');
    }

    if (form) {
        const configuredCount = await CustomFormOtpAllowlist.count({
            where: {
                form_id: form.id,
                status: 'active',
                mobno: { [Sequelize.Op.ne]: null }
            }
        });

        if (configuredCount > 0) {
            const allowed = await CustomFormOtpAllowlist.findOne({
                where: {
                    form_id: form.id,
                    mobno,
                    status: 'active'
                }
            });
            if (!allowed) {
                throw new ApiError(403, 'This mobile number is not authorized to submit this form.');
            }
        }
    }
}

/**
 * POST /api/v1/admin/forms/public/otp/send
 * Send OTP to a registered mobile number for form auth.
 */
export const sendFormOtp = async (req, res) => {
    const { mobno, formId } = req.body;

    if (!mobno) {
        throw new ApiError(400, 'Mobile number is required');
    }

    const cleanMob = String(mobno).replace(/\D/g, '').slice(-10);
    if (cleanMob.length !== 10) {
        throw new ApiError(400, 'Invalid mobile number format. Please enter a 10-digit number.');
    }
    const parsedMob = parseInt(cleanMob, 10);

    const card = await CardDb.findOne({ where: { mobno: parsedMob } });
    if (!card) {
        throw new ApiError(404, 'Mobile number is not registered in Ashram database');
    }

    // Enforce event registration and allowlist if formId is provided
    if (formId) {
        const parsedFormId = parseInt(formId, 10);
        const formObj = await CustomForm.findByPk(parsedFormId);
        if (formObj && formObj.requireRegistration) {
            await assertEventRegistration(formObj, card.cardno);
        }
        const configuredCount = await CustomFormOtpAllowlist.count({
            where: {
                form_id: parsedFormId,
                status: 'active',
                mobno: { [Sequelize.Op.ne]: null }
            }
        });

        if (configuredCount > 0) {
            const allowed = await CustomFormOtpAllowlist.findOne({
                where: {
                    form_id: parsedFormId,
                    mobno: cleanMob,
                    status: 'active'
                }
            });
            if (!allowed) {
                throw new ApiError(403, 'This mobile number is not authorized to fill out this form.');
            }
        }
    }

    // Rate limit: max 5 OTPs per 10 minutes
    const recentCount = await CoordinatorOtp.count({
        where: {
            mobno: cleanMob,
            createdAt: { [Sequelize.Op.gte]: new Date(Date.now() - 10 * 60 * 1000) }
        }
    });
    if (recentCount >= 5) {
        throw new ApiError(429, 'Too many OTP requests. Please try again later.');
    }

    const otp = crypto.randomInt(100000, 1000000);

    await CoordinatorOtp.create({
        mobno: cleanMob,
        otp: String(otp),
        expires_at: new Date(Date.now() + 5 * 60 * 1000)
    });

    await sendCoordinatorOtp(
        formatWhatsAppPhone(cleanMob, card.country),
        otp
    );

    return res.status(200).json({ success: true, message: 'OTP sent successfully' });
};

/**
 * POST /api/v1/admin/forms/public/otp/verify
 * Verify OTP entered by the user.
 */
export const verifyFormOtp = async (req, res) => {
    const { mobno, otp } = req.body;

    if (!mobno || !otp) {
        throw new ApiError(400, 'Mobile number and OTP are required');
    }

    const cleanMob = String(mobno).replace(/\D/g, '').slice(-10);

    const record = await CoordinatorOtp.findOne({
        where: { mobno: cleanMob, otp, verified: false },
        order: [['createdAt', 'DESC']]
    });

    if (!record) {
        // Increment attempts on the latest unverified record
        const latest = await CoordinatorOtp.findOne({
            where: { mobno: cleanMob, verified: false },
            order: [['createdAt', 'DESC']]
        });
        if (latest) {
            await latest.increment('attempts');
            if (latest.attempts + 1 >= 5) {
                await latest.update({ verified: true });
                throw new ApiError(429, 'Too many invalid attempts. OTP blocked.');
            }
        }
        throw new ApiError(400, 'Invalid OTP');
    }

    if (record.attempts >= 5) {
        throw new ApiError(429, 'Too many invalid attempts');
    }

    if (new Date() > new Date(record.expires_at)) {
        throw new ApiError(400, 'OTP has expired. Please request a new one.');
    }

    await record.update({ verified: true, attempts: 0 });

    return res.status(200).json({ success: true, message: 'OTP verified successfully' });
};

/**
 * GET /api/v1/admin/forms/:id/allowlist
 * Get all active OTP allowlist entries for a form.
 */
export const getFormAllowlist = async (req, res) => {
    const { id } = req.params;
    const form = await CustomForm.findByPk(id);
    if (!form) throw new ApiError(404, 'Form not found');

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, form.dept_name)) {
        throw new ApiError(403, 'You do not have access to this form');
    }

    const allowlist = await CustomFormOtpAllowlist.findAll({
        where: { form_id: id, status: 'active' },
        order: [['createdAt', 'DESC']]
    });

    const enriched = await Promise.all(allowlist.map(async (entry) => {
        const cleanMob = entry.mobno ? String(entry.mobno).replace(/\D/g, '').slice(-10) : null;
        const parsedMob = cleanMob ? parseInt(cleanMob, 10) : null;
        const card = parsedMob ? await CardDb.findOne({
            where: { mobno: parsedMob },
            attributes: ['cardno', 'issuedto', 'center', 'email']
        }) : null;
        return {
            id: entry.id,
            form_id: entry.form_id,
            mobno: cleanMob || null,
            cardno: entry.cardno || (card ? card.cardno : null),
            department: entry.department,
            status: entry.status,
            name: card ? card.issuedto : (cleanMob ? 'Ashram Member' : '— (Pending assignment)'),
            center: card ? card.center : null,
            email: card ? card.email : null
        };
    }));

    res.status(200).json({ success: true, data: enriched });
};

/**
 * POST /api/v1/admin/forms/:id/allowlist
 * Add or sync OTP allowlist entries for a form.
 */
export const saveFormAllowlist = async (req, res) => {
    const { id } = req.params;
    const { entries, mobno, department, cardno } = req.body;
    const form = await CustomForm.findByPk(id);
    if (!form) throw new ApiError(404, 'Form not found');

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, form.dept_name)) {
        throw new ApiError(403, 'You do not have access to this form');
    }

    const t = await database.transaction();

    try {
        if (Array.isArray(entries)) {
            await CustomFormOtpAllowlist.destroy({ where: { form_id: id }, transaction: t });
            for (const e of entries) {
                const clean = e.mobno ? String(e.mobno).replace(/\D/g, '').slice(-10) : null;
                let resolvedCardno = e.cardno || null;
                if (clean && clean.length === 10 && !resolvedCardno) {
                    const card = await CardDb.findOne({
                        where: { mobno: parseInt(clean, 10) },
                        attributes: ['cardno'],
                        transaction: t
                    });
                    if (card) resolvedCardno = card.cardno;
                }
                const dept = e.department ? String(e.department).trim() : null;
                if (dept || (clean && clean.length === 10)) {
                    await CustomFormOtpAllowlist.create({
                        form_id: parseInt(id, 10),
                        mobno: (clean && clean.length === 10) ? clean : null,
                        cardno: resolvedCardno || null,
                        department: dept,
                        status: 'active',
                        createdBy: req.user?.username || 'admin'
                    }, { transaction: t });
                }
            }
            await t.commit();
            return res.status(200).json({ success: true, message: 'Allowlist synchronized successfully' });
        }

        if (mobno || department) {
            const clean = mobno ? String(mobno).replace(/\D/g, '').slice(-10) : null;
            let resolvedCardno = cardno || null;
            if (clean && clean.length === 10 && !resolvedCardno) {
                const card = await CardDb.findOne({
                    where: { mobno: parseInt(clean, 10) },
                    attributes: ['cardno'],
                    transaction: t
                });
                if (card) resolvedCardno = card.cardno;
            }
            await CustomFormOtpAllowlist.create({
                form_id: parseInt(id, 10),
                mobno: (clean && clean.length === 10) ? clean : null,
                cardno: resolvedCardno || null,
                department: department ? String(department).trim() : null,
                status: 'active',
                createdBy: req.user?.username || 'admin'
            }, { transaction: t });
        }

        await t.commit();
        res.status(200).json({ success: true, message: 'Allowlist updated successfully' });
    } catch (err) {
        if (!t.finished) await t.rollback();
        throw err;
    }
};

/**
 * DELETE /api/v1/admin/forms/:id/allowlist/:entryId
 * Remove an allowlist entry.
 */
export const deleteFormAllowlistEntry = async (req, res) => {
    const { id, entryId } = req.params;
    const form = await CustomForm.findByPk(id);
    if (!form) throw new ApiError(404, 'Form not found');

    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, form.dept_name)) {
        throw new ApiError(403, 'You do not have access to this form');
    }

    const entry = await CustomFormOtpAllowlist.findOne({
        where: { id: entryId, form_id: id }
    });
    if (!entry) throw new ApiError(404, 'Allowlist entry not found');

    await entry.destroy();
    res.status(200).json({ success: true, message: 'Allowlist entry removed' });
};

/**
 * GET /api/v1/admin/forms/events?dept=...
 * Fetch upcoming and ongoing events for Utsav (utsav_db) or Adhyayan (shibir_db).
 */
export const getDepartmentEvents = async (req, res) => {
    const { dept } = req.query;
    if (!dept) {
        throw new ApiError(400, 'Department is required');
    }

    const cleanDept = String(dept).trim().toLowerCase();
    const userRoles = req.roles || [];
    if (!hasAccessToDept(userRoles, cleanDept)) {
        throw new ApiError(403, 'You do not have access to this department');
    }

    const today = new Date().toISOString().split('T')[0];

    if (cleanDept.includes('utsav')) {
        const utsavs = await UtsavDb.findAll({
            where: {
                end_date: { [Sequelize.Op.gte]: today }
            },
            attributes: ['id', 'name', 'start_date', 'end_date', 'status'],
            order: [['start_date', 'ASC']]
        });
        return res.status(200).json({ success: true, data: utsavs, eventType: 'utsav' });
    }

    if (cleanDept.includes('adhyay') || cleanDept.includes('shibir')) {
        const shibirs = await ShibirDb.findAll({
            where: {
                end_date: { [Sequelize.Op.gte]: today },
                status: { [Sequelize.Op.ne]: 'deleted' }
            },
            attributes: ['id', 'name', 'start_date', 'end_date', 'status'],
            order: [['start_date', 'ASC']]
        });
        return res.status(200).json({ success: true, data: shibirs, eventType: 'adhyayan' });
    }

    return res.status(200).json({ success: true, data: [], eventType: null });
};
