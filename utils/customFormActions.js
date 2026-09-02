import FoodDb from '../models/food_db.model.js';
import UtsavBooking from '../models/utsav_boking.model.js';
import CustomForm from '../models/custom_form.model.js';
import CustomFormResponse from '../models/custom_form_response.model.js';
import Sequelize from 'sequelize';
import logger from '../config/logger.js';

// Meal mappings for Tapascharya choices (0 = NONE / no meal, 1 = REGULAR / meal booked)
const TAPP_MEAL_MAP = {
    'Upvaas': { breakfast: 0, lunch: 0, dinner: 0 },
    'Aayambil': { breakfast: 0, lunch: 1, dinner: 0 },
    'Ekasna (Breakfast)': { breakfast: 1, lunch: 0, dinner: 0 },
    'Ekasna (Lunch)': { breakfast: 0, lunch: 1, dinner: 0 },
    'Ekasna (Dinner)': { breakfast: 0, lunch: 0, dinner: 1 },
    'Biyasna (Breakfast + Lunch)': { breakfast: 1, lunch: 1, dinner: 0 },
    'Biyasna (Breakfast + Dinner)': { breakfast: 1, lunch: 0, dinner: 1 },
    'Biyasna (Lunch + Dinner)': { breakfast: 0, lunch: 1, dinner: 1 },
    'Only Liquid': { breakfast: 0, lunch: 0, dinner: 0 },
    'Ras Tyaag': { breakfast: 1, lunch: 1, dinner: 1 },
    'Regular Meal': { breakfast: 1, lunch: 1, dinner: 1 },
    'Regular Meals': { breakfast: 1, lunch: 1, dinner: 1 },
    'Regular': { breakfast: 1, lunch: 1, dinner: 1 }
};

export function getTappMealMapping(choice) {
    if (!choice) return null;
    const clean = String(choice).trim();
    if (TAPP_MEAL_MAP[clean]) return TAPP_MEAL_MAP[clean];
    const lower = clean.toLowerCase();
    for (const [key, val] of Object.entries(TAPP_MEAL_MAP)) {
        if (key.toLowerCase() === lower) return val;
    }
    if (lower.includes('regular')) {
        return { breakfast: 1, lunch: 1, dinner: 1 };
    }
    return null;
}

export function normalizeDateString(dateKey, fallbackYear = 2026) {
    if (!dateKey) return null;
    const trimmed = String(dateKey).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
    }

    const match = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)(?:\s+(\d{4}))?$/i);
    if (match) {
        const day = String(parseInt(match[1], 10)).padStart(2, '0');
        const monthName = match[2].toLowerCase().substring(0, 3);
        const year = match[3] ? match[3] : fallbackYear;
        const months = {
            jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
            jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
        };
        const monthNum = months[monthName];
        if (monthNum) {
            return `${year}-${monthNum}-${day}`;
        }
    }
    return null;
}

/**
 * Checks if a target date has passed the cutoff (8:00 PM IST of the previous day).
 * E.g. for 12th Sept, cutoff is 11th Sept at 8:00 PM (20:00) IST.
 */
export function isDatePastCutoff(targetDateStr, cutoffHour = 20) {
    if (!targetDateStr) return false;
    const parts = String(targetDateStr).trim().split('-').map(Number);
    if (parts.length < 3) return false;
    const [y, m, d] = parts;
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const cutoffIST = new Date(y, m - 1, d - 1, cutoffHour, 0, 0);
    return nowIST >= cutoffIST;
}

/**
 * Calculates daily Aayambil counts (Direct Aayambil + Ras Tyaag) across all active Tapascharya forms.
 */
export async function getTappDailyAayambilCounts(startDate, endDate) {
    try {
        const tappForms = await CustomForm.findAll({
            where: {
                title: { [Sequelize.Op.like]: '%Tapascharya%' },
                status: 'active'
            },
            attributes: ['id', 'fields']
        });
        if (!tappForms.length) return {};

        const formIds = [];
        const gridFieldIds = new Set(['tapascharya_matrix']);
        for (const f of tappForms) {
            formIds.push(f.id);
            const grid = (f.fields || []).find(fld => fld.type === 'grid_radio');
            if (grid && grid.id) gridFieldIds.add(grid.id);
        }

        const responses = await CustomFormResponse.findAll({
            where: { form_id: { [Sequelize.Op.in]: formIds } },
            attributes: ['id', 'cardno', 'responses', 'submittedAt'],
            order: [['submittedAt', 'ASC']]
        });

        // Group by cardno (or response id if cardno is not present) so latest response per member is used
        const latestByUser = new Map();
        for (const r of responses) {
            const key = r.cardno || r.id;
            latestByUser.set(key, r.responses);
        }

        const countsByDate = {};
        for (const resp of latestByUser.values()) {
            if (!resp) continue;

            let matrix = null;
            for (const fieldId of gridFieldIds) {
                if (resp[fieldId] && typeof resp[fieldId] === 'object' && !Array.isArray(resp[fieldId])) {
                    matrix = resp[fieldId];
                    break;
                }
            }

            // Fallback heuristic: find object-valued field whose entries match tapascharya choices
            if (!matrix) {
                for (const v of Object.values(resp)) {
                    if (v && typeof v === 'object' && !Array.isArray(v)) {
                        const hasTappChoice = Object.values(v).some(val =>
                            typeof val === 'string' && (
                                val.toLowerCase().includes('aayambil') ||
                                val.toLowerCase().includes('upvaas') ||
                                val.toLowerCase().includes('ras tyaag') ||
                                val.toLowerCase().includes('ekasna') ||
                                val.toLowerCase().includes('biyasna')
                            )
                        );
                        if (hasTappChoice) {
                            matrix = v;
                            break;
                        }
                    }
                }
            }

            if (!matrix) continue;

            for (const [dateLabel, choice] of Object.entries(matrix)) {
                if (!choice) continue;
                const normDate = normalizeDateString(dateLabel);
                if (!normDate) continue;
                if (startDate && normDate < startDate) continue;
                if (endDate && normDate > endDate) continue;

                if (!countsByDate[normDate]) {
                    countsByDate[normDate] = {
                        upvaas: 0,
                        aayambil: 0,
                        rasTyaag: 0,
                        totalAayambil: 0,
                        ekasna: 0,
                        biyasna: 0,
                        onlyLiquid: 0,
                        regular: 0
                    };
                }
                const ch = String(choice).toLowerCase().trim();
                if (ch === 'upvaas' || ch.includes('upvaas') || ch.includes('upvas')) {
                    countsByDate[normDate].upvaas++;
                } else if (ch === 'aayambil') {
                    countsByDate[normDate].aayambil++;
                    countsByDate[normDate].totalAayambil++;
                } else if (ch.includes('ras tyaag')) {
                    countsByDate[normDate].rasTyaag++;
                    countsByDate[normDate].totalAayambil++;
                } else if (ch.includes('ekasna') || ch.includes('ekasnu') || ch.includes('ekasana')) {
                    countsByDate[normDate].ekasna++;
                } else if (ch.includes('biyasna') || ch.includes('biyasnu') || ch.includes('biyasana')) {
                    countsByDate[normDate].biyasna++;
                } else if (ch.includes('liquid') || ch.includes('only liquid')) {
                    countsByDate[normDate].onlyLiquid++;
                } else if (ch.includes('regular')) {
                    countsByDate[normDate].regular++;
                }
            }
        }
        return countsByDate;
    } catch (err) {
        logger.error('[TAPP_HOOK] Error fetching tapp daily aayambil counts:', err);
        return {};
    }
}

/**
 * Dispatcher – called after every form submission/update.
 * Checks if the form has a registered action hook and runs it.
 *
 * @param {object} form        - Sequelize CustomForm instance
 * @param {object} responses   - Plain responses object { fieldId: value }
 * @param {string|null} cardno - Resolved card number of the respondent
 */
export const handleFormSubmissionActions = async (form, responses, cardno) => {
    if (!cardno) return;

    const titleLower = (form.title || '').toLowerCase();
    const deptLower = (form.dept_name || '').toLowerCase();

    if (titleLower.includes('tapascharya') || (deptLower === 'food' && titleLower.includes('tapp'))) {
        await handleParyushanTapascharya(form, responses, cardno);
    } else if (form.event_type === 'flat_host' || titleLower.includes('flat host') || titleLower.includes('anand mahotsav')) {
        await handleFlatHostAllocation(form, responses, cardno);
    }
};

async function applyMealChange(cardno, normalizedDate, mealUpdate, tappChoice) {
    const existing = await FoodDb.findOne({ where: { cardno, date: normalizedDate } });
    if (existing) {
        await existing.update({
            breakfast: mealUpdate.breakfast,
            lunch:     mealUpdate.lunch,
            dinner:    mealUpdate.dinner,
            updatedBy: 'SYSTEM-TAPASCHARYA'
        });
        logger.info('[TAPP_HOOK] Updated existing food_db record', { cardno, date: normalizedDate, tappChoice, mealUpdate });
    } else {
        await FoodDb.create({
            id: `${cardno}-${normalizedDate}`,
            cardno,
            bookedBy: cardno,
            date: normalizedDate,
            breakfast: mealUpdate.breakfast,
            breakfast_plate_issued: 0,
            lunch: mealUpdate.lunch,
            lunch_plate_issued: 0,
            dinner: mealUpdate.dinner,
            dinner_plate_issued: 0,
            hightea: 'NONE',
            spicy: 0,
            updatedBy: 'SYSTEM-TAPASCHARYA'
        });
        logger.info('[TAPP_HOOK] Created new food_db record', { cardno, date: normalizedDate, tappChoice, mealUpdate });
    }
}

async function handleParyushanTapascharya(form, responses, cardno) {
    const fields = form.fields || [];

    const gridField = fields.find(f => f.type === 'grid_radio');
    if (gridField && responses[gridField.id]) {
        const matrixAnswers = responses[gridField.id];
        const year = form.event_id ? 2026 : new Date().getFullYear();

        for (const [dateLabel, tappChoice] of Object.entries(matrixAnswers)) {
            if (!tappChoice) continue;

            const normalizedDate = normalizeDateString(dateLabel, year);
            if (!normalizedDate) continue;

            // Skip past dates & dates past cutoff (8:00 PM previous day in IST)
            if (isDatePastCutoff(normalizedDate, 20)) {
                logger.info('[TAPP_HOOK] Skipping date past 8:00 PM previous-day cutoff', { cardno, date: normalizedDate });
                continue;
            }

            const mealUpdate = getTappMealMapping(tappChoice);
            if (!mealUpdate) continue;

            try {
                await applyMealChange(cardno, normalizedDate, mealUpdate, tappChoice);
            } catch (err) {
                logger.error('[TAPP_HOOK] Failed to apply meal change', {
                    cardno, date: normalizedDate, error: err.message
                });
            }
        }
        return;
    }

    const dateField = fields.find(f => f.type === 'date');
    const tappField = fields.find(f =>
        (f.label && f.label.toLowerCase().includes('tapascharya')) ||
        (f.id && f.id.toLowerCase().includes('tapascharya'))
    );

    if (!dateField || !tappField) return;

    const rawDate = responses[dateField.id];
    const rawTapp = responses[tappField.id];

    if (!rawDate || !rawTapp) return;

    const selectedDate = String(rawDate).trim();
    if (isDatePastCutoff(selectedDate, 20)) {
        logger.info('[TAPP_HOOK] Skipping single date field past 8:00 PM previous-day cutoff', { cardno, date: selectedDate });
        return;
    }
    const cleanTapp = String(rawTapp).trim();
    const mealUpdate = getTappMealMapping(cleanTapp);
    if (!mealUpdate) return;

    try {
        await applyMealChange(cardno, selectedDate, mealUpdate, cleanTapp);
    } catch (err) {
        logger.error('[TAPP_HOOK] Failed to update food_db', {
            cardno, date: selectedDate, error: err.message
        });
    }
}

async function handleFlatHostAllocation(form, responses, cardno) {
    const flatno = responses.flatno;
    const eventId = form.event_id;
    if (!flatno || !eventId) return;

    const guestList = responses.guests_list;
    if (!guestList || !Array.isArray(guestList) || guestList.length === 0) return;

    const guestCardNos = guestList.map(g => g.cardno).filter(Boolean);
    if (guestCardNos.length === 0) return;

    try {
        const roomTitle = `Flat ${flatno}`;
        await UtsavBooking.update(
            {
                roomno: roomTitle,
                updatedBy: 'SYSTEM-FLAT-HOST'
            },
            {
                where: {
                    utsavid: eventId,
                    cardno: { [Sequelize.Op.in]: guestCardNos }
                }
            }
        );
        logger.info(`[FLAT_HOST_HOOK] Allocated ${roomTitle} to ${guestCardNos.length} guests for utsav ${eventId}`, { guestCardNos });
    } catch (err) {
        logger.error('[FLAT_HOST_HOOK] Failed to update guest room allocations', { error: err.message, flatno, eventId });
    }
}
