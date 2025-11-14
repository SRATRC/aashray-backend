import { CardDb } from "../models/associations.js";
import moment from "moment";
// import { TYPE_ADHYAYAN } from "../config/constants.js";
import { sendWhatsAppMessage } from "../utils/sendWhatsAppMessage.js";

// Exported main function
// old:
// export async function sendUnifiedWhatsApp(cardno, adhyanBookingDetails = [], ...) { ... }

// new:
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
      bookedForUser = await CardDb.findOne({ where: { cardno: bookedForCardno } });
      // if not found, we fallback later to user.issuedto
    }

    const phone = user?.mobno ? String(user.mobno) : null;
    if (!phone) {
      console.warn(`⚠️ No WhatsApp number found for ${user?.issuedto} (cardno=${cardno})`);
      return;
    }

    // ADHYAYAN
    if (Array.isArray(adhyanBookingDetails) && adhyanBookingDetails.length) {
      // pass bookedForUser (may be null)
      await sendAdhyayanWhatsApp(user, adhyanBookingDetails, bookedForUser);
    }

    // other types: pass bookedForUser similarly if you want the same behavior
    if (Array.isArray(roomBookingDetails) && roomBookingDetails.length) {
      await sendRoomWhatsApp(user, roomBookingDetails, bookedForUser);
    }

    // ... travel, utsav, flat etc.
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
      } else if (
        bookingStatus === "pending" ||
        bookingStatus.includes("pend") // handles "Pending", "PENDING", "pending_payment", etc.
      ) {
        template = "booking_adhyayan_self_waiting_for";
      } else {
        // anything else -> confirmed template
        template = "booking_adhyayan_self_waiting_for";
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

      // Button only for waiting template
      if (template === "booking_adhyayan_self_waiting_for" && shibir.id) {
        components.push({
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: String(shibir.id) }]
        });
      }

      // send and catch errors per-send (already inside try)
      await sendWhatsAppMessage(phone, template, components);

      console.log("📩 Adhyayan WhatsApp sent:", {
        toCard: user.cardno,
        bookedFor: bookedForName,
        bookingid: bookingId,
        status: bookingStatus,
        template
      });
    } catch (err) {
      console.error(
        "Error sending adhyayan WhatsApp for booking",
        b.bookingid || b.bookingId || b.id,
        err && (err.stack || err.message || err)
      );
    }
  }
}


// --- Utility helper to ensure phone and warn if missing ---
function phoneOrWarn(mobno) {
  if (!mobno) {
    throw new Error("No mobile number to send WhatsApp");
  }
  return String(mobno);
}

// --- Example placeholders for other types (implement template details similarly) ---
async function sendRoomWhatsApp(user, roomBookingDetails = []) {
  for (const b of roomBookingDetails) {
    try {
      const bookingStatus = String(b.status || "").toLowerCase();
      // choose template based on status and build params similar to adhyayan
      // e.g. template = bookingStatus === 'waiting' ? 'booking_room_waiting' : 'booking_room_confirmed'
      // build components and call sendWhatsAppMessage(user.mobno, template, components)
    } catch (err) {
      console.error("Error sending room WhatsApp for", b.id, err);
    }
  }
}

async function sendTravelWhatsApp(user, travelBookingDetails = []) {
  for (const b of travelBookingDetails) {
    try {
      // Implement similar to above
    } catch (err) {
      console.error("Error sending travel WhatsApp for", b.id, err);
    }
  }
}

async function sendUtsavWhatsApp(user, utsavBookingDetails = []) {
  for (const b of utsavBookingDetails) {
    try {
      // Implement similar to above
    } catch (err) {
      console.error("Error sending utsav WhatsApp for", b.id, err);
    }
  }
}

async function sendFlatWhatsApp(user, flatBookingDetails = []) {
  for (const b of flatBookingDetails) {
    try {
      // Implement similar to above
    } catch (err) {
      console.error("Error sending flat WhatsApp for", b.id, err);
    }
  }
}
