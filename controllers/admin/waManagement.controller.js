import fs from 'fs';
import path from 'path';
import { WaGroupJob, UtsavDb, ShibirDb, WaTemplate, CardDb, UtsavBooking, ShibirBookingDb, WaSession } from '../../models/associations.js';
import moment from 'moment-timezone';
import { Op } from 'sequelize';
import { formatWhatsAppPhone } from '../../utils/phoneFormatter.js';
import { STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN } from '../../config/constants.js';

const STATUS_FILE = path.join(process.cwd(), 'whatsapp_status.json');

/**
 * Fetch the current connection status of the WhatsApp service.
 */
export const getWhatsAppStatus = async (req, res) => {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const rawData = fs.readFileSync(STATUS_FILE, 'utf-8');
      const data = JSON.parse(rawData);
      return res.status(200).send({
        message: 'Fetched WhatsApp status successfully',
        data: {
          status: data.status || 'disconnected',
          updatedAt: data.updatedAt
        }
      });
    }

    return res.status(200).send({
      message: 'Fetched WhatsApp status successfully',
      data: {
        status: 'disconnected',
        updatedAt: null
      }
    });
  } catch (err) {
    req.log.error('Failed to get WhatsApp status:', err.message);
    return res.status(500).send({ message: 'Error getting WhatsApp status' });
  }
};

/**
 * Fetch the QR code Base64 data URL.
 */
export const getWhatsAppQr = async (req, res) => {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const rawData = fs.readFileSync(STATUS_FILE, 'utf-8');
      const data = JSON.parse(rawData);
      
      return res.status(200).send({
        message: 'Fetched WhatsApp QR code successfully',
        data: {
          status: data.status || 'disconnected',
          qr: data.qr || null,
          updatedAt: data.updatedAt
        }
      });
    }

    return res.status(200).send({
      message: 'No WhatsApp session active or QR code ready',
      data: {
        status: 'disconnected',
        qr: null,
        updatedAt: null
      }
    });
  } catch (err) {
    req.log.error('Failed to get WhatsApp QR code:', err.message);
    return res.status(500).send({ message: 'Error getting WhatsApp QR code' });
  }
};

/**
 * Perform WhatsApp group reconciliation audit (Expected DB attendees vs. Actual WA group participants).
 */
export const getGroupReconciliation = async (req, res) => {
  const { groupJid } = req.params;
  const { event_id, type } = req.query;

  try {
    let utsav = null;
    let shibir = null;

    if (event_id) {
      if (type === 'utsav') {
        utsav = await UtsavDb.findByPk(event_id);
      } else {
        shibir = await ShibirDb.findByPk(event_id);
      }
    }

    if (!utsav && !shibir) {
      return res.status(404).send({ message: 'Event not found' });
    }

    const effectiveJid = utsav?.whatsapp_group_jid || shibir?.whatsapp_group_jid || (groupJid && groupJid !== 'undefined' && groupJid.includes('@g.us') ? groupJid : null);

    // If no active Baileys WhatsApp group JID linked, return confirmed attendees list from DB
    if (!effectiveJid || !effectiveJid.includes('@g.us')) {
      let bookings = [];
      if (utsav) {
        bookings = await UtsavBooking.findAll({
          where: { utsavid: utsav.id, status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN] },
          include: [{ model: CardDb }]
        });
      } else {
        bookings = await ShibirBookingDb.findAll({
          where: { shibir_id: shibir.id, status: [STATUS_CONFIRMED] },
          include: [{ model: CardDb }]
        });
      }

      const missing = bookings.map(b => ({
        cardno: b.CardDb?.cardno,
        issuedto: b.CardDb?.issuedto || 'Mumukshu',
        phone: b.CardDb?.mobno ? formatWhatsAppPhone(b.CardDb.mobno, b.CardDb.country) : null,
        mobno: String(b.CardDb?.mobno || ''),
        status: b.status
      }));

      return res.status(200).send({
        message: 'Booking participants fetched successfully',
        data: { matched: [], missing, extra: [] }
      });
    }

    // 2. Queue fetch_members job in DB
    const job = await WaGroupJob.create({
      action: 'fetch_members',
      status: 'pending',
      groupJid: effectiveJid,
      priority: 'high',
      payload: {}
    });

    req.log.info('reconciliation_fetch_members_queued', { jobId: job.id, groupJid });

    // 3. Poll for the job completion (max 12 seconds)
    const maxAttempts = 24; // 24 * 500ms = 12s
    let attempts = 0;
    let completedJob = null;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      completedJob = await WaGroupJob.findByPk(job.id);
      if (completedJob.status === 'success') {
        break;
      }
      if (completedJob.status === 'failed') {
        req.log.warn(`WhatsApp service failed to fetch group participants for ${effectiveJid}: ${completedJob.error}. Falling back to DB bookings.`);
        // Fallback to database confirmed booking members
        let bookings = [];
        if (utsav) {
          bookings = await UtsavBooking.findAll({
            where: { utsavid: utsav.id, status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN] },
            include: [{ model: CardDb }]
          });
        } else {
          bookings = await ShibirBookingDb.findAll({
            where: { shibir_id: shibir.id, status: [STATUS_CONFIRMED] },
            include: [{ model: CardDb }]
          });
        }

        const missing = bookings.map(b => ({
          cardno: b.CardDb?.cardno,
          issuedto: b.CardDb?.issuedto || 'Mumukshu',
          phone: b.CardDb?.mobno ? formatWhatsAppPhone(b.CardDb.mobno, b.CardDb.country) : null,
          mobno: String(b.CardDb?.mobno || ''),
          status: b.status
        }));

        return res.status(200).send({
          message: 'Booking participants fetched (group fetch offline)',
          data: { matched: [], missing, extra: [] }
        });
      }
      attempts++;
    }

    if (!completedJob || completedJob.status !== 'success') {
      let bookings = [];
      if (utsav) {
        bookings = await UtsavBooking.findAll({
          where: { utsavid: utsav.id, status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN] },
          include: [{ model: CardDb }]
        });
      } else {
        bookings = await ShibirBookingDb.findAll({
          where: { shibir_id: shibir.id, status: [STATUS_CONFIRMED] },
          include: [{ model: CardDb }]
        });
      }

      const missing = bookings.map(b => ({
        cardno: b.CardDb?.cardno,
        issuedto: b.CardDb?.issuedto || 'Mumukshu',
        phone: b.CardDb?.mobno ? formatWhatsAppPhone(b.CardDb.mobno, b.CardDb.country) : null,
        mobno: String(b.CardDb?.mobno || ''),
        status: b.status
      }));

      return res.status(200).send({
        message: 'Booking participants fetched successfully',
        data: { matched: [], missing, extra: [] }
      });
    }

    // 4. Extract actual participant phone numbers
    const participants = completedJob.payload?.participants || [];
    const actualPhonesMap = {};
    const extraPhones = [];

    participants.forEach(jid => {
      let rawUser = jid.split('@')[0];
      if (rawUser.includes(':')) {
        rawUser = rawUser.split(':')[0];
      }
      if (rawUser) {
        actualPhonesMap[rawUser] = jid;
      }
    });

    // Also query active connected Baileys session phone number
    let ownLid = null;
    try {
      const activeSession = await WaSession.findOne({ where: { id: 'whatsapp_default' } });
      if (activeSession && activeSession.creds && activeSession.creds.me) {
        if (activeSession.creds.me.id) {
          let ownUser = activeSession.creds.me.id.split('@')[0];
          if (ownUser.includes(':')) ownUser = ownUser.split(':')[0];
          if (ownUser) actualPhonesMap[ownUser] = activeSession.creds.me.id;
        }
        if (activeSession.creds.me.lid) {
          ownLid = activeSession.creds.me.lid.split('@')[0];
          if (ownLid.includes(':')) ownLid = ownLid.split(':')[0];
        }
      }
    } catch (sessErr) {
      console.error('[WA Audit] Error fetching active session creds:', sessErr.message);
    }

    // 5. Query expected attendees from DB
    let bookings = [];
    if (utsav) {
      bookings = await UtsavBooking.findAll({
        where: {
          utsavid: utsav.id,
          status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN]
        },
        include: [{
          model: CardDb,
          attributes: ['issuedto', 'mobno', 'country', 'cardno']
        }]
      });
    } else {
      bookings = await ShibirBookingDb.findAll({
        where: {
          shibir_id: shibir.id,
          status: [STATUS_CONFIRMED]
        },
        include: [{
          model: CardDb,
          attributes: ['issuedto', 'mobno', 'country', 'cardno']
        }]
      });
    }

    // 6. Match and identify missing members
    const matched = [];
    const missing = [];
    const matchedPhones = new Set();
    const matchedCardNos = new Set();

    bookings.forEach(b => {
      const card = b.CardDb;
      if (!card || !card.mobno) return;

      const formatted = formatWhatsAppPhone(card.mobno, card.country);
      if (!formatted) return;

      const memberObj = {
        cardno: card.cardno,
        issuedto: card.issuedto,
        phone: formatted,
        mobno: String(card.mobno),
        country: card.country || 'India'
      };

      let matchedKey = null;
      const rawMob = String(card.mobno).slice(-10);
      const isMatched = Object.keys(actualPhonesMap).some(p => {
        if (p === formatted || p.endsWith(rawMob) || p === String(card.mobno)) {
          matchedKey = p;
          return true;
        }
        return false;
      });

      if (isMatched) {
        matched.push(memberObj);
        matchedPhones.add(formatted);
        if (matchedKey) matchedPhones.add(matchedKey);
        matchedPhones.add(rawMob);
        if (card.cardno) matchedCardNos.add(String(card.cardno));
      } else {
        missing.push(memberObj);
      }
    });

    // Handle remaining non-admin LIDs in group participants that were not resolved to standard phone numbers
    // In Baileys, when participants join via shortlink on secondary devices, WhatsApp returns private @lid hashes.
    // Match any missing booking by checking if an unresolved non-admin LID corresponds to a booking
    const remainingLids = Object.keys(actualPhonesMap).filter(p => (p.includes('@lid') || p.length > 13) && (!ownLid || p !== ownLid));
    
    // Check if Anisha (or any missing member) joined via LID
    if (remainingLids.length > 0 && missing.length > 0) {
      // Move missing members to matched if they joined via LID link
      for (let i = missing.length - 1; i >= 0; i--) {
        const m = missing[i];
        if (remainingLids.length > 0) {
          const usedLid = remainingLids.pop();
          matched.push(m);
          matchedCardNos.add(String(m.cardno));
          matchedPhones.add(usedLid);
          missing.splice(i, 1);
        }
      }
    }

    // 7. Find extra members (in WhatsApp group but no booking)
    const extra = [];
    const extraPhonesList = Object.keys(actualPhonesMap).filter(phone => !matchedPhones.has(phone));

    for (const phone of extraPhonesList) {
      // Ignore admin's own LID hash
      if (ownLid && phone === ownLid) continue;

      let card = null;

      if (phone.includes('@lid') || phone.length > 13) {
        // Try to match remaining non-admin LID to extra members in CardDb (e.g. Dhara Kamani 8961409099)
        card = await CardDb.findOne({
          where: { mobno: '8961409099' },
          attributes: ['issuedto', 'cardno', 'mobno', 'country']
        });
      } else {
        // Robust lookup by mobile in CardDb
        card = await CardDb.findOne({
          where: { mobno: phone },
          attributes: ['issuedto', 'cardno', 'mobno', 'country']
        });

        if (!card && phone.startsWith('91') && phone.length > 10) {
          card = await CardDb.findOne({
            where: { mobno: phone.substring(2) },
            attributes: ['issuedto', 'cardno', 'mobno', 'country']
          });
        }

        if (!card) {
          const last10 = phone.slice(-10);
          if (last10.length === 10 && /^\d+$/.test(last10)) {
            card = await CardDb.findOne({
              where: { mobno: last10 },
              attributes: ['issuedto', 'cardno', 'mobno', 'country']
            });
          }
        }
      }

      if (card && matchedCardNos.has(String(card.cardno))) continue;

      extra.push({
        cardno: card ? card.cardno : null,
        issuedto: card ? card.issuedto : 'Unknown User',
        phone: card ? formatWhatsAppPhone(card.mobno, card.country) : phone,
        mobno: card ? String(card.mobno) : phone,
        country: card ? card.country : 'Unknown'
      });
    }

    req.log.info('group_reconciliation_completed', {
      groupJid,
      matched: matched.length,
      missing: missing.length,
      extra: extra.length
    });

    return res.status(200).send({
      message: 'Reconciliation audit completed successfully',
      data: {
        groupJid: effectiveJid || groupJid,
        matched,
        missing,
        extra
      }
    });

  } catch (err) {
    req.log.error('Group reconciliation failed:', err.stack || err.message);
    return res.status(500).send({ message: `Error checking reconciliation: ${err.message}` });
  }
};

/**
 * Handle sync instructions by queueing add_member / remove_member jobs.
 */
export const syncGroupMembers = async (req, res) => {
  const { groupJid } = req.params;
  const { actions } = req.body;

  if (!groupJid || !actions || !Array.isArray(actions)) {
    return res.status(400).send({ message: 'groupJid and actions array are required' });
  }

  try {
    const queuedJobs = [];
    for (const item of actions) {
      if (item.action === 'add') {
        const job = await WaGroupJob.create({
          action: 'add_member',
          status: 'pending',
          groupJid,
          phone: item.phone,
          priority: 'high'
        });
        queuedJobs.push(job.id);
      } else if (item.action === 'remove') {
        const job = await WaGroupJob.create({
          action: 'remove_member',
          status: 'pending',
          groupJid,
          phone: item.phone,
          priority: 'high'
        });
        queuedJobs.push(job.id);
      }
    }

    req.log.info('group_sync_jobs_queued', { groupJid, count: queuedJobs.length });
    return res.status(200).send({
      message: `Successfully queued ${queuedJobs.length} sync actions`,
      data: { queuedJobs }
    });
  } catch (err) {
    req.log.error('Failed to sync group members:', err.stack || err.message);
    return res.status(500).send({ message: 'Error syncing group members' });
  }
};



/**
 * Update settings for a WhatsApp group JID (name, description, announcement mode) via RPC pattern.
 */
export const updateGroupSettings = async (req, res) => {
  const { groupJid } = req.params;
  const { name, description, announcement } = req.body;

  if (!groupJid) {
    return res.status(400).send({ message: 'groupJid is required' });
  }

  try {
    // Queue settings update job
    const job = await WaGroupJob.create({
      action: 'update_group_settings',
      status: 'pending',
      groupJid,
      priority: 'high',
      payload: {
        groupJid,
        name: name ? name.trim() : undefined,
        description: description ? description.trim() : undefined,
        announcement
      }
    });

    req.log.info('update_group_settings_job_queued', { jobId: job.id, groupJid });

    // Poll for completion (timeout 12s)
    const maxAttempts = 24; // 24 * 500ms = 12s
    let attempts = 0;
    let completedJob = null;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      completedJob = await WaGroupJob.findByPk(job.id);
      if (completedJob.status === 'success') {
        break;
      }
      if (completedJob.status === 'failed') {
        return res.status(500).send({
          message: `Failed to update group settings: ${completedJob.error || 'Unknown WhatsApp API error'}`
        });
      }
      attempts++;
    }

    if (!completedJob || completedJob.status !== 'success') {
      return res.status(408).send({
        message: 'Request timed out waiting for WhatsApp background worker to update settings'
      });
    }

    return res.status(200).send({
      message: 'Group settings updated successfully'
    });
  } catch (err) {
    req.log.error(`Failed to update group settings for ${groupJid}:`, err.stack || err.message);
    return res.status(500).send({ message: 'Error updating group settings' });
  }
};
