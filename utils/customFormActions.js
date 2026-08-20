import FoodDb from '../models/food_db.model.js';
import logger from '../config/logger.js';

// -- Paryushan Tapascharya meal cancellation map ------------------------------
// Values: 1 = keep meal, 0 = cancel meal
const TAPP_MEAL_MAP = {
    'Upvaas':                         { breakfast: 0, lunch: 0, dinner: 0 },
    'Upvas':                          { breakfast: 0, lunch: 0, dinner: 0 },
    'Aayambil':                       { breakfast: 0, lunch: 1, dinner: 0 },
    'Ayambil':                        { breakfast: 0, lunch: 1, dinner: 0 },
    'Ekasna (Breakfast)':             { breakfast: 1, lunch: 0, dinner: 0 },
    'Ekasna (Lunch)':                 { breakfast: 0, lunch: 1, dinner: 0 },
    'Ekasna (Dinner)':                { breakfast: 0, lunch: 0, dinner: 1 },
    'Biyasna (Breakfast + Lunch)':    { breakfast: 1, lunch: 1, dinner: 0 },
    'Biyasna (Breakfast + Dinner)':   { breakfast: 1, lunch: 0, dinner: 1 },
    'Biyasna (Lunch + Dinner)':       { breakfast: 0, lunch: 1, dinner: 1 },
    'Only Liquid':                    { breakfast: 0, lunch: 0, dinner: 0 },
    'None / Regular Meal':            { breakfast: 1, lunch: 1, dinner: 1 },
    'Regular Meal':                   { breakfast: 1, lunch: 1, dinner: 1 },
    'None':                           { breakfast: 1, lunch: 1, dinner: 1 },
};

function normalizeDateString(dateKey, fallbackYear = 2026) {
    if (!dateKey) return null;
    const trimmed = String(dateKey).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

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
        logger.info('[TAPP_HOOK] Created food_db record for tapascharya', { cardno, date: normalizedDate, tappChoice, mealUpdate });
    }
}

async function handleParyushanTapascharya(form, responses, cardno) {
    const fields = form.fields || [];

    // 1. Check if form uses a Radio Grid (Matrix table of dates vs fasting types)
    const gridField = fields.find(f => f.type === 'grid_radio');
    if (gridField && responses[gridField.id] && typeof responses[gridField.id] === 'object') {
        const gridAnswers = responses[gridField.id];
        const year = form.event_name?.match(/\b(20\d\d)\b/) ? parseInt(RegExp.$1, 10) : new Date().getFullYear();

        for (const [dateLabel, tappChoice] of Object.entries(gridAnswers)) {
            if (!tappChoice) continue;
            const normalizedDate = normalizeDateString(dateLabel, year);
            if (!normalizedDate) continue;

            const mealUpdate = TAPP_MEAL_MAP[String(tappChoice).trim()];
            if (!mealUpdate) continue;

            try {
                await applyMealChange(cardno, normalizedDate, mealUpdate, tappChoice);
            } catch (err) {
                logger.error('[TAPP_HOOK] Failed to update food_db for date ' + normalizedDate, {
                    cardno, error: err.message
                });
            }
        }
        return;
    }

    // 2. Fallback: Single Date + Single Fasting Type
    const dateField = fields.find(f => f.type === 'date');
    const tappField = fields.find(f => {
        if (f.type === 'date') return false;
        const lbl = (f.label || '').toLowerCase();
        return lbl.includes('tapp') || lbl.includes('tapascharya') || lbl.includes('fasting') || ['radio', 'select'].includes(f.type);
    });

    if (!dateField || !tappField) {
        logger.warn('[TAPP_HOOK] Could not find date or tapp field in form', {
            formId: form.id, formTitle: form.title
        });
        return;
    }

    const selectedDate = responses[dateField.id];
    const selectedTapp = responses[tappField.id];

    if (!selectedDate || !selectedTapp) {
        logger.warn('[TAPP_HOOK] Missing date or tapp value in responses', {
            formId: form.id, cardno, selectedDate, selectedTapp
        });
        return;
    }

    const cleanTapp = String(selectedTapp).trim();
    const mealUpdate = TAPP_MEAL_MAP[cleanTapp];

    if (!mealUpdate) {
        logger.warn('[TAPP_HOOK] Unknown tapp value – no meal update applied', {
            formId: form.id, cardno, selectedTapp: cleanTapp
        });
        return;
    }

    try {
        await applyMealChange(cardno, selectedDate, mealUpdate, cleanTapp);
    } catch (err) {
        logger.error('[TAPP_HOOK] Failed to update food_db', {
            cardno, date: selectedDate, error: err.message
        });
    }
}
