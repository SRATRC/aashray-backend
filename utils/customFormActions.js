import FoodDb from '../models/food_db.model.js';
import logger from '../config/logger.js';

// -- Paryushan Tapascharya meal cancellation map ------------------------------
// Values: 1 = keep meal, 0 = cancel meal
const TAPP_MEAL_MAP = {
    'Upvaas':                         { breakfast: 0, lunch: 0, dinner: 0 },
    'Aayambil':                       { breakfast: 0, lunch: 1, dinner: 0 },
    'Ekasna (Breakfast)':             { breakfast: 1, lunch: 0, dinner: 0 },
    'Ekasna (Lunch)':                 { breakfast: 0, lunch: 1, dinner: 0 },
    'Ekasna (Dinner)':                { breakfast: 0, lunch: 0, dinner: 1 },
    'Biyasna (Breakfast + Lunch)':    { breakfast: 1, lunch: 1, dinner: 0 },
    'Biyasna (Breakfast + Dinner)':   { breakfast: 1, lunch: 0, dinner: 1 },
    'Biyasna (Lunch + Dinner)':       { breakfast: 0, lunch: 1, dinner: 1 },
    'Only Liquid':                    { breakfast: 0, lunch: 0, dinner: 0 },
};

/**
 * Dispatcher — called after every form submission/update.
 * Checks if the form has a registered action hook and runs it.
 *
 * @param {object} form        - Sequelize CustomForm instance
 * @param {object} responses   - Plain responses object { fieldId: value }
 * @param {string|null} cardno - Resolved card number of the respondent
 */
export const handleFormSubmissionActions = async (form, responses, cardno) => {
    if (!cardno) return;

    // Hook: Paryushan Tapascharya
    // Triggered for forms whose dept_name is 'food' AND title contains 'tapascharya'.
    if (
        form.dept_name?.toLowerCase() === 'food' &&
        form.title?.toLowerCase().includes('tapascharya')
    ) {
        await handleParyushanTapascharya(form, responses, cardno);
    }
};

async function handleParyushanTapascharya(form, responses, cardno) {
    const fields = form.fields || [];

    // Find the date field
    const dateField = fields.find(f => f.type === 'date');

    // Find the tapp field — label must contain 'tapp' or 'tapascharya'
    const tappField = fields.find(f =>
        f.label?.toLowerCase().includes('tapp') ||
        f.label?.toLowerCase().includes('tapascharya')
    );

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

    const mealUpdate = TAPP_MEAL_MAP[selectedTapp];
    if (!mealUpdate) {
        logger.warn('[TAPP_HOOK] Unknown tapp value — no meal update applied', {
            formId: form.id, cardno, selectedTapp
        });
        return;
    }

    try {
        const [rowsAffected] = await FoodDb.update(
            {
                breakfast: mealUpdate.breakfast,
                lunch:     mealUpdate.lunch,
                dinner:    mealUpdate.dinner,
                updatedBy: 'SYSTEM-TAPASCHARYA'
            },
            { where: { cardno, date: selectedDate } }
        );

        logger.info('[TAPP_HOOK] Meal update applied', {
            cardno,
            date: selectedDate,
            tapp: selectedTapp,
            mealUpdate,
            rowsAffected
        });
    } catch (err) {
        // Log but do NOT throw — a hook failure must never break the form submission
        logger.error('[TAPP_HOOK] Failed to update food_db', {
            cardno, date: selectedDate, error: err.message
        });
    }
}
