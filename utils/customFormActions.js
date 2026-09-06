import FoodDb from '../models/food_db.model.js';
import UtsavBooking from '../models/utsav_boking.model.js';
import CustomForm from '../models/custom_form.model.js';
import CustomFormResponse from '../models/custom_form_response.model.js';
import UtsavPackagesDb from '../models/utsav_packages.model.js';
import UtsavDb from '../models/utsav_db.model.js';
import moment from 'moment-timezone';
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
                } else if (ch.includes('liquid')) {
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
 * Reads all vendor food registration responses for a given form ID and returns
 * per-meal (breakfast, lunch, dinner) counts split by kitchen type (Main Kitchen Mandap vs K1 Kitchen / Other),
 * both across dates and filtered by the given date range.
 *
 * Supports both:
 * 1. Grid-based responses where `food_requirements_no_of_vendors_per_meal` is keyed by dates (e.g. "7th Sep", "8th Sep")
 * 2. Flat responses where meal fields are top-level.
 *
 * @param {string|null} startDate - Optional start date YYYY-MM-DD
 * @param {string|null} endDate   - Optional end date YYYY-MM-DD
 * @param {number} formId         - ID of the vendor registration form (default: 1)
 * @returns {{ utsav: Object|null, hasData: boolean, summary: Object, dates: Array, departments: Array }}
 */
export async function getVendorFoodSummary(startDate = null, endDate = null, formId = 1) {
    const form = await CustomForm.findByPk(formId, {
        attributes: ['id', 'title', 'event_id', 'event_name', 'createdAt', 'fields']
    });

    let utsav = null;
    let eventYear = new Date().getFullYear();
    if (form && form.event_id) {
        utsav = await UtsavDb.findByPk(form.event_id, {
            attributes: ['id', 'name', 'start_date', 'end_date']
        });
        if (utsav && utsav.start_date) {
            eventYear = moment(utsav.start_date).year();
        }
    }

    const responses = await CustomFormResponse.findAll({
        where: { form_id: formId },
        attributes: ['id', 'responses', 'submittedAt'],
        order: [['submittedAt', 'ASC']]
    });

    const emptySummary = () => ({
        main: { breakfast: 0, lunch: 0, dinner: 0, total: 0 },
        other: { breakfast: 0, lunch: 0, dinner: 0, total: 0 },
        total: { breakfast: 0, lunch: 0, dinner: 0, total: 0 }
    });

    if (!responses.length) {
        return {
            utsav,
            hasData: false,
            summary: emptySummary(),
            dates: [],
            departments: []
        };
    }

    // Discover field IDs dynamically from form definition, with fallback to standard IDs
    const formFields = Array.isArray(form?.fields) ? form.fields : [];
    const deptFieldDef = formFields.find((f) => {
        const lbl = (f.label || f.id || '').toLowerCase();
        return lbl.includes('department') || lbl.includes('dept') || (lbl.includes('name') && lbl.includes('department'));
    });
    const deptFieldId = deptFieldDef?.id || 'name_of_department';

    const kitchenFieldDef = formFields.find((f) => {
        const lbl = (f.label || f.id || '').toLowerCase();
        return lbl.includes('kitchen');
    });
    const kitchenFieldId = kitchenFieldDef?.id || 'kitchen_type';

    const foodGridFieldDef = formFields.find((f) => {
        const lbl = (f.label || f.id || '').toLowerCase();
        return (f.type === 'grid_number' || f.type?.includes('grid')) && (lbl.includes('food') || lbl.includes('meal'));
    });
    const foodGridFieldId = foodGridFieldDef?.id || 'food_requirements_no_of_vendors_per_meal';

    const remarksFieldDef = formFields.find((f) => {
        const lbl = (f.label || f.id || '').toLowerCase();
        return lbl.includes('remark') || lbl.includes('note');
    });
    const remarksFieldId = remarksFieldDef?.id || 'remarks';

    const summary = emptySummary();
    const datesMap = {};
    const deptList = [];

    // Helper to normalize grid date keys like "7th Sep", "8th Sep", "7th Sep 2026", "2026-09-08"
    function normalizeDate(rawKey) {
        if (!rawKey) return null;
        const str = String(rawKey).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
        const cleaned = str.replace(/(\d+)(st|nd|rd|th)/i, '$1');
        const hasYear = /\d{4}/.test(cleaned);
        const toParse = hasYear ? cleaned : `${cleaned} ${eventYear}`;
        const formats = ['D MMM YYYY', 'D MMMM YYYY', 'D-MMM-YYYY', 'YYYY-MM-DD'];
        const m = moment(toParse, formats, true);
        return m.isValid() ? m.format('YYYY-MM-DD') : null;
    }

    for (const row of responses) {
        const resp = row.responses || {};
        const dept = (resp[deptFieldId] || resp.name_of_department || resp.department || resp.dept || 'Vendor').trim();
        const kitchenRaw = String(resp[kitchenFieldId] || resp.kitchen_type || '').trim();
        const isMain = kitchenRaw.toLowerCase().includes('main');
        const kitchen = isMain ? 'main' : 'other';
        const kitchenLabel = isMain ? 'Main Kitchen Mandap' : (kitchenRaw || 'K1 Kitchen');
        const remarks = String(resp[remarksFieldId] || resp.remarks || '').trim();

        const foodGrid = resp[foodGridFieldId] || resp.food_requirements_no_of_vendors_per_meal;
        const deptDateBreakdown = {};
        const deptTotal = { breakfast: 0, lunch: 0, dinner: 0, total: 0 };

        if (foodGrid && typeof foodGrid === 'object') {
            // Grid structure: { "7th Sep": { Breakfast: "0", Lunch: "2", Dinner: "2" }, ... }
            for (const [dateKey, mealObj] of Object.entries(foodGrid)) {
                const dateStr = normalizeDate(dateKey);
                if (!dateStr) continue;

                // Filter by date range if provided
                if (startDate && dateStr < startDate) continue;
                if (endDate && dateStr > endDate) continue;

                const b = parseInt(mealObj?.Breakfast || mealObj?.breakfast || 0, 10) || 0;
                const l = parseInt(mealObj?.Lunch || mealObj?.lunch || 0, 10) || 0;
                const d = parseInt(mealObj?.Dinner || mealObj?.dinner || 0, 10) || 0;
                const rowSum = b + l + d;

                deptDateBreakdown[dateStr] = { breakfast: b, lunch: l, dinner: d, total: rowSum };
                deptTotal.breakfast += b;
                deptTotal.lunch += l;
                deptTotal.dinner += d;
                deptTotal.total += rowSum;

                if (!datesMap[dateStr]) {
                    datesMap[dateStr] = {
                        date: dateStr,
                        dateLabel: dateKey,
                        main: { breakfast: 0, lunch: 0, dinner: 0, total: 0 },
                        other: { breakfast: 0, lunch: 0, dinner: 0, total: 0 },
                        total: { breakfast: 0, lunch: 0, dinner: 0, total: 0 },
                        departments: []
                    };
                }

                datesMap[dateStr][kitchen].breakfast += b;
                datesMap[dateStr][kitchen].lunch += l;
                datesMap[dateStr][kitchen].dinner += d;
                datesMap[dateStr][kitchen].total += rowSum;

                datesMap[dateStr].total.breakfast += b;
                datesMap[dateStr].total.lunch += l;
                datesMap[dateStr].total.dinner += d;
                datesMap[dateStr].total.total += rowSum;

                if (rowSum > 0) {
                    datesMap[dateStr].departments.push({
                        dept,
                        kitchen,
                        kitchenLabel,
                        breakfast: b,
                        lunch: l,
                        dinner: d,
                        total: rowSum,
                        remarks
                    });
                }

                summary[kitchen].breakfast += b;
                summary[kitchen].lunch += l;
                summary[kitchen].dinner += d;
                summary[kitchen].total += rowSum;

                summary.total.breakfast += b;
                summary.total.lunch += l;
                summary.total.dinner += d;
                summary.total.total += rowSum;
            }
        } else {
            // Fallback for flat response
            const b = parseInt(resp.breakfast || 0, 10) || 0;
            const l = parseInt(resp.lunch || 0, 10) || 0;
            const d = parseInt(resp.dinner || 0, 10) || 0;
            const rowSum = b + l + d;

            deptTotal.breakfast = b;
            deptTotal.lunch = l;
            deptTotal.dinner = d;
            deptTotal.total = rowSum;

            summary[kitchen].breakfast += b;
            summary[kitchen].lunch += l;
            summary[kitchen].dinner += d;
            summary[kitchen].total += rowSum;

            summary.total.breakfast += b;
            summary.total.lunch += l;
            summary.total.dinner += d;
            summary.total.total += rowSum;
        }

        deptList.push({
            dept,
            kitchen,
            kitchenLabel,
            dates: deptDateBreakdown,
            totals: deptTotal,
            remarks
        });
    }

    const sortedDates = Object.values(datesMap).sort((a, b) => a.date.localeCompare(b.date));
    const hasData = summary.total.total > 0 || sortedDates.some((d) => d.total.total > 0);

    return {
        utsav,
        hasData,
        summary,
        dates: sortedDates,
        departments: deptList
    };
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

        // Retrieve devotee's confirmed package date boundaries
        const allowedEventIds = (Array.isArray(form.event_ids) && form.event_ids.length > 0)
            ? form.event_ids.map(Number).filter(n => !isNaN(n))
            : (form.event_id ? [parseInt(form.event_id, 10)] : []);

        let packageRange = null;
        if (allowedEventIds.length > 0) {
            const booking = await UtsavBooking.findOne({
                where: {
                    utsavid: { [Sequelize.Op.in]: allowedEventIds },
                    cardno,
                    status: {
                        [Sequelize.Op.in]: [
                            'confirmed',
                            'completed',
                            'cash completed',
                            'cash_completed',
                            'checkedin',
                            'open'
                        ]
                    }
                }
            });
            if (booking && booking.packageid) {
                const pkg = await UtsavPackagesDb.findByPk(booking.packageid, { raw: true });
                if (pkg && pkg.start_date && pkg.end_date) {
                    packageRange = {
                        start_date: moment(pkg.start_date).format('YYYY-MM-DD'),
                        end_date: moment(pkg.end_date).format('YYYY-MM-DD'),
                        name: pkg.name
                    };
                }
            }
        }

        for (const [dateLabel, tappChoice] of Object.entries(matrixAnswers)) {
            if (!tappChoice) continue;

            const normalizedDate = normalizeDateString(dateLabel, year);
            if (!normalizedDate) continue;

            // Package date boundary guard
            if (packageRange) {
                if (normalizedDate < packageRange.start_date || normalizedDate > packageRange.end_date) {
                    logger.warn('[TAPP_HOOK] Skipping date outside participant package dates', {
                        cardno,
                        date: normalizedDate,
                        packageRange
                    });
                    continue;
                }
            }

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
