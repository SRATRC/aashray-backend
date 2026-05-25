import Sequelize from "sequelize";
// at top of both files (whatsapp.helper and mumukshuBooking.controller)
import { Op } from 'sequelize';
import { CardDb, Transactions, UtsavDb, UtsavPackagesDb } from "../models/associations.js";
import moment from "moment";
// import { TYPE_ADHYAYAN } from "../config/constants.js";
import { sendWhatsAppMessage } from "../utils/sendWhatsAppMessage.js";

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
  try {
    const result = await sendWhatsAppMessage(phone, template, components);
    return { ok: true, usedTemplate: template, responseData: result.responseData };
  } catch (err) {
    const status = err?.response?.status || err?.whatsappContext?.status;
    const details = err?.response?.data || err?.whatsappContext?.responseData;

    const isTemplateMissing =
      status === 404 &&
      details &&
      details.error &&
      String(details.error.details || "").toLowerCase().includes("does not exist");

    console.warn(`WA SEND FAILED for ${phone} template=${template}:`, err.message || err);

    if (isTemplateMissing) {
      let fallbackTemplate = template;
      fallbackTemplate = fallbackTemplate.replace(
        /_pending_for|_pending|_waiting_for|_waiting/gi,
        "_confirmed"
      );

      if (fallbackTemplate === template) {
        fallbackTemplate = "booking_adhyayan_self_confirmed";
      }

      try {
        console.log(`WA SEND: retrying with fallback template '${fallbackTemplate}' for phone ${phone}`);
        const retryResult = await sendWhatsAppMessage(phone, fallbackTemplate, components);
        return {
          ok: true,
          usedTemplate: fallbackTemplate,
          fallback: true,
          responseData: retryResult.responseData,
        };
      } catch (innerErr) {
        console.error(
          `WA fallback also failed for ${phone} template=${fallbackTemplate}:`,
          innerErr.message || innerErr
        );
        return { ok: false, error: innerErr };
      }
    }

    return { ok: false, error: err };
  }
}

// Exported main function
export async function sendUnifiedWhatsApp(
  cardno,
  adhyanBookingDetails = [],
  travelBookingDetails = [],
  flatBookingDetails = [],
  utsavBookingDetails = [],
  roomBookingDetails = [],
  bookedForCardno = null // NEW optional arg
) {
  try {
    if (!cardno) {
      console.warn("sendUnifiedWhatsApp called without cardno");
      return;
    }

    const user = await CardDb.findOne({ where: { cardno } });
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

    const phone = user?.mobno ? String(user.mobno) : null;
    if (!phone) {
      console.warn(`⚠️ No WhatsApp number found for ${user?.issuedto} (cardno=${cardno})`);
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

  const phone = user?.mobno ? String(user.mobno) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno || "unknown"}; skipping adhyayan WA.`);
    return;
  }

  // Cache for bookedFor cardno -> issuedto (minimize DB hits)
  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) {
    bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");
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

      // tolerant template selection
      let template = "booking_adhyayan_self_confirmed";
      if (bookingStatus === "waiting" || bookingStatus.startsWith("wait")) {
        template = "booking_adhyayan_self_waiting_for";
      } else if (bookingStatus === "pending" || bookingStatus.includes("pend")) {
        template = "booking_adhyayan_self_pending_for";
      } else {
        template = "booking_adhyayan_self_confirmed";
      }

      const shibir = b.ShibirDb || {};
      const bookingId = b.bookingid || b.bookingId || (b.id ? String(b.id) : "");

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

      // Debug log so we can verify behavior
      console.log(`WA ADHYAYAN: to=${user.cardno} phone=${phone} bookingId=${bookingId} rawStatus='${String(b.status)}' normalized='${bookingStatus}' -> template='${template}' bookedFor='${bookedForName}' shibirExists=${!!shibir && !!shibir.name}`);

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

      const components = [{ type: "body", parameters: bodyParameters }];

      // Button only for waiting/pending templates
      if ((template === "booking_adhyayan_self_waiting_for" || template === "booking_adhyayan_self_pending_for") && shibir.id) {
        components.push({
          type: "button",
          sub_type: "url",
          index: 0,
          parameters: [{ type: "text", text: String(shibir.id) }]
        });
      }

      // send with fallback handling
      const sendResult = await sendWithTemplateFallback(phone, template, components);
      if (!sendResult.ok) {
        console.error("Adhyayan WA failed for booking", bookingId, sendResult.error);
      } else {
        console.log("📩 Adhyayan WhatsApp sent:", {
          toCard: user.cardno,
          bookedFor: bookedForName,
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

async function sendRoomWhatsApp(user, roomBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? String(user.mobno) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping room WA.`);
    return;
  }

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

  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");

  for (const b of roomBookingDetails) {
    try {
      if (!b || typeof b !== "object") continue;

      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const status = rawStatus.trim().toLowerCase();

      // choose template names — adjust to actual template strings you use
      let template = "booking_sharan_self_pending_for";
      if (status === "waiting" || status.startsWith("wait")) template = "booking_sharan_self_pending_for";
      else if (status === "pending" || status.includes("pend")) template = "booking_sharan_self_pending_for";

      // resolve bookedFor name
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

      // get transaction info
      const bookingId = String(b.bookingid || b.bookingId || b.id || "");
      const tx = transactionsMap.get(bookingId) || { amount: null, discount: null, razorpay_order_id: null };

      // build params (only include non-empty values to avoid template param mismatch)

      const rawParams = [
        user.issuedto || "",
        bookedForName,
        bookingId,
        rawStatus || "",
        b.roomtype || "",
        b.roomno || "",
        b.checkin ? moment(b.checkin).format("Do MMMM, YYYY") : "",
        b.checkout ? moment(b.checkout).format("Do MMMM, YYYY") : "",
        tx.amount != null ? String(tx.amount) : "",
        tx.discount != null ? String(tx.discount) : "",
        //   tx.razorpay_order_id || ""
      ];

      const sanitized = rawParams.map(sanitizeParamText);
      const expectedCount = TEMPLATE_PARAM_COUNTS[template] || Math.max(...Object.values(TEMPLATE_PARAM_COUNTS));
      const components = buildBodyComponents(sanitized, expectedCount);

      // // add button param, sanitized:
      // if ((template === "booking_sharan_self_pending_for" || template === "booking_sharan_self_pending_for") && bookingId) {
      //   components.push({
      //   type: "button",
      //   sub_type: "url",
      //   index: 0
      // });
      // }

      // send with fallback wrapper if you have it, otherwise sendWhatsAppMessage(phone, template, components)
      const result = await sendWithTemplateFallback ? await sendWithTemplateFallback(phone, template, components) : await sendWhatsAppMessage(phone, template, components);

      if (!result || !result.ok) {
        console.error("Room WA failed for booking", bookingId, result && result.error ? result.error : "unknown");
      } else {
        console.log("📩 Room WhatsApp sent:", {
          toCard: user.cardno,
          bookedFor: bookedForName,
          booking: bookingId,
          template: result.usedTemplate || template,
          transaction: tx
        });
      }
    } catch (err) {
      console.error("Error sending room WhatsApp for", b.id || b.bookingid || b, err && (err.stack || err.message || err));
    }
  }
}


// TRAVEL
async function sendTravelWhatsApp(user, travelBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? String(user.mobno) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping travel WA.`);
    return;
  }

  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");

  for (const b of Array.isArray(travelBookingDetails) ? travelBookingDetails : []) {
    try {
      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const status = rawStatus.trim().toLowerCase();

      let template = "booking_travel_confirmed";
      if (status === "waiting" || status.startsWith("wait")) template = "booking_travel_waiting";
      else if (status === "pending" || status.includes("pend")) template = "booking_travel_pending";

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

      const params = [
        user.issuedto || "",
        bookedForName,
        b.id || b.bookingid || "",
        rawStatus || "",
        b.pickup_point || "",
        b.drop_point || "",
        b.date || ""
      ];

      const components = [{ type: "body", parameters: params.filter(p => p !== null && p !== undefined && p !== "").map(p => ({ type: "text", text: String(p) })) }];

      const result = await sendWithTemplateFallback(phone, template, components);
      if (!result.ok) console.error("Travel WA failed for booking", b, result.error);
      else console.log("📩 Travel WhatsApp sent:", { toCard: user.cardno, bookedFor: bookedForName, booking: b.id || b.bookingid || b, template: result.usedTemplate });
    } catch (err) {
      console.error("Error sending travel WhatsApp for", b.id || b.bookingid || b, err);
    }
  }
}

// UTSAV
async function sendUtsavWhatsApp(user, utsavBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? String(user.mobno) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping utsav WA.`);
    return;
  }

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

  for (const b of utsavBookingDetails) {
    try {
      if (!b || typeof b !== "object") continue;

      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const status = rawStatus.trim().toLowerCase();

      let template = "booking_utsav_self_confirmed_for";
      if (status === "waiting" || status.startsWith("wait")) template = "booking_utsav_self_confirmed_for";
      else if (status === "pending" || status.includes("pend")) template = "booking_utsav_self_confirmed_for";

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

      // If the booking object already contains utsav/ package fields (from your earlier join), use them. Otherwise, attempt to fetch
      let utsavName = b.utsavname || (b.UtsavDb && b.UtsavDb.name) || "";
      let location = (b.UtsavDb && b.UtsavDb.location) || "";
      let startDate = b.startdate || (b.UtsavDb && b.UtsavDb.start_date ? moment(b.UtsavDb.start_date).format("Do MMMM, YYYY") : "");
      let endDate = b.enddate || (b.UtsavDb && b.UtsavDb.end_date ? moment(b.UtsavDb.end_date).format("Do MMMM, YYYY") : "");
      let packageName = b.package || (b.UtsavPackagesDb && b.UtsavPackagesDb.name) || "";

      // transaction
      const bookingId = String(b.bookingid || b.bookingId || b.id || "");
      const tx = transactionsMap.get(bookingId) || { amount: null, discount: null, razorpay_order_id: null };

      const rawParams = [
        user.issuedto || "",
        bookedForName,
        bookingId,
        rawStatus || "",
        utsavName,
        packageName,
        location,
        startDate,
        endDate,
        tx.amount != null ? String(tx.amount) : "",
        tx.discount != null ? String(tx.discount) : "",
        tx.razorpay_order_id || ""
      ];

      const sanitized = rawParams.map(sanitizeParamText);
      const expectedCount = TEMPLATE_PARAM_COUNTS[template] || Math.max(...Object.values(TEMPLATE_PARAM_COUNTS));
      const components = buildBodyComponents(sanitized, expectedCount);

      // add button param, sanitized:
      // if ((template === "booking_utsav_self_confirmed_for" || template === "booking_utsav_self_confirmed_for") && bookingId) {
      //   components.push({
      //     type: "button",
      //     sub_type: "url",
      //     index: 0,
      //     // parameters: [{ type: "text", text: sanitizeParamText(bookingId) }]
      //   });
      // }
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
async function sendFlatWhatsApp(user, flatBookingDetails = [], bookedForUser = null) {
  if (!user) return;
  const phone = user?.mobno ? String(user.mobno) : null;
  if (!phone) {
    console.warn(`No mobile for cardno=${user.cardno}; skipping flat WA.`);
    return;
  }

  const bookedForCache = new Map();
  if (bookedForUser && bookedForUser.cardno) bookedForCache.set(bookedForUser.cardno, bookedForUser.issuedto || "");

  for (const b of Array.isArray(flatBookingDetails) ? flatBookingDetails : []) {
    try {
      const rawStatus = (b.status === undefined || b.status === null || String(b.status).trim() === "") ? "pending" : String(b.status);
      const status = rawStatus.trim().toLowerCase();

      let template = "booking_flat_confirmed";
      if (status === "waiting" || status.startsWith("wait")) template = "booking_flat_waiting";
      else if (status === "pending" || status.includes("pend")) template = "booking_flat_pending";

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

      const params = [
        user.issuedto || "",
        bookedForName,
        b.id || b.bookingid || "",
        rawStatus || "",
        b.flat_no || b.flatNo || "",
        b.start_date ? moment(b.start_date).format("DD MMM YYYY") : "",
        b.end_date ? moment(b.end_date).format("DD MMM YYYY") : ""
      ];

      const components = [{ type: "body", parameters: params.filter(p => p !== null && p !== undefined && p !== "").map(p => ({ type: "text", text: String(p) })) }];

      const result = await sendWithTemplateFallback(phone, template, components);
      if (!result.ok) console.error("Flat WA failed for booking", b, result.error);
      else console.log("📩 Flat WhatsApp sent:", { toCard: user.cardno, bookedFor: bookedForName, booking: b.id || b.bookingid || b, template: result.usedTemplate });
    } catch (err) {
      console.error("Error sending flat WhatsApp for", b.id || b.bookingid || b, err);
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

    const phone = user.mobno ? String(user.mobno) : null;
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
