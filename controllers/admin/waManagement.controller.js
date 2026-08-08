import fs from 'fs';
import path from 'path';
import { WaGroupJob, UtsavDb, ShibirDb, CardDb, UtsavBooking, ShibirBookingDb, WaSession } from '../../models/associations.js';
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

export const fetchGroupReconciliationInternal = async (groupJid, type, event_id) => {
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
    return { matched: [], missing: [], extra: [] };
  }

  const effectiveJid = utsav?.whatsapp_group_jid || shibir?.whatsapp_group_jid || (groupJid && groupJid !== 'undefined' && groupJid.includes('@g.us') ? groupJid : null);

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

    return { matched: [], missing, extra: [] };
  }

  const job = await WaGroupJob.create({
    action: 'fetch_members',
    status: 'pending',
    groupJid: effectiveJid,
    priority: 'high',
    payload: {}
  });

  const maxAttempts = 24;
  let attempts = 0;
  let completedJob = null;

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 500));
    completedJob = await WaGroupJob.findByPk(job.id);
    if (completedJob.status === 'success') break;
    if (completedJob.status === 'failed') break;
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

    return { matched: [], missing, extra: [] };
  }

  const participants = completedJob.payload?.participants || [];
  const actualPhonesMap = {};

  participants.forEach(jid => {
    let rawUser = jid.split('@')[0];
    if (rawUser.includes(':')) rawUser = rawUser.split(':')[0];
    if (rawUser) actualPhonesMap[rawUser] = jid;
  });

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

  let bookings = [];
  if (utsav) {
    bookings = await UtsavBooking.findAll({
      where: { utsavid: utsav.id, status: [STATUS_CONFIRMED, STATUS_CASH_COMPLETED, ROOM_STATUS_CHECKEDIN] },
      include: [{ model: CardDb, attributes: ['issuedto', 'mobno', 'country', 'cardno'] }]
    });
  } else {
    bookings = await ShibirBookingDb.findAll({
      where: { shibir_id: shibir.id, status: [STATUS_CONFIRMED] },
      include: [{ model: CardDb, attributes: ['issuedto', 'mobno', 'country', 'cardno'] }]
    });
  }

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

  const remainingLids = Object.keys(actualPhonesMap).filter(p => (p.includes('@lid') || p.length > 13) && (!ownLid || p !== ownLid));
  if (remainingLids.length > 0 && missing.length > 0) {
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

  const extra = [];
  const extraPhonesList = Object.keys(actualPhonesMap).filter(phone => !matchedPhones.has(phone));

  for (const phone of extraPhonesList) {
    if (ownLid && phone === ownLid) continue;
    let card = null;

    if (!phone.includes('@lid') && phone.length <= 13) {
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

  return { groupJid: effectiveJid || groupJid, matched, missing, extra };
};

/**
 * Perform WhatsApp group reconciliation audit (Expected DB attendees vs. Actual WA group participants).
 */
export const getGroupReconciliation = async (req, res) => {
  const { groupJid } = req.params;
  const { event_id, type } = req.query;

  try {
    const data = await fetchGroupReconciliationInternal(groupJid, type, event_id);
    return res.status(200).send({
      message: 'Reconciliation audit completed successfully',
      data
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
 * Manually queue group creation for an event that doesn't have a WhatsApp group.
 */
export const triggerGroupCreation = async (req, res) => {
  const { type, eventId } = req.body;

  if (!type || !eventId) {
    return res.status(400).send({ message: 'type and eventId are required' });
  }

  if (type !== 'utsav' && type !== 'shibir') {
    return res.status(400).send({ message: "type must be 'utsav' or 'shibir'" });
  }

  try {
    let event = null;
    if (type === 'utsav') {
      event = await UtsavDb.findByPk(eventId);
    } else {
      event = await ShibirDb.findByPk(eventId);
    }

    if (!event) {
      return res.status(404).send({ message: `${type} event not found` });
    }

    if (event.whatsapp_group_jid) {
      return res.status(400).send({ message: 'This event already has a WhatsApp group JID assigned' });
    }

    const existingJobs = await WaGroupJob.findAll({
      where: {
        action: 'create_group',
        status: ['pending', 'processing']
      }
    });

    const isDuplicate = existingJobs.some(
      (job) => job.payload?.type === type && job.payload?.eventId == eventId
    );

    if (isDuplicate) {
      return res.status(400).send({ message: 'A group creation job is already in progress for this event' });
    }

    const dateStr = moment(event.start_date).format('DD MMM YYYY');
    const groupName = `${event.name} - ${dateStr}`;

    const job = await WaGroupJob.create({
      action: 'create_group',
      status: 'pending',
      priority: 'high',
      payload: {
        name: groupName,
        type,
        eventId
      }
    });

    req.log.info('whatsapp_group_creation_manually_triggered', { jobId: job.id, type, eventId });
    return res.status(200).send({
      message: 'WhatsApp group creation queued successfully',
      data: { jobId: job.id }
    });
  } catch (err) {
    req.log.error(`Failed to trigger group creation for ${type} ${eventId}:`, err.stack || err.message);
    return res.status(500).send({ message: 'Error queueing group creation' });
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
