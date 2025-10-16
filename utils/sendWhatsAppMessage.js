import axios from "axios";
import dotenv from "dotenv";
dotenv.config({ path: ".env.dev" });


const API_URL = process.env.WHATSAPP_API_URL;
const TOKEN = process.env.WHATSAPP_BEARER_TOKEN;
const DEFAULT_LANG = process.env.WHATSAPP_DEFAULT_LANG || "en";

/**
 * Send a WhatsApp template message.
 * @param {string} phone - Recipient phone number with country code.
 * @param {string} templateName - Template name registered in WhatsApp.
 * @param {string[]} params - Array of template parameters ({{1}}, {{2}}, ...).
 */
export async function sendWhatsAppMessage(phone, templateName, params = []) {
  try {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: DEFAULT_LANG },
      },
    };

    if (params.length > 0) {
      payload.template.components = [
        {
          type: "body",
          parameters: params.map((p) => ({ type: "text", text: p })),
        },
      ];
    }

    await axios.post(API_URL, payload, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
    });

    console.log(`✅ WhatsApp sent to ${phone}`);
  } catch (err) {
    console.error(`❌ WhatsApp failed for ${phone}`);
console.error("Status:", err.response?.status);
console.error("Data:", JSON.stringify(err.response?.data, null, 2));
console.error("Message:", err.message);
  }
}
