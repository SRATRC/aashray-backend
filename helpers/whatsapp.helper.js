import Sequelize from "sequelize";
// at top of both files (whatsapp.helper and mumukshuBooking.controller)
import { Op } from 'sequelize';
import { CardDb, Transactions, UtsavDb, UtsavPackagesDb, ShibirDb, FoodDb, BulkFoodBooking, WaGroupJob } from "../models/associations.js";
import moment from "moment-timezone";
import { TYPE_ADHYAYAN, TYPE_TRAVEL, TYPE_ROOM, TYPE_UTSAV, RESEARCH_CENTRE, TYPE_FOOD } from "../config/constants.js";
import { sendWhatsAppMessage } from "../utils/sendWhatsAppMessage.js";
import { formatWhatsAppPhone } from "../utils/phoneFormatter.js";
import fs from "fs";
import path from "path";

function sanitizeParamText(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
}

const TEMPLATE_PARAM_COUNTS = {
  booking_adhyayan_self_pending_for: 9,
  booking_sharan_self_pending_for: 10,
  booking_utsav_self_confirmed_for: 12,
  // add the actual counts for your templates
};

/**
 * Helper that tries primary template and if WhatsApp returns a "template missing" 404,
 * retries with a fallback template (usually a 'confirmed' variant). Non-fatal.
 */
async function sendWithTemplateFallback(phone, template, components) {
  const trySend = async (tpl, comps, lang = null) => {
    try {
      const result = await sendWhatsAppMessage(phone, tpl, comps, lang);
      return { ok: true, usedTemplate: tpl, responseData: result.responseData };
    } catch (err) {
      const status = err?.response?.status || err?.whatsappContext?.status;
      const details = err?.response?.data || err?.whatsappContext?.responseData;
      const errorMsg = String(
        details?.error?.message ||
        details?.error?.error_data?.details ||
        err?.message ||
        ""
      ).toLowerCase();
      const isTemplateMissing =
        status === 404 &&
        (errorMsg.includes("does not exist") || errorMsg.includes("template name"));
      return { ok: false, error: err, isTemplateMissing };
    }
  };

  // 1. Try original template with default lang (en_US)
  let attempt = await trySend(template, components);
  if (attempt.ok) return attempt;

  // 2. If template missing and default isn't "en", retry original with "en"
  const defaultLang = process.env.WHATSAPP_DEFAULT_LANG || "en_US";
  if (attempt.isTemplateMissing && defaultLang !== "en") {
    console.log(`WA SEND: template '${template}' missing in ${defaultLang}, retrying with 'en'`);
    attempt = await trySend(template, components, "en");
    if (attempt.ok) return attempt;
  }

  // 3. If still missing, try fallback template
  if (attempt.isTemplateMissing) {
    let fallbackTemplate = template;
    let fallbackComponents = components;

    if (template.startsWith("bn_adh_gu_b_") || template.startsWith("bk_adh_gu_b_")) {
      fallbackTemplate = "bn_adh_gu_b_cf";
      // bn_adh_gu_b_cf expects only 3 body parameters: [bookerName, shibirName, paymentId]
      fallbackComponents = JSON.parse(JSON.stringify(components));
      const bodyComp = fallbackComponents.find(c => c.type === "body");
      if (bodyComp && bodyComp.parameters && bodyComp.parameters.length > 3) {
        bodyComp.parameters = bodyComp.parameters.slice(0, 3);
      }
    } else if (template.startsWith("bn_adh_gu_f_") || template.startsWith("bk_adh_gu_f_")) {
      fallbackTemplate = "bn_adh_gu_f_cf";
      // bn_adh_gu_f_cf expects only 2 body parameters: [attendeeName, shibirName]
      fallbackComponents = JSON.parse(JSON.stringify(components));
      const bodyComp = fallbackComponents.find(c => c.type === "body");
      if (bodyComp && bodyComp.parameters && bodyComp.parameters.length > 2) {
        bodyComp.parameters = bodyComp.parameters.slice(0, 2);
      }
    } else if (template.startsWith("bn_adh_s_b_") || template.startsWith("bk_adh_s_b_")) {
      fallbackTemplate = "bn_adh_s_b_cnf";
    } else if (template.startsWith("bn_sha_gu_b_") || template.startsWith("bk_sha_gu_b_")) {
      fallbackTemplate = "bn_sha_gu_b_cf";
      fallbackComponents = JSON.parse(JSON.stringify(components));
      const bodyComp = fallbackComponents.find(c => c.type === "body");
      if (bodyComp && bodyComp.parameters) {
        if (bodyComp.parameters.length >= 7) {
          bodyComp.parameters.splice(5, 1); // remove creditsStr if present
        }
        if (bodyComp.parameters.length >= 5) {
          const statusVal = bodyComp.parameters[4].text;
          bodyComp.parameters[3] = { type: "text", text: statusVal };
          bodyComp.parameters[4] = { type: "text", text: "N/A" };
        }
        if (bodyComp.parameters.length > 6) {
          bodyComp.parameters = bodyComp.parameters.slice(0, 6);
        }
      }
    } else if (template.startsWith("bn_sha_gu_f_") || template.startsWith("bk_sha_gu_f_")) {
      fallbackTemplate = "bn_sha_gu_f_cf";
      fallbackComponents = JSON.parse(JSON.stringify(components));
      const bodyComp = fallbackComponents.find(c => c.type === "body");
      if (bodyComp && bodyComp.parameters && bodyComp.parameters.length >= 5) {
        bodyComp.parameters.splice(3, 1); // remove checkout date
        if (bodyComp.parameters.length > 4) {
          bodyComp.parameters = bodyComp.parameters.slice(0, 4);
        }
      }
    } else if (template.startsWith("bn_sha_s_b_") || template.startsWith("bk_sha_s_b_")) {
      fallbackTemplate = "bn_sha_s_b_cf";
      fallbackComponents = JSON.parse(JSON.stringify(components));
      const bodyComp = fallbackComponents.find(c => c.type === "body");
      if (bodyComp && bodyComp.parameters && bodyComp.parameters.length >= 5) {
        const roomType = bodyComp.parameters[4].text;
        bodyComp.parameters[3] = { type: "text", text: roomType };
        bodyComp.parameters[4] = { type: "text", text: "N/A" };
      }
    } else if (template === "bk_usv_s_b_canc2adcanc_wcre") {
      fallbackTemplate = "bk_usv_gu_b_canc2adcanc_wcre";
      fallbackComponents = JSON.parse(JSON.stringify(components));
      const bodyComp = fallbackComponents.find(c => c.type === "body");
      if (bodyComp && bodyComp.parameters && bodyComp.parameters.length === 5) {
        bodyComp.parameters.push(bodyComp.parameters[0]);
      }
    } else {
      fallbackTemplate = fallbackTemplate.replace(
        /_pending_for|_pending|_waiting_for|_waiting/gi,
        "_confirmed"
      );
      if (fallbackTemplate === template) {
        fallbackTemplate = "booking_adhyayan_self_confirmed";
      }
    }

    console.log(`WA SEND: retrying with fallback template '${fallbackTemplate}'`);
    // Try fallback with default lang
    attempt = await trySend(fallbackTemplate, fallbackComponents);
    if (attempt.ok) return { ...attempt, fallback: true };

    // Try fallback with "en"
    if (attempt.isTemplateMissing && defaultLang !== "en") {
      console.log(`WA SEND: fallback template '${fallbackTemplate}' missing in ${defaultLang}, retrying with 'en'`);
      attempt = await trySend(fallbackTemplate, fallbackComponents, "en");
      if (attempt.ok) return { ...attempt, fallback: true };
    }
  }

  // Return the last failure
  return { ok: false, error: attempt.error };
}

// Exported main function
export async function sendUnifiedWhatsApp(
  cardno,
  adhyanBookingDetails = [],
  travelBookingDetails = [],
  flatBookingDetails = [],
  utsavBookingDetails = [],
  roomBookingDetails = [],
  bookedForCardno = null, // NEW optional arg
  foodBookingDetails = [] // NEW optional arg
) {
  try {
    if (!cardno) {
      console.warn("sendUnifiedWhatsApp called without cardno");
      return;
    }

    let user;
    if (typeof cardno === "object" && cardno !== null && cardno.cardno) {
      user = cardno;
    } else {
      user = await CardDb.findOne({ where: { cardno } });
    }

    if (!user) {
      console.warn(`No Card record found for cardno=${cardno}`);
      return;
    }

    // If caller provided bookedForCardno, fetch that card (optional)
    let bookedForUser = null;
    if (bookedForCardno) {
      bookedForUser = await CardDb.findOne({ where: { cardno: bookedForCardno } }).catch(() => null);
      // if not found, we fallback later to user.issuedto
    }

    const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
    if (!phone) {
      console.warn(`⚠️ No WhatsApp number found for ${user?.issuedto} (cardno=${user.cardno})`);
      return;
    }

    // prepare jobs for all types (run concurrently)
    const jobs = [];

    if (Array.isArray(adhyanBookingDetails) && adhyanBookingDetails.length) {
      jobs.push(sendAdhyayanWhatsApp(user, adhyanBookingDetails, bookedForUser));
    }
    if (Array.isArray(roomBookingDetails) && roomBookingDetails.length) {
      jobs.push(sendRoomWhatsApp(user, roomBookingDetails, bookedForUser));
    }
    if (Array.isArray(utsavBookingDetails) && utsavBookingDetails.length) {
      jobs.push(sendUtsavWhatsApp(user, utsavBookingDetails, bookedForUser));
    }
    if (Array.isArray(travelBookingDetails) && travelBookingDetails.length) {
      jobs.push(sendTravelWhatsApp(user, travelBookingDetails, bookedForUser));
    }
    if (Array.isArray(flatBookingDetails) && flatBookingDetails.length) {
      jobs.push(sendFlatWhatsApp(user, flatBookingDetails, bookedForUser));
    }
    if (Array.isArray(foodBookingDetails) && foodBookingDetails.length) {
      jobs.push(sendFoodWhatsApp(user, foodBookingDetails, bookedForUser));
    }

    if (jobs.length === 0) {
      // nothing to send
      return;
    }

    const results = await Promise.allSettled(jobs);
    results.forEach((r) => {
      if (r.status === "rejected") {
        console.error("One of the WA type-sends rejected:", r.reason);
      }
    });
  } catch (err) {
    console.error("❌ WhatsApp integration error:", err);
  }
}

// --- Helper: Adhyayan (Shibir) message sender ---
export async function sendAdhyayanWhatsApp(user, adhyanBookingDetails = [], bookedForUser = null) {
  if (!user) {
    console.warn("sendAdhyayanWhatsApp called without user");
    return;
  }

  const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno || "unknown"}; skipping adhyayan WA.`);
    return;
  }

  const isNRI = user && user.country && String(user.country).trim().toLowerCase() !== 'india';

  // Cache for card name lookups (minimize DB hits)
  const cardCache = new Map();
  if (user && user.cardno) cardCache.set(String(user.cardno), user.issuedto || "");
  if (bookedForUser && bookedForUser.cardno) cardCache.set(String(bookedForUser.cardno), bookedForUser.issuedto || "");

  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) {
    bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");
  }

  async function getCardName(cardno) {
    if (!cardno) return "";
    const cno = String(cardno);
    if (cardCache.has(cno)) return cardCache.get(cno);
    try {
      const card = await CardDb.findOne({ where: { cardno: cno } });
      const name = card && card.issuedto ? card.issuedto : "";
      cardCache.set(cno, name);
      return name;
    } catch (err) {
      console.warn(`Failed to lookup card name for cardno=${cno}:`, err.message || err);
      return "";
    }
  }

  // defensive: ensure we always have an array
  if (!Array.isArray(adhyanBookingDetails)) adhyanBookingDetails = [];

  for (const b of adhyanBookingDetails) {
    if (!b || typeof b !== "object") {
      console.warn("Skipping invalid adhyayan booking entry:", b);
      continue;
    }

    try {
      // --- normalize status and treat missing as 'pending' ---
      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const bookingStatus = rawStatus.trim().toLowerCase(); // now always a lowercased string

      const shibir = b.ShibirDb || {};
      const bookingId = b.bookingid || b.bookingId || (b.id ? String(b.id) : "");

      const isResearchCentre = shibir && shibir.location === RESEARCH_CENTRE;

      let template = "booking_adhyayan_self_confirmed";
      let components = [];

      if (isResearchCentre) {
        const isGuestBy = bookedForUser && bookedForUser.cardno !== user.cardno;
        const isGuestFor = b.bookedBy && b.bookedBy !== user.cardno;

        let bodyParams = [];
        let headerParam = "";

        if (isGuestBy) {
          const attendeeName = bookedForUser.issuedto || "";
          const bookerName = user.issuedto || "";
          headerParam = attendeeName;

          if (bookingStatus === "waiting" || bookingStatus.startsWith("wait")) {
            template = "bn_adh_gu_b_wg";
            bodyParams = [bookerName, shibir.name || "", "waiting"];
          } else if (bookingStatus === "pending" || bookingStatus.includes("pend")) {
            template = isNRI ? "bn_adh_gu_b_ppg_nri" : "bn_adh_gu_b_ppg";
            bodyParams = [bookerName, shibir.name || "", "payment pending"];
          } else {
            template = "bn_adh_gu_b_cf";
            const transaction = await Transactions.findOne({
              where: { bookingid: bookingId }
            }).catch(() => null);
            const paymentId = transaction?.razorpay_order_id || transaction?.id || "N/A";
            bodyParams = [bookerName, shibir.name || "", paymentId];
          }
        } else if (isGuestFor) {
          const bookerName = await getCardName(b.bookedBy);
          const attendeeName = user.issuedto || "";
          headerParam = bookerName;

          if (bookingStatus === "waiting" || bookingStatus.startsWith("wait")) {
            template = "bn_adh_gu_f_wg";
            bodyParams = [attendeeName, shibir.name || "", "waiting"];
          } else if (bookingStatus === "pending" || bookingStatus.includes("pend")) {
            template = "bn_adh_gu_f_ppg";
            bodyParams = [attendeeName, shibir.name || "", "payment pending"];
          } else {
            template = "bn_adh_gu_f_cf";
            bodyParams = [attendeeName, shibir.name || ""];
          }
        } else {
          if (bookingStatus === "waiting" || bookingStatus.startsWith("wait")) {
            template = "bn_adh_s_b_w";
            bodyParams = [user.issuedto || "", shibir.name || "", "waiting"];
          } else if (bookingStatus === "pending" || bookingStatus.includes("pend")) {
            template = isNRI ? "bn_adh_s_b_ppg_nri" : "bn_adh_s_b_ppg";
            bodyParams = [user.issuedto || "", shibir.name || "", "payment pending"];
          } else {
            template = "bn_adh_s_b_cnf";
            const transaction = await Transactions.findOne({
              where: { bookingid: bookingId }
            }).catch(() => null);
            const paymentId = transaction?.razorpay_order_id || transaction?.id || "N/A";
            bodyParams = [user.issuedto || "", shibir.name || "", paymentId];
          }
        }

        const bodyComp = buildBodyComponents(bodyParams)[0];
        if (headerParam) {
          const sanitizedHeader = sanitizeParamText(headerParam);
          const headerParameters = [{ type: "text", text: sanitizedHeader === "" ? " " : sanitizedHeader }];
          components = [
            { type: "header", parameters: headerParameters },
            bodyComp
          ];
        } else {
          components = [bodyComp];
        }
      } else {
        // tolerant template selection for non-Research Centre
        if (bookingStatus === "waiting" || bookingStatus.startsWith("wait")) {
          template = "booking_adhyayan_self_waiting_for";
        } else if (bookingStatus === "pending" || bookingStatus.includes("pend")) {
          template = "booking_adhyayan_self_pending_for";
        } else {
          template = "booking_adhyayan_self_confirmed";
        }

        // Determine booked-for name priority:
        // 1) If booking object annotated with __bookedForCardno -> lookup that cardno (cached)
        // 2) Else if bookedForUser provided -> use that
        // 3) Else fallback to recipient (user.issuedto)
        let bookedForName = user.issuedto || "";

        if (b.__bookedForCardno) {
          const bfCardno = String(b.__bookedForCardno);
          if (bookedForCache.has(bfCardno)) {
            bookedForName = bookedForCache.get(bfCardno) || bookedForName;
          } else {
            try {
              const bf = await CardDb.findOne({ where: { cardno: bfCardno } });
              const bfName = bf && bf.issuedto ? bf.issuedto : "";
              bookedForCache.set(bfCardno, bfName);
              if (bfName) bookedForName = bfName;
            } catch (innerErr) {
              if (bookedForUser && bookedForUser.issuedto) {
                bookedForName = bookedForUser.issuedto;
              }
              console.warn(`Failed to lookup bookedFor card ${bfCardno}:`, innerErr && (innerErr.message || innerErr));
            }
          }
        } else if (bookedForUser && bookedForUser.issuedto) {
          bookedForName = bookedForUser.issuedto;
        }

        const params = [
          user.issuedto || "",   // recipient name (who gets the message)
          bookedForName,         // booked-for name
          bookingId,
          rawStatus || "",       // original (or defaulted) status string
          shibir.name || "",
          shibir.venue || "Research Centre",
          shibir.speaker || "",
          shibir.start_date ? moment(shibir.start_date).format("DD MMM YYYY") : "",
          shibir.end_date ? moment(shibir.end_date).format("DD MMM YYYY") : ""
        ];

        const bodyParameters = params
          .filter((p) => p !== null && p !== undefined && p !== "")
          .map((p) => ({ type: "text", text: String(p) }));

        components = [{ type: "body", parameters: bodyParameters }];

        // Button only for waiting/pending templates
        if ((template === "booking_adhyayan_self_waiting_for" || template === "booking_adhyayan_self_pending_for") && shibir.id) {
          components.push({
            type: "button",
            sub_type: "url",
            index: 0,
            parameters: [{ type: "text", text: String(shibir.id) }]
          });
        }
      }

      // Debug log so we can verify behavior
      console.log(`WA ADHYAYAN: to=${user.cardno} phone=${phone} bookingId=${bookingId} rawStatus='${String(b.status)}' normalized='${bookingStatus}' -> template='${template}' shibirExists=${!!shibir && !!shibir.name}`);

      // send with fallback handling
      const sendResult = await sendWithTemplateFallback(phone, template, components);
      if (!sendResult.ok) {
        console.error("Adhyayan WA failed for booking", bookingId, sendResult.error);
      } else {
        console.log("📩 Adhyayan WhatsApp sent:", {
          toCard: user.cardno,
          bookingid: bookingId,
          status: bookingStatus,
          template: sendResult.usedTemplate,
          fallbackUsed: !!sendResult.fallback
        });
      }
    } catch (err) {
      console.error(
        "Error sending adhyayan WhatsApp for booking",
        b.bookingid || b.bookingId || b.id,
        err && (err.stack || err.message || err)
      );
    }
  }
}

// --- Generic pattern for other booking types (room, travel, utsav, flat) ---
// Each follows the same robust pattern: normalize status, pick template, resolve bookedForName, assemble params, call sendWithTemplateFallback.

// ROOM

export async function sendRoomWhatsApp(user, roomBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping room WA.`);
    return;
  }

  const isNRI = user && user.country && String(user.country).trim().toLowerCase() !== 'india';

  if (!Array.isArray(roomBookingDetails)) roomBookingDetails = [];

  // Build bookingIds list
  const bookingIds = roomBookingDetails
    .map((b) => (b.bookingid || b.bookingId || b.id ? String(b.bookingid || b.bookingId || b.id) : null))
    .filter(Boolean);

  // Fetch transactions in batch
  let transactionsMap = new Map();
  try {
    if (bookingIds.length && typeof Transactions !== "undefined") {
      const txRows = await Transactions.findAll({
        where: { bookingid: { [Op.in]: bookingIds } },
        attributes: ["bookingid", "amount", "discount", "razorpay_order_id"]
      });

      for (const tx of txRows) {
        transactionsMap.set(String(tx.bookingid), {
          amount: tx.amount,
          discount: tx.discount,
          razorpay_order_id: tx.razorpay_order_id
        });
      }
    }
  } catch (err) {
    console.warn("Failed to fetch transactions for room bookings (non-fatal):", err && (err.message || err));
  }

  const cardCache = new Map();
  if (user && user.cardno) cardCache.set(String(user.cardno), user.issuedto || "");
  if (bookedForUser && bookedForUser.cardno) cardCache.set(String(bookedForUser.cardno), bookedForUser.issuedto || "");

  async function getCardName(cardno) {
    if (!cardno) return "";
    const cno = String(cardno);
    if (cardCache.has(cno)) return cardCache.get(cno);
    try {
      const card = await CardDb.findOne({ where: { cardno: cno } });
      const name = card && card.issuedto ? card.issuedto : "";
      cardCache.set(cno, name);
      return name;
    } catch (err) {
      console.warn(`Failed to lookup card name for cardno=${cno}:`, err.message || err);
      return "";
    }
  }

  for (const b of roomBookingDetails) {
    try {
      if (!b || typeof b !== "object") continue;

      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const bookingStatus = rawStatus.trim().toLowerCase();

      // Normalize status to waiting, pending, or confirmed
      let statusNormalized = "confirmed";
      if (bookingStatus === "waiting" || bookingStatus.startsWith("wait")) {
        statusNormalized = "waiting";
      } else if ((bookingStatus === "pending" || bookingStatus.includes("pend")) && !bookingStatus.includes("checkin")) {
        statusNormalized = "pending";
      }

      const isGuestBy = bookedForUser && bookedForUser.cardno !== user.cardno;
      const isGuestFor = b.bookedBy && b.bookedBy !== user.cardno;

      let template = "bn_sha_s_b_cf";
      let bodyParams = [];
      let headerParam = "";

      const checkinFormatted = b.checkin
        ? (moment(b.checkin, "Do MMMM, YYYY", true).isValid()
          ? moment(b.checkin, "Do MMMM, YYYY").format("DD-MM-YYYY")
          : (moment(b.checkin, "DD-MM-YYYY", true).isValid()
            ? moment(b.checkin, "DD-MM-YYYY").format("DD-MM-YYYY")
            : moment(b.checkin).format("DD-MM-YYYY")))
        : "";
      const checkoutFormatted = b.checkout
        ? (moment(b.checkout, "Do MMMM, YYYY", true).isValid()
          ? moment(b.checkout, "Do MMMM, YYYY").format("DD-MM-YYYY")
          : (moment(b.checkout, "DD-MM-YYYY", true).isValid()
            ? moment(b.checkout, "DD-MM-YYYY").format("DD-MM-YYYY")
            : moment(b.checkout).format("DD-MM-YYYY")))
        : "";
      const roomTypeStr = (b.roomtype || "").toLowerCase().includes("nac") ? "non-ac" : "ac";

      const bookingId = String(b.bookingid || b.bookingId || b.id || "");

      const isDayVisit = b.nights === 0 || b.checkin === b.checkout || b.roomtype === "NA";

      if (isDayVisit) {
        if (isGuestBy) {
          template = "bn_sha_gu_b_cf_sdv";
          const attendeeName = bookedForUser?.issuedto || "";
          const bookerName = user.issuedto || "";
          headerParam = attendeeName;
          bodyParams = [bookerName, checkinFormatted];
        } else if (isGuestFor) {
          template = "bn_sha_gu_f_cf_sdv";
          const bookerName = await getCardName(b.bookedBy);
          const attendeeName = user.issuedto || "";
          headerParam = bookerName;
          bodyParams = [attendeeName, checkinFormatted];
        } else {
          template = "bn_sha_s_b_cf_sdv";
          const bookerName = user.issuedto || "";
          headerParam = "";
          bodyParams = [bookerName, checkinFormatted];
        }
      } else {
        if (isGuestBy) {
          const attendeeName = bookedForUser.issuedto || "";
          const bookerName = user.issuedto || "";
          headerParam = attendeeName;

          if (statusNormalized === "waiting") {
            template = "bn_sha_gu_b_w";
            bodyParams = [bookerName, checkinFormatted, checkoutFormatted, "waiting", roomTypeStr];
          } else if (statusNormalized === "pending") {
            template = isNRI ? "bn_sha_gu_b_ppg_nri" : "bn_sha_gu_b_ppg";
            bodyParams = [bookerName, checkinFormatted, checkoutFormatted, "payment pending", roomTypeStr];
          } else {
            template = "bn_sha_gu_b_cf";
            const tx = transactionsMap.get(bookingId) || { razorpay_order_id: null, id: null };
            const paymentId = tx.razorpay_order_id || tx.id || "N/A";
            bodyParams = [bookerName, checkinFormatted, checkoutFormatted, roomTypeStr, paymentId];
          }
        } else if (isGuestFor) {
          const bookerName = await getCardName(b.bookedBy);
          const attendeeName = user.issuedto || "";
          headerParam = bookerName;

          if (statusNormalized === "waiting") {
            template = "bn_sha_gu_f_wg";
            bodyParams = [attendeeName, checkinFormatted, checkoutFormatted, "waiting", roomTypeStr];
          } else if (statusNormalized === "pending") {
            template = "bn_sha_gu_f_pp";
            bodyParams = [attendeeName, checkinFormatted, checkoutFormatted, "payment pending", roomTypeStr];
          } else {
            template = "bn_sha_gu_f_cf";
            bodyParams = [attendeeName, checkinFormatted, checkoutFormatted, roomTypeStr];
          }
        } else {
          const bookerName = user.issuedto || "";

          if (statusNormalized === "waiting") {
            template = "bn_sha_s_b_w";
            bodyParams = [bookerName, checkinFormatted, checkoutFormatted, "waiting", roomTypeStr];
          } else if (statusNormalized === "pending") {
            template = isNRI ? "bn_sha_s_b_ppg_nri" : "bn_sha_s_b_ppg";
            bodyParams = [bookerName, checkinFormatted, checkoutFormatted, "payment pending", roomTypeStr];
          } else {
            template = "bn_sha_s_b_cf";
            const tx = transactionsMap.get(bookingId) || { razorpay_order_id: null, id: null };
            const paymentId = tx.razorpay_order_id || tx.id || "N/A";
            bodyParams = [bookerName, checkinFormatted, checkoutFormatted, roomTypeStr, paymentId];
          }
        }
      }

      const sanitizedParams = bodyParams.map(p => sanitizeParamText(p));
      const bodyComp = buildBodyComponents(sanitizedParams)[0];
      let components = [];

      if (headerParam) {
        const sanitizedHeader = sanitizeParamText(headerParam);
        const headerParameters = [{ type: "text", text: sanitizedHeader === "" ? " " : sanitizedHeader }];
        components = [
          { type: "header", parameters: headerParameters },
          bodyComp
        ];
      } else {
        components = [bodyComp];
      }

      console.log(`WA ROOM: to=${user.cardno} phone=${phone} bookingId=${bookingId} statusNormalized='${statusNormalized}' -> template='${template}'`);

      const result = await sendWithTemplateFallback(phone, template, components);

      if (!result || !result.ok) {
        console.error("Room WA failed for booking", bookingId, result && result.error ? result.error : "unknown");
      } else {
        console.log("📩 Room WhatsApp sent:", {
          toCard: user.cardno,
          booking: bookingId,
          template: result.usedTemplate || template
        });
      }
    } catch (err) {
      console.error("Error sending room WhatsApp for", b.id || b.bookingid || b, err && (err.stack || err.message || err));
    }
  }
}


// TRAVEL
export async function sendTravelWhatsApp(user, travelBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping travel WA.`);
    return;
  }

  const isNRI = user && user.country && String(user.country).trim().toLowerCase() !== 'india';

  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");

  async function getCardName(cardno) {
    if (!cardno) return "";
    const cno = String(cardno);
    if (bookedForCache.has(cno)) return bookedForCache.get(cno);
    try {
      const card = await CardDb.findOne({ where: { cardno: cno } });
      const name = card && card.issuedto ? card.issuedto : "";
      bookedForCache.set(cno, name);
      return name;
    } catch (err) {
      console.warn(`Failed to lookup card name for cardno=${cno}:`, err.message || err);
      return "";
    }
  }

  for (const b of Array.isArray(travelBookingDetails) ? travelBookingDetails : []) {
    try {
      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const status = rawStatus.trim().toLowerCase();

      let template = "";
      let bodyParams = [];
      let headerParam = "";

      const isAwaiting = status === "awaiting confirmation" || status.includes("await");

      if (isAwaiting) {
        const isGuestBy = bookedForUser && bookedForUser.cardno !== user.cardno;
        const isGuestFor = b.bookedBy && b.bookedBy !== user.cardno;

        const passengerType = b.total_people ? (parseInt(b.total_people) === 1 ? "single person" : `${b.total_people} people`) : "single person";
        let dateFormatted = "";
        if (b.date) {
          const dateStr = String(b.date);
          if (b.date instanceof Date || dateStr.includes("GMT") || dateStr.includes(":") || dateStr.length > 20) {
            dateFormatted = moment(b.date).format("DD-MM-YYYY");
          } else if (dateStr.includes("th") || dateStr.includes("st") || dateStr.includes("nd") || dateStr.includes("rd")) {
            dateFormatted = moment(b.date, "Do MMMM, YYYY").format("DD-MM-YYYY");
          } else {
            dateFormatted = moment(b.date).format("DD-MM-YYYY");
          }
        }

        if (isGuestBy) {
          const attendeeName = bookedForUser.issuedto || "";
          const bookerName = user.issuedto || "";
          template = "bn_pvs_mu_b_awtgcnfm";
          headerParam = attendeeName;
          bodyParams = [bookerName, b.pickuppoint || b.pickup_point || "", b.dropoffpoint || b.drop_point || "", "awaiting confirmation", passengerType, dateFormatted];
        } else if (isGuestFor) {
          const bookerName = await getCardName(b.bookedBy);
          const attendeeName = user.issuedto || "";
          template = "bn_pvs_mu_f_awcf";
          headerParam = bookerName;
          bodyParams = [attendeeName, b.pickuppoint || b.pickup_point || "", b.dropoffpoint || b.drop_point || "", "awaiting confirmation", passengerType, dateFormatted];
        } else {
          const bookerName = user.issuedto || "";
          template = "bn_pvs_s_b_awc";
          bodyParams = [bookerName, b.pickuppoint || b.pickup_point || "", b.dropoffpoint || b.drop_point || "", "awaiting confirmation", passengerType, dateFormatted];
        }
      } else {
        template = "booking_travel_confirmed";
        if (status === "waiting" || status.startsWith("wait")) template = "booking_travel_waiting";
        else if (status === "pending" || status.includes("pend")) {
          template = "";
        }

        let bookedForName = user.issuedto || "";
        if (b.__bookedForCardno) {
          const bf = String(b.__bookedForCardno);
          if (bookedForCache.has(bf)) bookedForName = bookedForCache.get(bf);
          else {
            const rec = await CardDb.findOne({ where: { cardno: bf } }).catch(() => null);
            const nm = rec?.issuedto || "";
            bookedForCache.set(bf, nm);
            if (nm) bookedForName = nm;
          }
        } else if (bookedForUser && bookedForUser.issuedto) {
          bookedForName = bookedForUser.issuedto;
        }

        bodyParams = [
          user.issuedto || "",
          bookedForName,
          b.id || b.bookingid || "",
          rawStatus || "",
          b.pickuppoint || b.pickup_point || "",
          b.dropoffpoint || b.drop_point || "",
          b.date || ""
        ];
      }

      const sanitizedParams = bodyParams.map(p => sanitizeParamText(p));
      const bodyComp = buildBodyComponents(sanitizedParams)[0];
      let components = [];

      if (headerParam) {
        const sanitizedHeader = sanitizeParamText(headerParam);
        const headerParameters = [{ type: "text", text: sanitizedHeader === "" ? " " : sanitizedHeader }];
        components = [
          { type: "header", parameters: headerParameters },
          bodyComp
        ];
      } else {
        components = [bodyComp];
      }

      if (!template) {
        console.log(`WA TRAVEL SKIP: No template defined for status '${status}'`);
        continue;
      }

      const result = await sendWithTemplateFallback(phone, template, components);
      if (!result.ok) console.error("Travel WA failed for booking", b, result.error);
      else console.log("📩 Travel WhatsApp sent:", { toCard: user.cardno, booking: b.id || b.bookingid || b, template: result.usedTemplate });
    } catch (err) {
      console.error("Error sending travel WhatsApp for", b.id || b.bookingid || b, err);
    }
  }
}

// UTSAV
export async function sendUtsavWhatsApp(user, utsavBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping utsav WA.`);
    return;
  }

  const isNRI = user && user.country && String(user.country).trim().toLowerCase() !== 'india';

  // defensive array
  if (!Array.isArray(utsavBookingDetails)) utsavBookingDetails = [];

  // collect bookingIds
  const bookingIds = utsavBookingDetails
    .map((b) => (b.bookingid || b.bookingId || b.id ? String(b.bookingid || b.bookingId || b.id) : null))
    .filter(Boolean);

  // fetch transactions in batch
  let transactionsMap = new Map();
  try {
    if (bookingIds.length && typeof Transactions !== "undefined") {
      const txRows = await Transactions.findAll({
        where: { bookingid: { [Op.in]: bookingIds } },
        attributes: ["bookingid", "amount", "discount", "razorpay_order_id"]
      });
      for (const tx of txRows) {
        transactionsMap.set(String(tx.bookingid), {
          amount: tx.amount,
          discount: tx.discount,
          razorpay_order_id: tx.razorpay_order_id
        });
      }
    }
  } catch (err) {
    console.warn("Failed to fetch transactions for utsav bookings (non-fatal):", err && (err.message || err));
  }

  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");

  async function getCardName(cardno) {
    if (!cardno) return "";
    const cno = String(cardno);
    if (bookedForCache.has(cno)) return bookedForCache.get(cno);
    try {
      const card = await CardDb.findOne({ where: { cardno: cno } });
      const name = card && card.issuedto ? card.issuedto : "";
      bookedForCache.set(cno, name);
      return name;
    } catch (err) {
      console.warn(`Failed to lookup card name for cardno=${cno}:`, err.message || err);
      return "";
    }
  }

  for (const b of utsavBookingDetails) {
    try {
      if (!b || typeof b !== "object") continue;

      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const status = rawStatus.trim().toLowerCase();

      // derive bookedFor name
      let bookedForName = user.issuedto || "";
      if (b.__bookedForCardno) {
        const bf = String(b.__bookedForCardno);
        if (bookedForCache.has(bf)) bookedForName = bookedForCache.get(bf);
        else {
          const rec = await CardDb.findOne({ where: { cardno: bf } }).catch(() => null);
          const nm = rec?.issuedto || "";
          bookedForCache.set(bf, nm);
          if (nm) bookedForName = nm;
        }
      } else if (bookedForUser && bookedForUser.issuedto) {
        bookedForName = bookedForUser.issuedto;
      }

      let utsavName = b.utsavname || (b.UtsavDb && b.UtsavDb.name) || "";
      let packageName = b.package || (b.UtsavPackagesDb && b.UtsavPackagesDb.name) || "";

      // transaction
      const bookingId = String(b.bookingid || b.bookingId || b.id || "");
      const tx = transactionsMap.get(bookingId) || { amount: null, discount: null, razorpay_order_id: null };
      const paymentId = tx.razorpay_order_id || bookingId;

      let template = "";
      let bodyParams = [];
      let headerParam = "";

      const isWaiting = status === "waiting" || status.includes("wait");
      const isPending = status === "pending" || status.includes("pend") || status.includes("pay");
      const isConfirmed = status === "confirmed" || status.includes("confirm") || status.includes("complete");

      const isGuestBy = bookedForUser && bookedForUser.cardno !== user.cardno;
      const isGuestFor = b.bookedBy && b.bookedBy !== user.cardno;

      if (isGuestBy) {
        const attendeeName = bookedForUser.issuedto || "";
        const bookerName = user.issuedto || "";
        headerParam = attendeeName;

        if (isWaiting) {
          template = "bn_usv_gu_b_waiting";
          bodyParams = [bookerName, utsavName, "waiting", packageName];
        } else if (isPending) {
          template = isNRI ? "bn_usv_gu_b_pymtpndg_nri" : "bn_usv_gu_b_pymtpndg";
          bodyParams = [bookerName, utsavName, "payment pending", packageName];
        } else {
          template = "bn_usv_gu_b_cf";
          bodyParams = [bookerName, utsavName, packageName, paymentId];
        }
      } else if (isGuestFor) {
        const bookerName = await getCardName(b.bookedBy);
        const attendeeName = user.issuedto || "";
        headerParam = bookerName;

        if (isWaiting) {
          template = "bn_usv_gu_f_w";
          bodyParams = [attendeeName, utsavName, "waiting", packageName];
        } else if (isPending) {
          template = "bn_usv_gu_f_ppg";
          bodyParams = [attendeeName, utsavName, "payment pending", packageName];
        } else {
          template = "bn_usv_gu_f_cf";
          bodyParams = [attendeeName, utsavName, packageName];
        }
      } else {
        const selfName = user.issuedto || "";
        if (isWaiting) {
          template = "bn_usv_s_b_wg";
          bodyParams = [selfName, utsavName, "waiting", packageName];
        } else if (isPending) {
          template = isNRI ? "bn_usv_s_b_pymtpndg_nri" : "bn_usv_s_b_pymtpndg";
          bodyParams = [selfName, utsavName, "payment pending", packageName];
        } else {
          template = "bn_usv_s_b_cf";
          bodyParams = [selfName, utsavName, packageName, paymentId];
        }
      }

      const sanitizedParams = bodyParams.map(p => sanitizeParamText(p));
      const bodyComp = buildBodyComponents(sanitizedParams)[0];
      let components = [];

      if (headerParam) {
        const sanitizedHeader = sanitizeParamText(headerParam);
        const headerParameters = [{ type: "text", text: sanitizedHeader === "" ? " " : sanitizedHeader }];
        components = [
          { type: "header", parameters: headerParameters },
          bodyComp
        ];
      } else {
        components = [bodyComp];
      }

      const result = await (sendWithTemplateFallback ? sendWithTemplateFallback(phone, template, components) : sendWhatsAppMessage(phone, template, components));

      if (!result || !result.ok) {
        console.error("Utsav WA failed for booking", bookingId, result && result.error ? result.error : "unknown");
      } else {
        console.log("📩 Utsav WhatsApp sent:", {
          toCard: user.cardno,
          bookedFor: bookedForName,
          booking: bookingId,
          template: result.usedTemplate || template,
          transaction: tx
        });
      }
    } catch (err) {
      console.error("Error sending utsav WhatsApp for", b.id || b.bookingid || b, err && (err.stack || err.message || err));
    }
  }
}

// FLAT / FOOD or other
export async function sendFlatWhatsApp(user, flatBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping flat WA.`);
    return;
  }

  const isNRI = user && user.country && String(user.country).trim().toLowerCase() !== 'india';

  if (!Array.isArray(flatBookingDetails)) flatBookingDetails = [];

  // Fetch transactions in batch
  const bookingIds = flatBookingDetails
    .map((b) => (b.bookingid || b.bookingId || b.id ? String(b.bookingid || b.bookingId || b.id) : null))
    .filter(Boolean);

  let transactionsMap = new Map();
  try {
    if (bookingIds.length && typeof Transactions !== "undefined") {
      const txRows = await Transactions.findAll({
        where: { bookingid: { [Op.in]: bookingIds } },
        attributes: ["bookingid", "amount", "discount", "razorpay_order_id"]
      });

      for (const tx of txRows) {
        transactionsMap.set(String(tx.bookingid), {
          amount: tx.amount,
          discount: tx.discount,
          razorpay_order_id: tx.razorpay_order_id
        });
      }
    }
  } catch (err) {
    console.warn("Failed to fetch transactions for flat bookings (non-fatal):", err && (err.message || err));
  }

  const cardCache = new Map();
  if (user && user.cardno) cardCache.set(String(user.cardno), user.issuedto || "");
  if (bookedForUser && bookedForUser.cardno) cardCache.set(String(bookedForUser.cardno), bookedForUser.issuedto || "");

  async function getCardName(cardno) {
    if (!cardno) return "";
    const cno = String(cardno);
    if (cardCache.has(cno)) return cardCache.get(cno);
    try {
      const card = await CardDb.findOne({ where: { cardno: cno } });
      const name = card && card.issuedto ? card.issuedto : "";
      cardCache.set(cno, name);
      return name;
    } catch (err) {
      console.warn(`Failed to lookup card name for cardno=${cno}:`, err.message || err);
      return "";
    }
  }

  for (const b of flatBookingDetails) {
    try {
      if (!b || typeof b !== "object") continue;

      const bookingId = String(b.bookingid || b.bookingId || b.id || "");
      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const bookingStatus = rawStatus.trim().toLowerCase();
      const isPaymentPending = bookingStatus === "payment pending" || bookingStatus === "pending" || (bookingStatus.includes("payment") && !bookingStatus.includes("checkin"));

      const isGuestBy = bookedForUser && bookedForUser.cardno !== user.cardno;
      const isGuestFor = b.bookedBy && b.bookedBy !== user.cardno;

      let template = "";
      let bodyParams = [];
      let headerParam = "";

      const checkinDate = b.checkin || b.start_date || "";
      const checkoutDate = b.checkout || b.end_date || "";
      const checkinFormatted = checkinDate
        ? (moment(checkinDate, "Do MMMM, YYYY", true).isValid()
          ? moment(checkinDate, "Do MMMM, YYYY").format("DD-MM-YYYY")
          : (moment(checkinDate, "DD-MM-YYYY", true).isValid()
            ? moment(checkinDate, "DD-MM-YYYY").format("DD-MM-YYYY")
            : moment(checkinDate).format("DD-MM-YYYY")))
        : "";
      const checkoutFormatted = checkoutDate
        ? (moment(checkoutDate, "Do MMMM, YYYY", true).isValid()
          ? moment(checkoutDate, "Do MMMM, YYYY").format("DD-MM-YYYY")
          : (moment(checkoutDate, "DD-MM-YYYY", true).isValid()
            ? moment(checkoutDate, "DD-MM-YYYY").format("DD-MM-YYYY")
            : moment(checkoutDate).format("DD-MM-YYYY")))
        : "";
      const flatNoStr = String(b.flatno || b.flat_no || b.flatno || "");

      if (isGuestBy) {
        const attendeeName = bookedForUser.issuedto || "";
        const bookerName = user.issuedto || "";
        headerParam = attendeeName;

        if (isPaymentPending) {
          template = isNRI ? "bn_flt_gu_b_ppng_nri" : "bn_flt_gu_b_ppng";
          bodyParams = [bookerName, checkinFormatted, checkoutFormatted, flatNoStr, "payment pending"];
        } else {
          template = "bn_flt_gu_b_cnfm";
          const tx = transactionsMap.get(bookingId) || { razorpay_order_id: null, id: null };
          const paymentId = tx.razorpay_order_id || tx.id || "N/A";
          bodyParams = [bookerName, checkinFormatted, checkoutFormatted, flatNoStr, paymentId];
        }
      } else if (isGuestFor) {
        const bookerName = await getCardName(b.bookedBy);
        const attendeeName = user.issuedto || "";
        headerParam = bookerName;

        if (isPaymentPending) {
          template = "bn_flt_gu_f_pp";
          bodyParams = [attendeeName, checkinFormatted, checkoutFormatted, flatNoStr, "payment pending"];
        } else {
          template = "bn_flt_gu_f_cnfm";
          bodyParams = [attendeeName, checkinFormatted, checkoutFormatted, flatNoStr];
        }
      } else {
        const bookerName = user.issuedto || "";
        if (isPaymentPending) {
          template = isNRI ? "bn_flt_gu_b_ppng_nri" : "bn_flt_gu_b_ppng";
          bodyParams = [bookerName, checkinFormatted, checkoutFormatted, flatNoStr, "payment pending"];
        } else {
          template = "bn_flt_gu_b_cnfm";
          const tx = transactionsMap.get(bookingId) || { razorpay_order_id: null, id: null };
          const paymentId = tx.razorpay_order_id || tx.id || "N/A";
          bodyParams = [bookerName, checkinFormatted, checkoutFormatted, flatNoStr, paymentId];
        }
      }

      const sanitizedParams = bodyParams.map(p => sanitizeParamText(p));
      const bodyComp = buildBodyComponents(sanitizedParams)[0];
      let components = [];

      if (headerParam) {
        const sanitizedHeader = sanitizeParamText(headerParam);
        const headerParameters = [{ type: "text", text: sanitizedHeader === "" ? " " : sanitizedHeader }];
        components = [
          { type: "header", parameters: headerParameters },
          bodyComp
        ];
      } else {
        components = [bodyComp];
      }

      console.log(`WA FLAT: to=${user.cardno} phone=${phone} bookingId=${bookingId} isPaymentPending=${isPaymentPending} -> template='${template}'`);
      const result = await sendWithTemplateFallback(phone, template, components);

      if (!result || !result.ok) {
        console.error("Flat WA failed for booking", bookingId, result && result.error ? result.error : "unknown");
      } else {
        console.log("📩 Flat WhatsApp sent:", {
          toCard: user.cardno,
          booking: bookingId,
          template: result.usedTemplate || template
        });
      }
    } catch (err) {
      console.error("Error sending flat WhatsApp for", b.id || b.bookingid || b, err && (err.stack || err.message || err));
    }
  }
}

// Utility helper (kept for compatibility if used elsewhere)
function phoneOrWarn(mobno) {
  if (!mobno) {
    throw new Error("No mobile number to send WhatsApp");
  }
  return String(mobno);
}

// Ensure the components.body.parameters length matches template expectation.
// expectedCount = number of placeholders your WA template expects.
// If fewer params provided, pad with empty text params.
// Ensure the components.body.parameters length matches template expectation.
// expectedCount = number of placeholders your WA template expects.
// If fewer params provided, pad with single-space text params (Meta rejects empty strings).
function buildBodyComponents(paramsArray = [], expectedCount = null) {
  // convert null/undefined -> "" then to string
  const filtered = (paramsArray || []).map(p => (p === null || p === undefined ? "" : String(p)));

  // replace empty strings with single space to avoid "missing text value" errors
  const normalized = filtered.map(p => (p === "" ? " " : p));

  // pad with single-space entries until reaching expected count (if asked)
  if (expectedCount && normalized.length < expectedCount) {
    while (normalized.length < expectedCount) normalized.push(" ");
  }

  const bodyParameters = normalized.map(p => ({ type: "text", text: p }));
  return [{ type: "body", parameters: bodyParameters }];
}

function deduceDeviceType(username, deviceType = null) {
  if (deviceType) {
    const dt = String(deviceType).toLowerCase().trim();
    if (dt === 'mobile' || dt === 'ph') return 'Mobile';
    if (dt === 'laptop' || dt === 'pc') return 'Laptop';
    if (dt === 'tablet' || dt === 'tb') return 'Tablet';
    if (dt === 'other' || dt === 'ot') return 'Other';
    return deviceType.charAt(0).toUpperCase() + deviceType.slice(1);
  }

  if (!username) return 'Other';
  const cleanUsername = String(username).toLowerCase().replace(/\d+$/, '');
  if (cleanUsername.endsWith('ph')) return 'Mobile';
  if (cleanUsername.endsWith('pc')) return 'Laptop';
  if (cleanUsername.endsWith('tb')) return 'Tablet';
  return 'Other';
}

export async function sendWifiRequestWhatsApp(cardno, username, status, code = null, explicitDeviceType = null) {
  try {
    if (!cardno) {
      console.warn("sendWifiRequestWhatsApp called without cardno");
      return;
    }

    const user = await CardDb.findOne({ where: { cardno } });
    if (!user) {
      console.warn(`No Card record found for cardno=${cardno}; skipping Wifi request WhatsApp.`);
      return;
    }

    const phone = user.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
    if (!phone) {
      console.warn(`⚠️ No WhatsApp number found for ${user.issuedto} (cardno=${cardno}); skipping Wifi request WhatsApp.`);
      return;
    }

    const deviceType = deduceDeviceType(username, explicitDeviceType);

    const templateMap = {
      deleted: 'per_wf_code_req_del',
      rejected: 'per_wf_code_req_rej',
      reset: 'per_wf_code_req_res',
      pending: 'per_wf_code_req_pend',
      approved: 'per_wf_code_req_cnf_ad_m'
    };

    const templateName = templateMap[status];
    if (!templateName) {
      console.warn(`No WhatsApp template mapped for status='${status}'; skipping.`);
      return;
    }

    const components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: sanitizeParamText(user.issuedto) },
          { type: "text", text: sanitizeParamText(deviceType) }
        ]
      }
    ];



    const sendResult = await sendWhatsAppMessage(phone, templateName, components);
    if (!sendResult.ok) {
      console.error(`Wifi request WA failed for template ${templateName}`, sendResult.error);
    } else {
      console.log(`📩 Wifi request WhatsApp sent:`, {
        toCard: cardno,
        username,
        status,
        template: templateName
      });
    }
  } catch (err) {
    console.error("Error sending Wifi request WhatsApp:", err && (err.stack || err.message || err));
  }
}

export async function sendWifiLowAlertWhatsApp(activeCount) {
  try {
    const phone = "919819988657";
    const templateName = "temp_wifi_code_alert";

    const components = [
      {
        type: "body",
        parameters: [
          { type: "text", text: String(activeCount) }
        ]
      }
    ];

    const sendResult = await sendWhatsAppMessage(phone, templateName, components);
    if (!sendResult.ok) {
      console.error(`Wifi low alert WA failed for template ${templateName}`, sendResult.error);
    } else {
      console.log(`📩 Wifi low alert WhatsApp sent to admin:`, {
        phone,
        activeCount,
        template: templateName
      });
    }
  } catch (err) {
    console.error("Error sending Wifi low alert WhatsApp:", err && (err.stack || err.message || err));
  }
}

export async function sendAdhyayanStatusChangeWhatsApp(booking, adhyayan, previousStatus) {
  try {
    if (!booking) return;

    const rawStatus = (booking.status === undefined || booking.status === null || String(booking.status).trim() === "") ? "pending" : String(booking.status);
    const newStatus = rawStatus.trim().toLowerCase();
    const prevStatusNormalized = previousStatus ? String(previousStatus).trim().toLowerCase() : "";
    const updatedBy = booking.updatedBy ? String(booking.updatedBy).trim().toLowerCase() : "";

    // Load adhyayan if not provided
    if (!adhyayan) {
      adhyayan = await ShibirDb.findOne({ where: { id: booking.shibir_id } });
    }

    if (adhyayan && adhyayan.whatsapp_group_jid) {
      try {
        const attendeeCard = await CardDb.findOne({ where: { cardno: booking.cardno } });
        const attendeePhone = attendeeCard?.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
        if (attendeePhone) {
          const isConfirmedStatus = (status) => ["confirmed", "completed", "cash completed"].includes(status);
          const isCancelledStatus = (status) => ["cancelled", "admin cancelled"].includes(status);
          
          if (isConfirmedStatus(newStatus)) {
            await WaGroupJob.create({
              action: 'add_member',
              phone: attendeePhone,
              groupJid: adhyayan.whatsapp_group_jid,
              status: 'pending'
            });
            console.log(`[WA Job Hook] Queued add_member for ${attendeePhone} to group ${adhyayan.whatsapp_group_jid}`);
          } else if (isCancelledStatus(newStatus)) {
            await WaGroupJob.create({
              action: 'remove_member',
              phone: attendeePhone,
              groupJid: adhyayan.whatsapp_group_jid,
              status: 'pending'
            });
            console.log(`[WA Job Hook] Queued remove_member for ${attendeePhone} from group ${adhyayan.whatsapp_group_jid}`);
          }
        }
      } catch (waHookErr) {
        console.error("Failed to queue WhatsApp group job in sendAdhyayanStatusChangeWhatsApp:", waHookErr);
      }
    }

    // This adhyayan templates are only for adhyayans happening in Research Centre
    if (adhyayan && adhyayan.location === RESEARCH_CENTRE) {
      const shibirName = adhyayan.name || "";

      const attendeeCard = await CardDb.findOne({ where: { cardno: booking.cardno } });
      const attendeePhone = attendeeCard?.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
      const attendeeName = attendeeCard?.issuedto || "";

      const hasBooker = booking.bookedBy && booking.bookedBy !== booking.cardno;
      let bookerCard = null;
      let bookerPhone = null;
      let bookerName = "";
      if (hasBooker) {
        bookerCard = await CardDb.findOne({ where: { cardno: booking.bookedBy } });
        bookerPhone = bookerCard?.mobno ? formatWhatsAppPhone(bookerCard.mobno, bookerCard.country) : null;
        bookerName = bookerCard?.issuedto || "";
      }

      // Helper to check if a status matches "pending" variations
      const isPendingStatus = (status) => ["pending", "payment pending", "cash pending"].includes(status);

      // Helper to check if a status matches "confirmed" variations
      const isConfirmedStatus = (status) => ["confirmed", "completed", "cash completed"].includes(status);

      // --- 1. DISPATCH ATTENDEE NOTIFICATION ---
      if (attendeePhone) {
        let templateName = null;
        let parameters = [];

        // --- TRANSITION LOGIC FOR ATTENDEE (SELF/GUEST REGARDLESS OF BOOKER) ---
        if (prevStatusNormalized === "waiting") {
          if (newStatus === "cancelled") {
            templateName = "bk_adh_s_b_w2cn";
            parameters = [attendeeName, shibirName, "cancelled"];
          } else if (newStatus === "admin cancelled") {
            templateName = "bk_adh_s_b_w2acn";
            parameters = [attendeeName, shibirName, "admin cancelled"];
          } else if (isPendingStatus(newStatus)) {
            if (!hasBooker) {
              templateName = "bk_adh_s_b_w2ppg";
              parameters = [attendeeName, shibirName, "payment pending"];
            }
          } else if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_s_b_wtg2conf";
            parameters = [attendeeName, shibirName];
          }
        } else if (isPendingStatus(prevStatusNormalized)) {
          if (newStatus === "cancelled") {
            templateName = "bk_adh_s_b_ppg2cn";
            parameters = [attendeeName, shibirName, "cancelled"];
          } else if (newStatus === "admin cancelled") {
            if (updatedBy === "admin") {
              templateName = "bk_adh_s_b_ppg2acn_c";
            } else {
              templateName = "bk_adh_s_b_ppg2acn_a";
            }
            parameters = [attendeeName, shibirName, "admin cancelled"];
          } else if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_s_b_ppg2cnf";
            const transaction = await Transactions.findOne({
              where: { bookingid: booking.bookingid }
            });
            const paymentId = transaction?.razorpay_order_id || transaction?.id || "N/A";
            parameters = [attendeeName, shibirName, paymentId];
          }
        } else if (isConfirmedStatus(prevStatusNormalized)) {
          if (newStatus === "cancelled") {
            templateName = "bk_adh_s_b_cf2cn";
            parameters = [attendeeName, shibirName, "cancelled"];
          } else if (newStatus === "admin cancelled") {
            templateName = "bk_adh_s_b_cf2acn";
            parameters = [attendeeName, shibirName, "admin cancelled"];
          }
        } else if (prevStatusNormalized === "cancelled") {
          if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_s_b_canc2conf";
            const transaction = await Transactions.findOne({
              where: { bookingid: booking.bookingid }
            });
            const paymentId = transaction?.razorpay_order_id || transaction?.id || "N/A";
            parameters = [attendeeName, shibirName, paymentId];
          }
        } else if (prevStatusNormalized === "admin cancelled") {
          if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_s_b_adcanc2conf";
            const transaction = await Transactions.findOne({
              where: { bookingid: booking.bookingid }
            });
            const paymentId = transaction?.razorpay_order_id || transaction?.id || "N/A";
            parameters = [attendeeName, shibirName, paymentId];
          }
        }

        if (templateName) {
          const sanitizedParams = parameters.map(p => sanitizeParamText(p));
          const components = buildBodyComponents(sanitizedParams);
          console.log(`WA SENDING ATTENDEE: template=${templateName} to phone=${attendeePhone} (Attendee cardno=${booking.cardno})`);
          const result = await sendWithTemplateFallback(attendeePhone, templateName, components);
          if (!result || !result.ok) {
            console.error(`Error sending WhatsApp notification to attendee for template ${templateName}`, result?.error);
          } else {
            console.log(`📩 WhatsApp attendee notification sent successfully: template=${templateName} to ${attendeePhone}`);
          }
        } else {
          console.log(`WA SKIP ATTENDEE: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}' (updatedBy=${updatedBy})`);
        }
      }

      // --- 2. DISPATCH BOOKER NOTIFICATION ---
      if (hasBooker && bookerPhone) {
        let templateName = null;
        let parameters = [];

        // --- TRANSITION LOGIC FOR BOOKER (GUEST) ---
        if (prevStatusNormalized === "waiting") {
          if (newStatus === "cancelled") {
            templateName = "bk_adh_gu_b_wg2cn";
            parameters = [bookerName, shibirName, "cancelled", attendeeName];
          } else if (newStatus === "admin cancelled") {
            templateName = "bk_adh_gu_b_wg2acn";
            parameters = [bookerName, shibirName, "admin cancelled", attendeeName];
          } else if (isPendingStatus(newStatus)) {
            templateName = "bk_adh_gu_b_wg2ppg";
            parameters = [bookerName, shibirName, "payment pending", attendeeName];
          } else if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_gu_b_wtg2conf";
            parameters = [bookerName, shibirName, attendeeName];
          }
        } else if (isPendingStatus(prevStatusNormalized)) {
          if (newStatus === "cancelled") {
            templateName = "bk_adh_gu_b_ppg2cn";
            parameters = [bookerName, shibirName, "cancelled", attendeeName];
          } else if (newStatus === "admin cancelled") {
            if (updatedBy === "admin") {
              templateName = "bk_adh_gu_b_ppg2acn_c";
            } else {
              templateName = "bk_adh_gu_b_ppg2acn_a";
            }
            parameters = [bookerName, shibirName, "admin cancelled", attendeeName];
          } else if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_gu_b_ppg2cf";
            const transaction = await Transactions.findOne({
              where: { bookingid: booking.bookingid }
            });
            const paymentId = transaction?.razorpay_order_id || transaction?.id || "N/A";
            parameters = [bookerName, shibirName, paymentId, attendeeName];
          }
        } else if (isConfirmedStatus(prevStatusNormalized)) {
          if (newStatus === "cancelled") {
            templateName = "bk_adh_gu_b_cnfm2canc";
            parameters = [bookerName, shibirName, "cancelled", attendeeName];
          } else if (newStatus === "admin cancelled") {
            templateName = "bk_adh_gu_b_cf2acn";
            parameters = [bookerName, shibirName, "admin cancelled", attendeeName];
          }
        } else if (prevStatusNormalized === "cancelled") {
          if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_gu_b_canc2conf";
            parameters = [bookerName, shibirName, attendeeName];
          }
        } else if (prevStatusNormalized === "admin cancelled") {
          if (isConfirmedStatus(newStatus)) {
            templateName = "bk_adh_gu_b_adcanc2conf";
            parameters = [bookerName, shibirName, attendeeName];
          }
        }

        if (templateName) {
          const sanitizedParams = parameters.map(p => sanitizeParamText(p));
          const components = buildBodyComponents(sanitizedParams);
          console.log(`WA SENDING BOOKER: template=${templateName} to phone=${bookerPhone} (Booker cardno=${booking.bookedBy})`);
          const result = await sendWithTemplateFallback(bookerPhone, templateName, components);
          if (!result || !result.ok) {
            console.error(`Error sending WhatsApp notification to booker for template ${templateName}`, result?.error);
          } else {
            console.log(`📩 WhatsApp booker notification sent successfully: template=${templateName} to ${bookerPhone}`);
          }
        } else {
          console.log(`WA SKIP BOOKER: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}' (updatedBy=${updatedBy})`);
        }
      }
    } else {
      console.log(`WA SKIP: Adhyayan shibir_id=${booking.shibir_id} location is '${adhyayan?.location || ""}', not '${RESEARCH_CENTRE}'`);
    }
  } catch (err) {
    console.error("Error in sendAdhyayanStatusChangeWhatsApp:", err && (err.stack || err.message || err));
  }
}

export async function sendRoomStatusChangeWhatsApp(booking, previousStatus, options = {}) {
  try {
    if (!booking) return;

    const rawStatus = (booking.status === undefined || booking.status === null || String(booking.status).trim() === "") ? "pending" : String(booking.status);
    const newStatus = rawStatus.trim().toLowerCase();
    const prevStatusNormalized = previousStatus ? String(previousStatus).trim().toLowerCase() : "";
    const updatedBy = (options.updatedBy || booking.updatedBy || "").trim().toLowerCase();

    // Load attendee details
    const attendeeCard = await CardDb.findOne({ where: { cardno: booking.cardno } });
    const attendeePhone = attendeeCard?.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
    const attendeeName = attendeeCard?.issuedto || "";

    // Check if Guest booking
    const hasBooker = booking.bookedBy && booking.bookedBy !== booking.cardno;
    let bookerCard = null;
    let bookerPhone = null;
    let bookerName = "";
    if (hasBooker) {
      bookerCard = await CardDb.findOne({ where: { cardno: booking.bookedBy } });
      bookerPhone = bookerCard?.mobno ? formatWhatsAppPhone(bookerCard.mobno, bookerCard.country) : null;
      bookerName = bookerCard?.issuedto || "";
    }

    const isPendingStatus = (status) => ["pending", "payment pending", "cash pending"].includes(status);
    const isConfirmedStatus = (status) => ["confirmed", "pending checkin", "completed", "cash completed", "payment completed"].includes(status);

    const checkinFormatted = booking.checkin ? moment(booking.checkin).format("DD-MM-YYYY") : "";
    const checkoutFormatted = booking.checkout ? moment(booking.checkout).format("DD-MM-YYYY") : "";
    const roomTypeStr = (booking.roomtype || "").toLowerCase().includes("nac") ? "non-ac" : "ac";

    let creditsRefunded = options.credits || 0;
    if ((newStatus === "cancelled" || newStatus === "admin cancelled") && !creditsRefunded) {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      if (transaction) {
        if (transaction.status === "credited") {
          creditsRefunded = transaction.amount;
        } else {
          const totalAmount = (transaction.amount || 0) + (transaction.discount || 0);
          creditsRefunded = ["completed", "cash completed", "payment completed"].includes(transaction.status) ? totalAmount : (transaction.discount || 0);
        }
      }
    }
    const creditsStr = String(creditsRefunded);

    // --- 1. DISPATCH ATTENDEE (SELF) NOTIFICATION ---
    if (attendeePhone) {
      let templateName = null;
      let parameters = [];

      if (prevStatusNormalized === "waiting") {
        if (newStatus === "cancelled") {
          templateName = "bk_sha_s_b_w2cn";
          parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled"];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_sha_s_b_w2acn";
          parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled"];
        } else if (isPendingStatus(newStatus)) {
          if (!hasBooker) {
            templateName = "bk_sha_s_b_w2ppg";
            parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "payment pending"];
          }
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_sha_s_b_ppg2pgci";
          parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "pending checkin"];
        }
      } else if (isPendingStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_sha_s_b_ppg2can";
          parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled"];
        } else if (newStatus === "admin cancelled") {
          if (updatedBy === "cron" || options.isCron) {
            templateName = "bk_sha_s_b_ppg2acn_c";
          } else {
            templateName = "bk_sha_s_b_ppg2acn_a";
          }
          parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled"];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_sha_s_b_ppg2pgci";
          parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "pending checkin"];
        }
      } else if (prevStatusNormalized === "pending checkin" || prevStatusNormalized === "pending_checkin") {
        if (newStatus === "cancelled") {
          if (hasBooker || attendeeCard?.res_status === "GUEST") {
            templateName = "bk_sha_gu_f_pndgchki2canc_";
            parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled", bookerName || "Admin"];
          } else {
            templateName = "bk_sha_s_b_pgci2cn";
            parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled", creditsStr];
          }
        } else if (newStatus === "admin cancelled") {
          if (hasBooker || attendeeCard?.res_status === "GUEST") {
            templateName = "bk_sha_gu_f_pgci2acn";
            parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled", bookerName || "Admin"];
          } else {
            templateName = "bk_sha_s_b_pgci2acan";
            parameters = [attendeeName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled", creditsStr];
          }
        } else if (newStatus === "checkedin" || newStatus === "checked_in") {
          templateName = "bk_sha_s_b_pci2ci";
          parameters = [attendeeName, booking.roomno || "NA"];
        }
      } else if (prevStatusNormalized === "checkedin" || prevStatusNormalized === "checked_in") {
        if (newStatus === "checkedout" || newStatus === "checked_out") {
          const lateFee = options.lateFee || 0;
          if (lateFee > 0) {
            templateName = "bk_sha_s_b_ci2co_lcf";
            const checkoutTimeStr = options.checkoutTime || moment().tz('Asia/Kolkata').format("hh:mm a");
            parameters = [attendeeName, checkoutTimeStr, String(lateFee)];
          } else {
            templateName = "bk_sha_s_b_ci2co";
            const checkoutTimeStr = options.checkoutTime || moment().tz('Asia/Kolkata').format("hh:mm a");
            parameters = [attendeeName, checkoutTimeStr];
          }
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA ROOM STATUS ATTENDEE: template=${templateName} to phone=${attendeePhone} (Attendee cardno=${booking.cardno})`);
        const result = await sendWithTemplateFallback(attendeePhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending room WhatsApp notification to attendee for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Room WhatsApp attendee notification sent successfully: template=${templateName} to ${attendeePhone}`);
        }
      } else {
        console.log(`WA ROOM STATUS SKIP ATTENDEE: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

    // --- 2. DISPATCH BOOKER (GUEST) NOTIFICATION ---
    if (hasBooker && bookerPhone) {
      let templateName = null;
      let parameters = [];

      if (prevStatusNormalized === "waiting") {
        if (newStatus === "cancelled") {
          templateName = "bk_sha_gu_b_wtg2cnfm";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled", attendeeName];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_sha_gu_b_w2acn";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled", attendeeName];
        } else if (isPendingStatus(newStatus)) {
          templateName = "bk_sha_gu_b_w2ppg";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "payment pending", attendeeName];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_sha_gu_b_pypnd2pndchki";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "pending checkin", attendeeName];
        }
      } else if (isPendingStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_sha_gu_b_ppg2cn";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled", attendeeName];
        } else if (newStatus === "admin cancelled") {
          if (updatedBy === "cron" || options.isCron) {
            templateName = "bk_sha_gu_b_ppg2acn_c";
          } else {
            templateName = "bk_sha_gu_b_ppg2acn_a";
          }
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled", attendeeName];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_sha_gu_b_pypnd2pndchki";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "pending checkin", attendeeName];
        }
      } else if (prevStatusNormalized === "pending checkin" || prevStatusNormalized === "pending_checkin") {
        if (newStatus === "cancelled") {
          templateName = "bk_sha_gu_b_pndgchki2canc";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "cancelled", creditsStr, attendeeName];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_sha_gu_b_pgci2acn";
          parameters = [bookerName, roomTypeStr, checkinFormatted, checkoutFormatted, "admin cancelled", creditsStr, attendeeName];
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA ROOM STATUS BOOKER: template=${templateName} to phone=${bookerPhone} (Booker cardno=${booking.bookedBy})`);
        const result = await sendWithTemplateFallback(bookerPhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending room WhatsApp notification to booker for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Room WhatsApp booker notification sent successfully: template=${templateName} to ${bookerPhone}`);
        }
      } else {
        console.log(`WA ROOM STATUS SKIP BOOKER: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }
  } catch (err) {
    console.error("Error in sendRoomStatusChangeWhatsApp:", err && (err.stack || err.message || err));
  }
}

export async function sendFlatStatusChangeWhatsApp(booking, previousStatus, options = {}) {
  try {
    if (!booking) return;

    const rawStatus = (booking.status === undefined || booking.status === null || String(booking.status).trim() === "") ? "pending" : String(booking.status);
    const newStatus = rawStatus.trim().toLowerCase();
    const prevStatusNormalized = previousStatus ? String(previousStatus).trim().toLowerCase() : "";
    const updatedBy = (options.updatedBy || booking.updatedBy || "").trim().toLowerCase();

    // Load attendee details
    const attendeeCard = await CardDb.findOne({ where: { cardno: booking.cardno } });
    const attendeePhone = attendeeCard?.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
    const attendeeName = attendeeCard?.issuedto || "";

    // Load booker details
    const bookerCardno = booking.bookedBy || booking.cardno;
    const bookerCard = await CardDb.findOne({ where: { cardno: bookerCardno } });
    const bookerPhone = bookerCard?.mobno ? formatWhatsAppPhone(bookerCard.mobno, bookerCard.country) : null;
    const bookerName = bookerCard?.issuedto || "";

    const isPendingStatus = (status) => ["pending", "payment pending", "cash pending"].includes(status);
    const isConfirmedStatus = (status) => ["confirmed", "pending checkin", "completed", "cash completed", "payment completed"].includes(status);

    const checkinFormatted = booking.checkin ? moment(booking.checkin).format("DD-MM-YYYY") : "";
    const checkoutFormatted = booking.checkout ? moment(booking.checkout).format("DD-MM-YYYY") : "";
    const flatNoStr = String(booking.flatno || "");

    let creditsRefunded = options.credits || 0;
    if ((newStatus === "cancelled" || newStatus === "admin cancelled") && !creditsRefunded) {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      if (transaction) {
        if (transaction.status === "credited") {
          creditsRefunded = transaction.amount;
        } else {
          const totalAmount = (transaction.amount || 0) + (transaction.discount || 0);
          creditsRefunded = ["completed", "cash completed", "payment completed"].includes(transaction.status) ? totalAmount : (transaction.discount || 0);
        }
      }
    }
    const creditsStr = String(creditsRefunded);

    let paymentId = "N/A";
    if (isConfirmedStatus(newStatus)) {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      if (transaction) {
        paymentId = transaction.razorpay_order_id || transaction.id || "N/A";
      }
    }

    // --- 1. DISPATCH BOOKER (GUEST BY) NOTIFICATION ---
    if (bookerPhone) {
      let templateName = null;
      let parameters = [];

      if (isPendingStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_flt_gu_b_ppg2canc";
          parameters = [bookerName, checkinFormatted, checkoutFormatted, "cancelled", attendeeName, flatNoStr];
        } else if (newStatus === "admin cancelled") {
          if (updatedBy === "cron" || options.isCron) {
            templateName = "bk_flt_gu_b_ppg2acn_cron";
            parameters = [bookerName, checkinFormatted, checkoutFormatted, attendeeName, flatNoStr, "admin cancelled"];
          } else {
            templateName = "bk_flt_gu_b_ppg2acn";
            parameters = [bookerName, checkinFormatted, checkoutFormatted, "admin cancelled", attendeeName, flatNoStr];
          }
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_flt_gu_b_ppg2conf";
          parameters = [bookerName, checkinFormatted, checkoutFormatted, "confirmed", attendeeName, flatNoStr, paymentId];
        }
      } else if (isConfirmedStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_flt_gu_b_conf2canc_wcre";
          parameters = [bookerName, checkinFormatted, checkoutFormatted, "cancelled", attendeeName, flatNoStr, creditsStr];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_flt_gu_b_conf2adcanc_wcre";
          parameters = [bookerName, checkinFormatted, checkoutFormatted, "admin cancelled", attendeeName, flatNoStr, creditsStr];
        } else if (newStatus === "checkedin" || newStatus === "checked_in") {
          templateName = "bk_flt_gu_b_conf2chki";
          parameters = [bookerName, checkinFormatted, checkoutFormatted, "checked in", attendeeName, flatNoStr];
        }
      } else if (prevStatusNormalized === "checkedin" || prevStatusNormalized === "checked_in") {
        if (newStatus === "checkedout" || newStatus === "checked_out") {
          templateName = "bk_flt_gu_b_chki2chko";
          parameters = [bookerName, checkinFormatted, checkoutFormatted, "checked out", attendeeName, flatNoStr];
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA FLAT STATUS BOOKER: template=${templateName} to phone=${bookerPhone} (Booker cardno=${bookerCardno})`);
        const result = await sendWithTemplateFallback(bookerPhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending flat WhatsApp notification to booker for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Flat WhatsApp booker notification sent successfully: template=${templateName} to ${bookerPhone}`);
        }
      } else {
        console.log(`WA FLAT STATUS SKIP BOOKER: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

    // --- 2. DISPATCH ATTENDEE (GUEST FOR) NOTIFICATION ---
    if (attendeePhone) {
      let templateName = null;
      let parameters = [];

      if (isPendingStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_flt_gu_f_ppg2canc";
          parameters = [attendeeName, checkinFormatted, checkoutFormatted, "cancelled", bookerName, flatNoStr];
        } else if (newStatus === "admin cancelled") {
          if (updatedBy === "cron" || options.isCron) {
            templateName = "bk_flt_gu_f_ppg2acn_cron";
            parameters = [attendeeName, checkinFormatted, checkoutFormatted, bookerName, flatNoStr, "admin cancelled"];
          } else {
            templateName = "bk_flt_gu_f_ppg2acn";
            parameters = [attendeeName, checkinFormatted, checkoutFormatted, "admin cancelled", bookerName, flatNoStr];
          }
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_flt_gu_f_ppg2conf";
          parameters = [attendeeName, checkinFormatted, checkoutFormatted, "confirmed", bookerName, flatNoStr];
        }
      } else if (isConfirmedStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_flt_gu_f_conf2canc";
          parameters = [attendeeName, checkinFormatted, checkoutFormatted, "cancelled", bookerName, flatNoStr];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_flt_gu_f_conf2adcanc";
          parameters = [attendeeName, checkinFormatted, checkoutFormatted, "admin cancelled", bookerName, flatNoStr];
        } else if (newStatus === "checkedin" || newStatus === "checked_in") {
          templateName = "bk_flt_gu_f_conf2chki";
          parameters = [attendeeName, checkinFormatted, checkoutFormatted, "checked in", bookerName, flatNoStr];
        }
      } else if (prevStatusNormalized === "checkedin" || prevStatusNormalized === "checked_in") {
        if (newStatus === "checkedout" || newStatus === "checked_out") {
          templateName = "bk_flt_gu_f_chki2chko";
          parameters = [attendeeName, checkinFormatted, checkoutFormatted, "checked out", bookerName, flatNoStr];
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA FLAT STATUS ATTENDEE: template=${templateName} to phone=${attendeePhone} (Attendee cardno=${booking.cardno})`);
        const result = await sendWithTemplateFallback(attendeePhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending flat WhatsApp notification to attendee for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Flat WhatsApp attendee notification sent successfully: template=${templateName} to ${attendeePhone}`);
        }
      } else {
        console.log(`WA FLAT STATUS SKIP ATTENDEE: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

  } catch (err) {
    console.error("Error in sendFlatStatusChangeWhatsApp:", err && (err.stack || err.message || err));
  }
}


export async function sendTravelStatusChangeWhatsApp(booking, previousStatus, options = {}) {
  try {
    if (!booking) return;

    const rawStatus = (booking.status === undefined || booking.status === null || String(booking.status).trim() === "") ? "pending" : String(booking.status);
    const newStatus = rawStatus.trim().toLowerCase();
    const prevStatusNormalized = previousStatus ? String(previousStatus).trim().toLowerCase() : "";

    // Load Attendee details
    const attendeeCard = await CardDb.findOne({ where: { cardno: booking.cardno } });
    const attendeePhone = attendeeCard?.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
    const attendeeName = attendeeCard?.issuedto || "";

    // Check if Guest booking
    const hasBooker = booking.bookedBy && booking.bookedBy !== booking.cardno;
    let bookerCard = null;
    let bookerPhone = null;
    let bookerName = "";
    if (hasBooker) {
      bookerCard = await CardDb.findOne({ where: { cardno: booking.bookedBy } });
      bookerPhone = bookerCard?.mobno ? formatWhatsAppPhone(bookerCard.mobno, bookerCard.country) : null;
      bookerName = bookerCard?.issuedto || "";
    }

    let dateFormatted = "";
    if (booking.date) {
      const dateStr = String(booking.date);
      if (booking.date instanceof Date || dateStr.includes("GMT") || dateStr.includes(":") || dateStr.length > 20) {
        dateFormatted = moment(booking.date).format("DD-MM-YYYY");
      } else if (dateStr.includes("th") || dateStr.includes("st") || dateStr.includes("nd") || dateStr.includes("rd")) {
        dateFormatted = moment(booking.date, "Do MMMM, YYYY").format("DD-MM-YYYY");
      } else {
        dateFormatted = moment(booking.date).format("DD-MM-YYYY");
      }
    }

    const pickup = booking.pickuppoint || booking.pickup_point || "";
    const drop = booking.dropoffpoint || booking.drop_point || "";

    let creditsRefunded = options.credits || 0;
    if ((newStatus === "cancelled" || newStatus === "admin cancelled") && !creditsRefunded) {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      if (transaction) {
        if (transaction.status === "credited") {
          creditsRefunded = transaction.amount || 0;
        }
      }
    }
    const creditsStr = String(creditsRefunded);

    // Resolve payment ID for confirmations
    let paymentId = options.razorpay_payment_id || options.paymentId || "";
    if (!paymentId && newStatus === "confirmed") {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      paymentId = transaction?.razorpay_order_id || transaction?.upi_ref || booking.bookingid || booking.id || "";
    }

    // --- 1. DISPATCH ATTENDEE (SELF/TRAVELER) NOTIFICATION ---
    if (attendeePhone) {
      let templateName = null;
      let parameters = [];

      if (prevStatusNormalized === "awaiting confirmation") {
        if ((newStatus === "proceed for payment" || newStatus === "payment pending" || newStatus === "pending") && !hasBooker) {
          const isAttendeeNRI = attendeeCard && attendeeCard.country && String(attendeeCard.country).trim().toLowerCase() !== 'india';
          templateName = isAttendeeNRI ? "bk_pvs_s_b_awc2ppg_nri" : "bk_pvs_s_b_awc2ppg";
          parameters = [attendeeName, pickup, drop, "proceed for payment", dateFormatted];
        } else if (newStatus === "admin cancelled") {
          if (booking.admin_comments === "admin_cancel_wrong_form" || newStatus === "wrong form cancel") {
            templateName = "bk_pvs_s_b_awc2acn_wff";
          } else if (booking.admin_comments === "admin_cancel_seats_full" || newStatus === "seats full cancel") {
            templateName = "bk_pvs_s_b_awc2acn_asf";
          } else {
            templateName = "bk_pvs_s_b_awc2acn";
          }
          parameters = [attendeeName, pickup, drop, "admin cancelled", dateFormatted];
        } else if (newStatus === "cancelled") {
          templateName = "bk_pvs_s_b_awc2cn";
          parameters = [attendeeName, pickup, drop, "cancelled", dateFormatted];
        } else if (newStatus === "confirmed") {
          templateName = "bk_pvs_s_b_pypdg2conf";
          parameters = [attendeeName, dateFormatted, pickup, drop, paymentId];
        }
      } else if (prevStatusNormalized === "proceed for payment" || prevStatusNormalized === "payment pending" || prevStatusNormalized === "pending") {
        if (newStatus === "cancelled") {
          templateName = "bk_pvs_s_b_ppg2cn";
          parameters = [attendeeName, pickup, drop, "cancelled", dateFormatted];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_pvs_s_b_ppg2acn";
          parameters = [attendeeName, pickup, drop, "admin cancelled", dateFormatted];
        } else if (newStatus === "confirmed") {
          templateName = "bk_pvs_s_b_pypdg2conf";
          parameters = [attendeeName, dateFormatted, pickup, drop, paymentId];
        }
      } else if (prevStatusNormalized === "confirmed") {
        if (newStatus === "cancelled") {
          templateName = "bk_pvs_s_b_cf2cn";
          parameters = [attendeeName, pickup, drop, "cancelled", dateFormatted];
        } else if (newStatus === "admin cancelled") {
          if (hasBooker || !(creditsRefunded > 0)) {
            templateName = "bk_pvs_s_b_cf2acn_woc";
            parameters = [attendeeName, pickup, drop, "admin cancelled", dateFormatted];
          } else {
            templateName = "bk_pvs_s_b_conf2adcanc_wcre";
            parameters = [attendeeName, pickup, drop, "admin cancelled", dateFormatted, creditsStr];
          }
        }
      } else if (prevStatusNormalized === "cancelled") {
        if (newStatus === "admin cancelled" && creditsRefunded > 0) {
          if (!hasBooker) {
            templateName = "bk_pvs_s_b_canc2adcanc_wcre";
            parameters = [attendeeName, pickup, drop, "admin cancelled", dateFormatted, creditsStr];
          }
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA TRAVEL STATUS ATTENDEE: template=${templateName} to phone=${attendeePhone} (Attendee cardno=${booking.cardno})`);
        const result = await sendWithTemplateFallback(attendeePhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending travel WhatsApp notification to attendee for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Travel WhatsApp attendee notification sent successfully: template=${templateName} to ${attendeePhone}`);
        }
      } else {
        console.log(`WA TRAVEL STATUS SKIP ATTENDEE: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

    // --- 2. DISPATCH BOOKER (GUEST) NOTIFICATION ---
    if (hasBooker && bookerPhone) {
      let templateName = null;
      let parameters = [];

      if (prevStatusNormalized === "awaiting confirmation") {
        if (newStatus === "proceed for payment" || newStatus === "payment pending" || newStatus === "pending") {
          const isBookerNRI = bookerCard && bookerCard.country && String(bookerCard.country).trim().toLowerCase() !== 'india';
          templateName = isBookerNRI ? "bk_pvs_mu_b_awc2ppg_nri" : "bk_pvs_mu_b_awc2ppg";
          parameters = [bookerName, pickup, drop, "proceed for payment", dateFormatted, attendeeName];
        } else if (newStatus === "admin cancelled") {
          if (booking.admin_comments === "admin_cancel_wrong_form" || newStatus === "wrong form cancel") {
            templateName = "bk_pvs_mu_b_awc2acn_wff";
          } else if (booking.admin_comments === "admin_cancel_seats_full" || newStatus === "seats full cancel") {
            templateName = "bk_pvs_mu_b_awc2acn_asf";
          } else {
            templateName = "bk_pvs_mu_b_awc2acn";
          }
          parameters = [bookerName, pickup, drop, "admin cancelled", dateFormatted, attendeeName];
        } else if (newStatus === "cancelled") {
          templateName = "bk_pvs_mu_b_awtconf2canc";
          parameters = [bookerName, pickup, drop, "cancelled", dateFormatted, attendeeName];
        } else if (newStatus === "confirmed") {
          templateName = "bk_pvs_mu_b_pympndg2conf";
          parameters = [bookerName, attendeeName, dateFormatted, pickup, drop, paymentId];
        }
      } else if (prevStatusNormalized === "proceed for payment" || prevStatusNormalized === "payment pending" || prevStatusNormalized === "pending") {
        if (newStatus === "cancelled") {
          templateName = "bk_pvs_mu_b_ppg2cn";
          parameters = [bookerName, pickup, drop, "cancelled", dateFormatted, attendeeName];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_pvs_mu_b_ppg2acn";
          parameters = [bookerName, pickup, drop, "admin cancelled", dateFormatted, attendeeName];
        } else if (newStatus === "confirmed") {
          templateName = "bk_pvs_mu_b_pympndg2conf";
          parameters = [bookerName, attendeeName, dateFormatted, pickup, drop, paymentId];
        }
      } else if (prevStatusNormalized === "confirmed") {
        if (newStatus === "cancelled") {
          templateName = "bk_pvs_mu_b_conf2canc";
          parameters = [bookerName, pickup, drop, "cancelled", dateFormatted, attendeeName];
        } else if (newStatus === "admin cancelled") {
          if (creditsRefunded > 0) {
            templateName = "bk_pvs_mu_b_cf2acn_wc";
            parameters = [bookerName, pickup, drop, "admin cancelled", dateFormatted, creditsStr, attendeeName];
          } else {
            templateName = "bk_pvs_mu_b_cf2acn_woc";
            parameters = [bookerName, pickup, drop, "admin cancelled", dateFormatted, attendeeName];
          }
        }
      } else if (prevStatusNormalized === "cancelled") {
        if (newStatus === "admin cancelled" && creditsRefunded > 0) {
          templateName = "bk_pvs_mu_b_canc2adcanc_wcre";
          parameters = [bookerName, pickup, drop, "admin cancelled", dateFormatted, creditsStr, attendeeName];
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA TRAVEL STATUS BOOKER: template=${templateName} to phone=${bookerPhone} (Booker cardno=${booking.bookedBy})`);
        const result = await sendWithTemplateFallback(bookerPhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending travel WhatsApp notification to booker for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Travel WhatsApp booker notification sent successfully: template=${templateName} to ${bookerPhone}`);
        }
      } else {
        console.log(`WA TRAVEL STATUS SKIP BOOKER: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

  } catch (err) {
    console.error("Error in sendTravelStatusChangeWhatsApp:", err && (err.stack || err.message || err));
  }
}

export async function sendUtsavStatusChangeWhatsApp(booking, previousStatus, options = {}) {
  try {
    if (!booking) return;

    const rawStatus = (booking.status === undefined || booking.status === null || String(booking.status).trim() === "") ? "pending" : String(booking.status);
    const newStatus = rawStatus.trim().toLowerCase();
    const prevStatusNormalized = previousStatus ? String(previousStatus).trim().toLowerCase() : "";
    const updatedBy = (options.updatedBy || booking.updatedBy || "").trim().toLowerCase();

    // 1. Load attendee details
    const attendeeCard = await CardDb.findOne({ where: { cardno: booking.cardno } });
    const attendeePhone = attendeeCard?.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
    const attendeeName = attendeeCard?.issuedto || "";

    // 2. Check if Guest booking
    const hasBooker = booking.bookedBy && booking.bookedBy !== booking.cardno;
    let bookerCard = null;
    let bookerPhone = null;
    let bookerName = "";
    if (hasBooker) {
      bookerCard = await CardDb.findOne({ where: { cardno: booking.bookedBy } });
      bookerPhone = bookerCard?.mobno ? formatWhatsAppPhone(bookerCard.mobno, bookerCard.country) : null;
      bookerName = bookerCard?.issuedto || "";
    }

    // 3. Load utsav details
    let utsavName = "";
    let utsav = null;
    if (booking.utsavid) {
      utsav = await UtsavDb.findOne({ where: { id: booking.utsavid } });
      utsavName = utsav?.name || "";
    }

    if (utsav && utsav.whatsapp_group_jid && attendeePhone) {
      try {
        const isConfirmedStatus = (status) => ["confirmed", "completed", "cash completed"].includes(status);
        const isCancelledStatus = (status) => ["cancelled", "admin cancelled"].includes(status);

        if (isConfirmedStatus(newStatus)) {
          await WaGroupJob.create({
            action: 'add_member',
            phone: attendeePhone,
            groupJid: utsav.whatsapp_group_jid,
            status: 'pending'
          });
          console.log(`[WA Job Hook] Queued add_member for ${attendeePhone} to group ${utsav.whatsapp_group_jid}`);
        } else if (isCancelledStatus(newStatus)) {
          await WaGroupJob.create({
            action: 'remove_member',
            phone: attendeePhone,
            groupJid: utsav.whatsapp_group_jid,
            status: 'pending'
          });
          console.log(`[WA Job Hook] Queued remove_member for ${attendeePhone} from group ${utsav.whatsapp_group_jid}`);
        }
      } catch (waHookErr) {
        console.error("Failed to queue WhatsApp group job in sendUtsavStatusChangeWhatsApp:", waHookErr);
      }
    }

    // 4. Load package details
    let packageName = "";
    if (booking.packageid) {
      const pkg = await UtsavPackagesDb.findOne({ where: { id: booking.packageid } });
      packageName = pkg?.name || "";
    }

    // 5. Determine credit refunds
    let creditsRefunded = options.credits || 0;
    if ((newStatus === "cancelled" || newStatus === "admin cancelled") && !creditsRefunded) {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      if (transaction) {
        if (transaction.status === "credited") {
          creditsRefunded = transaction.amount || 0;
        } else if (newStatus === "cancelled") {
          const totalAmount = (transaction.amount || 0) + (transaction.discount || 0);
          creditsRefunded = ["completed", "cash completed", "payment completed"].includes(transaction.status) ? totalAmount : (transaction.discount || 0);
        }
      }
    }
    const creditsStr = String(creditsRefunded);

    // 6. Resolve payment ID for confirmed status
    let paymentId = options.paymentId || "";
    if (!paymentId && newStatus === "confirmed") {
      const transaction = await Transactions.findOne({
        where: { bookingid: booking.bookingid || booking.id }
      }).catch(() => null);
      paymentId = transaction?.razorpay_order_id || transaction?.upi_ref || booking.bookingid || booking.id || "";
    }

    const isPendingStatus = (status) => ["pending", "payment pending", "cash pending"].includes(status);
    const isConfirmedStatus = (status) => ["confirmed", "completed", "cash completed", "payment completed"].includes(status);

    // --- 1. DISPATCH ATTENDEE (SELF) NOTIFICATION ---
    if (attendeePhone) {
      let templateName = null;
      let parameters = [];

      if (prevStatusNormalized === "waiting") {
        if (newStatus === "cancelled") {
          templateName = "bk_usv_s_b_w2cn";
          parameters = [attendeeName, utsavName, packageName, "cancelled"];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_usv_s_b_w2acn";
          parameters = [attendeeName, utsavName, packageName, "admin cancelled"];
        } else if (isPendingStatus(newStatus) && !hasBooker) {
          templateName = "bk_usv_s_b_wtng2pymtpndg";
          parameters = [attendeeName, utsavName, packageName, "payment pending"];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_usv_s_b_ppg2cf";
          parameters = [attendeeName, utsavName, packageName, paymentId];
        }
      } else if (isPendingStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_usv_s_b_pymtpndg2canc";
          parameters = [attendeeName, utsavName, packageName, "cancelled"];
        } else if (newStatus === "admin cancelled") {
          if (updatedBy === "cron" || options.isCron) {
            templateName = "bk_usv_s_b_ppg2acn_c";
          } else {
            templateName = "bk_usv_s_b_ppg2acn_a";
          }
          parameters = [attendeeName, utsavName, packageName, "admin cancelled"];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_usv_s_b_ppg2cf";
          parameters = [attendeeName, utsavName, packageName, paymentId];
        }
      } else if (isConfirmedStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_usv_s_b_cf2cn";
          parameters = [attendeeName, utsavName, packageName, "cancelled"];
        } else if (newStatus === "checkedin" || newStatus === "checked_in") {
          templateName = "bk_usv_s_b_cf2ci";
          parameters = [attendeeName, booking.roomno || options.roomno || "NA"];
        } else if (newStatus === "admin cancelled") {
          if (creditsRefunded > 0 && !hasBooker) {
            templateName = "bk_usv_s_b_cf2acn_wc";
            parameters = [attendeeName, utsavName, packageName, "admin cancelled", creditsStr];
          } else {
            templateName = "bk_usv_s_b_cf2acn_woc";
            parameters = [attendeeName, utsavName, packageName, "admin cancelled"];
          }
        }
      } else if (prevStatusNormalized === "cancelled") {
        if (newStatus === "admin cancelled" && creditsRefunded > 0 && !hasBooker) {
          templateName = "bk_usv_s_b_canc2adcanc_wcre";
          parameters = [attendeeName, utsavName, packageName, "admin cancelled", creditsStr];
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA UTSAV STATUS ATTENDEE: template=${templateName} to phone=${attendeePhone} (Attendee name=${attendeeName})`);
        const result = await sendWithTemplateFallback(attendeePhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending utsav WhatsApp notification to attendee for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Utsav WhatsApp attendee notification sent successfully: template=${templateName} to ${attendeePhone}`);
        }
      } else {
        console.log(`WA UTSAV STATUS SKIP ATTENDEE: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

    // --- 2. DISPATCH BOOKER (GUEST) NOTIFICATION ---
    if (hasBooker && bookerPhone) {
      let templateName = null;
      let parameters = [];

      if (prevStatusNormalized === "waiting") {
        if (newStatus === "cancelled") {
          templateName = "bk_usv_gu_b_wtng2canc";
          parameters = [bookerName, utsavName, packageName, "cancelled", attendeeName];
        } else if (newStatus === "admin cancelled") {
          templateName = "bk_usv_gu_b_w2acn";
          parameters = [bookerName, utsavName, packageName, "admin cancelled", attendeeName];
        } else if (isPendingStatus(newStatus)) {
          templateName = "bk_usv_gu_b_w2ppg";
          parameters = [bookerName, utsavName, packageName, "payment pending", attendeeName];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_usv_gu_b_ppg2cf";
          parameters = [bookerName, utsavName, packageName, paymentId, attendeeName];
        }
      } else if (isPendingStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_usv_gu_b_pymtpndg2canc";
          parameters = [bookerName, utsavName, packageName, "cancelled", attendeeName];
        } else if (newStatus === "admin cancelled") {
          if (updatedBy === "cron" || options.isCron) {
            templateName = "bk_usv_gu_b_ppg2acn_c";
          } else {
            templateName = "bk_usv_gu_b_ppg2acn_a";
          }
          parameters = [bookerName, utsavName, packageName, "admin cancelled", attendeeName];
        } else if (isConfirmedStatus(newStatus)) {
          templateName = "bk_usv_gu_b_ppg2cf";
          parameters = [bookerName, utsavName, packageName, paymentId, attendeeName];
        }
      } else if (isConfirmedStatus(prevStatusNormalized)) {
        if (newStatus === "cancelled") {
          templateName = "bk_usv_gu_b_cnfc2canc";
          parameters = [bookerName, utsavName, packageName, "cancelled", attendeeName];
        } else if (newStatus === "admin cancelled") {
          if (creditsRefunded > 0) {
            templateName = "bk_usv_gu_b_cf2acn_wc";
            parameters = [bookerName, utsavName, packageName, "admin cancelled", creditsStr, attendeeName];
          } else {
            templateName = "bk_usv_gu_b_cf2acn_woc";
            parameters = [bookerName, utsavName, packageName, "admin cancelled", attendeeName];
          }
        }
      } else if (prevStatusNormalized === "cancelled") {
        if (newStatus === "admin cancelled" && creditsRefunded > 0) {
          templateName = "bk_usv_gu_b_canc2adcanc_wcre";
          parameters = [bookerName, utsavName, packageName, "admin cancelled", creditsStr, attendeeName];
        }
      }

      if (templateName) {
        const sanitizedParams = parameters.map(p => sanitizeParamText(p));
        const components = buildBodyComponents(sanitizedParams);
        console.log(`WA UTSAV STATUS BOOKER: template=${templateName} to phone=${bookerPhone} (Booker name=${bookerName})`);
        const result = await sendWithTemplateFallback(bookerPhone, templateName, components);
        if (!result || !result.ok) {
          console.error(`Error sending utsav WhatsApp notification to booker for template ${templateName}`, result?.error);
        } else {
          console.log(`📩 Utsav WhatsApp booker notification sent successfully: template=${templateName} to ${bookerPhone}`);
        }
      } else {
        console.log(`WA UTSAV STATUS SKIP BOOKER: No matching template for transition '${prevStatusNormalized}' -> '${newStatus}'`);
      }
    }

  } catch (err) {
    console.error("Error in sendUtsavStatusChangeWhatsApp:", err && (err.stack || err.message || err));
  }
}

export async function sendFoodWhatsApp(user, foodBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? formatWhatsAppPhone(user.mobno, user.country) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping food WA.`);
    return;
  }

  const isNRI = user && user.country && String(user.country).trim().toLowerCase() !== 'india';

  if (!Array.isArray(foodBookingDetails) || foodBookingDetails.length === 0) return;

  try {
    // 1. Gather all dates and find min/max
    const dates = foodBookingDetails.map(b => b.date).filter(Boolean).sort();
    if (dates.length === 0) return;
    const minDate = moment(dates[0]).format("DD-MM-YYYY");
    const maxDate = moment(dates[dates.length - 1]).format("DD-MM-YYYY");

    // 2. Fetch transactions associated with the food bookings to determine payment status
    const bookingIds = foodBookingDetails.map(b => b.id || b.bookingid).filter(Boolean);
    let isPaymentPending = false;
    let paymentId = "N/A";

    if (bookingIds.length) {
      const txs = await Transactions.findAll({
        where: {
          bookingid: { [Op.in]: bookingIds }
        }
      });
      // Check if any transactions indicate payment pending
      const pendingStatuses = ["pending", "payment_pending", "cash pending", "cash_pending", "failed", "payment_failed"];
      isPaymentPending = txs.some(tx => pendingStatuses.includes(String(tx.status).trim().toLowerCase()));

      // Resolve the payment ID (razorpay order ID)
      const txWithOrder = txs.find(tx => tx.razorpay_order_id);
      if (txWithOrder) {
        paymentId = txWithOrder.razorpay_order_id;
      }
    }

    // Determine booking details (bookedBy, traveler cardno)
    const firstBooking = foodBookingDetails[0];
    const attendeeCardno = firstBooking.cardno;
    const bookedByCardno = firstBooking.bookedBy;

    // Is it a guest booking?
    const isGuest = !!(bookedByCardno && String(bookedByCardno) !== String(attendeeCardno));

    let template = "";
    let bodyParams = [];
    let headerParam = "";

    if (isGuest) {
      const isBooker = String(user.cardno) === String(bookedByCardno);

      if (isBooker) {
        let attendeeName = "";
        if (bookedForUser) {
          attendeeName = bookedForUser.issuedto || "";
        } else {
          const attendee = await CardDb.findOne({ where: { cardno: attendeeCardno } }).catch(() => null);
          attendeeName = attendee?.issuedto || "";
        }
        headerParam = attendeeName;

        if (isPaymentPending) {
          template = isNRI ? "bn_psd_gu_b_ppng_nri" : "bn_psd_gu_b_ppng";
          bodyParams = [user.issuedto || "", minDate, maxDate, "payment pending"];
        } else {
          template = "bn_psd_gu_b_cnfm";
          bodyParams = [user.issuedto || "", minDate, maxDate, paymentId];
        }
      } else {
        let bookerName = "";
        if (bookedForUser) {
          bookerName = bookedForUser.issuedto || "";
        } else {
          const booker = await CardDb.findOne({ where: { cardno: bookedByCardno } }).catch(() => null);
          bookerName = booker?.issuedto || "";
        }
        headerParam = bookerName;

        if (isPaymentPending) {
          template = "bn_psd_gu_f_pp";
          bodyParams = [user.issuedto || "", minDate, maxDate, "payment pending"];
        } else {
          template = "bn_psd_gu_f_cf";
          bodyParams = [user.issuedto || "", minDate, maxDate];
        }
      }
    } else {
      template = "bn_psd_s_b_cf";
      bodyParams = [user.issuedto || "", minDate, maxDate];
    }

    const sanitizedParams = bodyParams.map(p => sanitizeParamText(p));
    const bodyComp = buildBodyComponents(sanitizedParams)[0];
    let components = [];

    if (headerParam) {
      const sanitizedHeader = sanitizeParamText(headerParam);
      const headerParameters = [{ type: "text", text: sanitizedHeader === "" ? " " : sanitizedHeader }];
      components = [
        { type: "header", parameters: headerParameters },
        bodyComp
      ];
    } else {
      components = [bodyComp];
    }

    console.log(`WA FOOD: to=${user.cardno} phone=${phone} range=${minDate} to ${maxDate} isGuest=${isGuest} isPaymentPending=${isPaymentPending} -> template='${template}'`);
    const result = await sendWithTemplateFallback(phone, template, components);

    if (!result || !result.ok) {
      console.error("Food WA failed for booking", bookingIds, result && result.error ? result.error : "unknown");
    } else {
      console.log("📩 Food WhatsApp sent:", {
        toCard: user.cardno,
        template: result.usedTemplate || template
      });
    }

  } catch (err) {
    console.error("Error sending food WhatsApp:", err && (err.stack || err.message || err));
  }
}

const COUNT_FILE = path.join(process.cwd(), 'last_meals_count.json');

export async function sendTomorrowMealsCount(recipients = []) {
  try {
    const nowIST = moment().tz('Asia/Kolkata');
    const tomorrowStr = nowIST.clone().add(1, 'day').format('YYYY-MM-DD');
    const tomorrowFormatted = nowIST.clone().add(1, 'day').format('DD-MM-YYYY');

    // Query meal counts for tomorrow
    const [individualCounts, bulkCounts] = await Promise.all([
      FoodDb.findOne({
        attributes: [
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.literal('CASE WHEN breakfast = 1 THEN 1 ELSE 0 END')), 0), 'breakfast'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.literal('CASE WHEN lunch = 1 THEN 1 ELSE 0 END')), 0), 'lunch'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.literal('CASE WHEN dinner = 1 THEN 1 ELSE 0 END')), 0), 'dinner']
        ],
        where: { date: tomorrowStr }
      }),
      BulkFoodBooking.findOne({
        attributes: [
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('breakfast')), 0), 'breakfast'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('lunch')), 0), 'lunch'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('dinner')), 0), 'dinner']
        ],
        where: { date: tomorrowStr }
      })
    ]);

    const breakfast = parseInt(individualCounts?.dataValues?.breakfast || 0) + parseInt(bulkCounts?.dataValues?.breakfast || 0);
    const lunch = parseInt(individualCounts?.dataValues?.lunch || 0) + parseInt(bulkCounts?.dataValues?.lunch || 0);
    const dinner = parseInt(individualCounts?.dataValues?.dinner || 0) + parseInt(bulkCounts?.dataValues?.dinner || 0);

    // Write counts to file to establish/update baseline
    const dataToSave = {
      tomorrowDate: tomorrowStr,
      breakfast,
      lunch,
      dinner
    };
    fs.writeFileSync(COUNT_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');

    // Retrieve recipient phone numbers
    const cards = await CardDb.findAll({
      where: { cardno: recipients },
      attributes: ['cardno', 'mobno', 'country']
    });

    const components = [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: tomorrowFormatted },
          { type: 'text', text: String(breakfast) },
          { type: 'text', text: String(lunch) },
          { type: 'text', text: String(dinner) }
        ]
      }
    ];

    for (const card of cards) {
      const phone = card.mobno;
      if (phone) {
        const formattedPhone = formatWhatsAppPhone(phone, card.country);
        try {
          await sendWhatsAppMessage(formattedPhone, 'daily_kitchen_meal_count', components);
          console.log(`✅ WhatsApp sent to ${card.cardno} (${formattedPhone}) for tomorrow's meals count`);
        } catch (err) {
          console.error(`❌ Error sending tomorrow's meals count to ${card.cardno} (${formattedPhone}):`, err.message || err);
        }
      }
    }
  } catch (err) {
    console.error("Error in sendTomorrowMealsCount:", err && (err.stack || err.message || err));
  }
}

export async function checkAndSendMealsCountUpdate() {
  try {
    const nowIST = moment().tz('Asia/Kolkata');
    const tomorrowStr = nowIST.clone().add(1, 'day').format('YYYY-MM-DD');

    // Query current meal counts for tomorrow
    const [individualCounts, bulkCounts] = await Promise.all([
      FoodDb.findOne({
        attributes: [
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.literal('CASE WHEN breakfast = 1 THEN 1 ELSE 0 END')), 0), 'breakfast'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.literal('CASE WHEN lunch = 1 THEN 1 ELSE 0 END')), 0), 'lunch'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.literal('CASE WHEN dinner = 1 THEN 1 ELSE 0 END')), 0), 'dinner']
        ],
        where: { date: tomorrowStr }
      }),
      BulkFoodBooking.findOne({
        attributes: [
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('breakfast')), 0), 'breakfast'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('lunch')), 0), 'lunch'],
          [Sequelize.fn('COALESCE', Sequelize.fn('SUM', Sequelize.col('dinner')), 0), 'dinner']
        ],
        where: { date: tomorrowStr }
      })
    ]);

    const breakfast = parseInt(individualCounts?.dataValues?.breakfast || 0) + parseInt(bulkCounts?.dataValues?.breakfast || 0);
    const lunch = parseInt(individualCounts?.dataValues?.lunch || 0) + parseInt(bulkCounts?.dataValues?.lunch || 0);
    const dinner = parseInt(individualCounts?.dataValues?.dinner || 0) + parseInt(bulkCounts?.dataValues?.dinner || 0);

    // Read last baseline count
    let lastCount = null;
    if (fs.existsSync(COUNT_FILE)) {
      try {
        const fileData = JSON.parse(fs.readFileSync(COUNT_FILE, 'utf8'));
        if (fileData.tomorrowDate === tomorrowStr) {
          lastCount = fileData;
        }
      } catch (err) {
        console.error("Error reading last meals count file:", err);
      }
    }

    let hasChanged = false;
    if (lastCount) {
      hasChanged = (
        lastCount.breakfast !== breakfast ||
        lastCount.lunch !== lunch ||
        lastCount.dinner !== dinner
      );
    } else {
      // No baseline exists (e.g. server restarted). Save current count as the new baseline but don't notify to avoid false/duplicate alerts.
      const dataToSave = {
        tomorrowDate: tomorrowStr,
        breakfast,
        lunch,
        dinner
      };
      fs.writeFileSync(COUNT_FILE, JSON.stringify(dataToSave, null, 2), 'utf8');
      console.log(`Saved baseline tomorrow meals count since last_meals_count.json did not exist.`);
      return;
    }

    if (hasChanged) {
      console.log(`Tomorrow's meals count changed! Old: B:${lastCount.breakfast} L:${lastCount.lunch} D:${lastCount.dinner} -> New: B:${breakfast} L:${lunch} D:${dinner}. Triggering update message to Maharaj.`);
      // Send updated count to Maharaj (0002823407) and save the new count baseline
      await sendTomorrowMealsCount(['0002823407']);
    } else {
      console.log(`Checked tomorrow's meals count. No change detected (B:${breakfast}, L:${lunch}, D:${dinner}).`);
    }
  } catch (err) {
    console.error("Error in checkAndSendMealsCountUpdate:", err && (err.stack || err.message || err));
  }
}

export async function sendLateCheckoutFeeWaivedWhatsApp(transaction) {
  try {
    if (!transaction) return;

    // 1. Get Card details
    const attendeeCard = await CardDb.findOne({ where: { cardno: transaction.cardno } });
    if (!attendeeCard) {
      console.warn(`WA LCF WAIVED SKIP: Card not found for cardno=${transaction.cardno}`);
      return;
    }

    const attendeePhone = attendeeCard.mobno ? formatWhatsAppPhone(attendeeCard.mobno, attendeeCard.country) : null;
    if (!attendeePhone) {
      console.warn(`WA LCF WAIVED SKIP: No mobile for cardno=${transaction.cardno}`);
      return;
    }

    const attendeeName = attendeeCard.issuedto || "";
    const amount = String(transaction.amount || 0);

    // 2. Parse booking ID from description
    let bookingId = transaction.bookingid || "";
    if (transaction.description && transaction.description.includes('booking ')) {
      const parts = transaction.description.split('booking ');
      if (parts.length > 1) {
        bookingId = parts[1].split(' ')[0];
      }
    }

    const templateName = "bk_sha_s_f_lcf_waived";
    const parameters = [attendeeName, amount, bookingId];

    const sanitizedParams = parameters.map(p => sanitizeParamText(p));
    const components = buildBodyComponents(sanitizedParams);

    console.log(`WA LCF WAIVED: template=${templateName} to phone=${attendeePhone} (Guest cardno=${transaction.cardno})`);

    const result = await sendWithTemplateFallback(attendeePhone, templateName, components);
    if (!result || !result.ok) {
      console.error(`Error sending late checkout fee waived WhatsApp notification for template ${templateName}`, result?.error);
    } else {
      console.log(`📩 WhatsApp late checkout fee waived notification sent successfully: template=${templateName} to ${attendeePhone}`);
    }
  } catch (err) {
    console.error("Error in sendLateCheckoutFeeWaivedWhatsApp:", err && (err.stack || err.message || err));
  }
}







