import axios from "axios";


const API_URL = process.env.WHATSAPP_API_URL;
const TOKEN = process.env.WHATSAPP_BEARER_TOKEN;
const DEFAULT_LANG = process.env.WHATSAPP_DEFAULT_LANG || "en_US";

/**
 * Send a WhatsApp template message.
 * @param {string} phone - Recipient phone number with country code.
 * @param {string} templateName - Template name registered in WhatsApp.
 * @param {Array} components - Array of template components (body, buttons, etc.)
 * @returns {Promise<{ok: true, phone: string, templateName: string, responseData: any}>}
 * @throws {Error}
 */
export async function sendWhatsAppMessage(phone, templateName, components = [], langCode = null) {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: langCode || DEFAULT_LANG },
    },
  };

  if (components.length > 0) {
    payload.template.components = components;
  }

  try {
    const response = await axios.post(API_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
      timeout: 15000,
    });

    console.log(`✅ WhatsApp sent to ${phone} using template ${templateName}`);

    return {
      ok: true,
      phone,
      templateName,
      responseData: response.data,
    };
  } catch (err) {
    console.error(`❌ WhatsApp failed for ${phone} using template ${templateName}`);
    console.error("Status:", err.response?.status);
    console.error("Data:", JSON.stringify(err.response?.data, null, 2));
    console.error("Message:", err.message);

    err.whatsappContext = {
      phone,
      templateName,
      status: err.response?.status ?? null,
      responseData: err.response?.data ?? null,
    };

    throw err;
  }
}