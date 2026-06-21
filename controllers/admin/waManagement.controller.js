import fs from 'fs';
import path from 'path';
import { WaGroupJob, UtsavDb, ShibirDb, WaTemplate, CardDb, UtsavBooking, ShibirBookingDb } from '../../models/associations.js';
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
 * Queue a broadcast message (announcement or poll) to a WhatsApp group.
 */
export const broadcastMessage = async (req, res) => {
  const {
    groupJid,
    text,
    action = 'send_message',
    scheduledAt,
    mediaUrl,
    mediaType,
    filename,
    mimetype,
    pollQuestion,
    pollOptions
  } = req.body;

  if (!groupJid) {
    return res.status(400).send({ message: 'groupJid is required' });
  }

  req.log.info('broadcast_message_start', { groupJid, action });

  try {
    let jobAction = action;
    let payload = { groupJid };

    if (action === 'send_poll' || pollQuestion) {
      jobAction = 'send_poll';
      if (!pollQuestion || !pollOptions || !Array.isArray(pollOptions) || pollOptions.length === 0) {
        return res.status(400).send({ message: 'pollQuestion and pollOptions are required for polls' });
      }
      payload.name = pollQuestion.trim();
      payload.options = pollOptions.map(opt => opt.trim()).filter(Boolean);
    } else {
      if (!text && !mediaUrl) {
        return res.status(400).send({ message: 'text or mediaUrl is required' });
      }
      payload.text = text ? text.trim() : '';
      if (mediaUrl) {
        payload.mediaUrl = mediaUrl;
        payload.mediaType = mediaType || 'image';
        payload.filename = filename || 'attachment';
        payload.mimetype = mimetype || 'application/octet-stream';
      }
    }

    const job = await WaGroupJob.create({
      action: jobAction,
      status: 'pending',
      groupJid,
      payload,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null
    });

    req.log.info('broadcast_message_queued', { jobId: job.id, action: jobAction, groupJid });
    return res.status(200).send({
      message: 'Broadcast message queued successfully',
      data: { jobId: job.id }
    });
  } catch (err) {
    req.log.error('Failed to queue broadcast message:', err.stack || err.message);
    return res.status(500).send({ message: 'Error queueing broadcast message' });
  }
};

/**
 * Fetch list of recently failed WhatsApp automation jobs.
 */
export const getFailedJobs = async (req, res) => {
  try {
    const failedJobs = await WaGroupJob.findAll({
      where: { status: 'failed' },
      order: [['updatedAt', 'DESC']],
      limit: 50
    });

    return res.status(200).send({
      message: 'Fetched failed WhatsApp jobs successfully',
      data: failedJobs
    });
  } catch (err) {
    req.log.error('Failed to fetch failed WhatsApp jobs:', err.message);
    return res.status(500).send({ message: 'Error fetching failed WhatsApp jobs' });
  }
};

/**
 * Retry a specific failed WhatsApp automation job by resetting it to pending.
 */
export const retryJob = async (req, res) => {
  const { id } = req.params;

  try {
    const job = await WaGroupJob.findOne({ where: { id, status: 'failed' } });
    if (!job) {
      return res.status(404).send({ message: 'Failed job not found' });
    }

    await job.update({
      status: 'pending',
      attempts: 0,
      error: null
    });

    req.log.info('whatsapp_job_retry_queued', { jobId: id });
    return res.status(200).send({
      message: 'WhatsApp job reset to pending successfully',
      data: job
    });
  } catch (err) {
    req.log.error(`Failed to retry WhatsApp job ${id}:`, err.message);
    return res.status(500).send({ message: 'Error retrying WhatsApp job' });
  }
};

/**
 * Retry all failed WhatsApp automation jobs.
 */
export const retryAllJobs = async (req, res) => {
  try {
    const [updatedCount] = await WaGroupJob.update(
      {
        status: 'pending',
        attempts: 0,
        error: null
      },
      {
        where: { status: 'failed' }
      }
    );

    req.log.info('whatsapp_jobs_retry_all_queued', { count: updatedCount });
    return res.status(200).send({
      message: `Successfully queued ${updatedCount} failed jobs for retry`,
      data: { retriedCount: updatedCount }
    });
  } catch (err) {
    req.log.error('Failed to retry all WhatsApp jobs:', err.message);
    return res.status(500).send({ message: 'Error retrying all WhatsApp jobs' });
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

    // Check if there is already a pending/processing create_group job for this event
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

    // Format naming standard: "[Event Name] - [Start Date]"
    const dateStr = moment(event.start_date).format('DD MMM YYYY');
    const groupName = `${event.name} - ${dateStr}`;

    const job = await WaGroupJob.create({
      action: 'create_group',
      status: 'pending',
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
 * Fetch list of recently sent WhatsApp broadcast messages and polls (history).
 */
export const getSentMessages = async (req, res) => {
  try {
    const messages = await WaGroupJob.findAll({
      where: { action: ['send_message', 'send_poll'] },
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    // Resolve event names mapping context
    const [utsavs, shibirs] = await Promise.all([
      UtsavDb.findAll({
        attributes: ['name', 'whatsapp_group_jid'],
        where: { whatsapp_group_jid: { [Op.ne]: null } }
      }),
      ShibirDb.findAll({
        attributes: ['name', 'whatsapp_group_jid'],
        where: { whatsapp_group_jid: { [Op.ne]: null } }
      })
    ]);

    const jidMap = {};
    utsavs.forEach(u => {
      if (u.whatsapp_group_jid) jidMap[u.whatsapp_group_jid] = u.name;
    });
    shibirs.forEach(s => {
      if (s.whatsapp_group_jid) jidMap[s.whatsapp_group_jid] = s.name;
    });

    // Attach event names to messages where applicable
    const enrichedMessages = messages.map(msg => {
      const data = msg.toJSON();
      const targetJid = data.groupJid || data.payload?.groupJid;
      data.resolvedGroupName = jidMap[targetJid] || null;
      if (data.action === 'send_poll' && data.payload && data.payload.name) {
        data.payload.text = `[📊 Poll] ${data.payload.name}\nOptions: ${data.payload.options?.join(', ')}`;
      }
      return data;
    });

    return res.status(200).send({
      message: 'Fetched sent WhatsApp messages successfully',
      data: enrichedMessages
    });
  } catch (err) {
    req.log.error('Failed to fetch sent WhatsApp messages:', err.stack || err.message);
    return res.status(500).send({ message: 'Error fetching sent WhatsApp messages' });
  }
};

/**
 * Fetch all WhatsApp message templates from the database.
 */
export const getTemplates = async (req, res) => {
  try {
    const templates = await WaTemplate.findAll({
      order: [['name', 'ASC']]
    });
    return res.status(200).send({
      message: 'Fetched WhatsApp templates successfully',
      data: templates
    });
  } catch (err) {
    req.log.error('Failed to fetch WhatsApp templates:', err.message);
    return res.status(500).send({ message: 'Error fetching WhatsApp templates' });
  }
};

/**
 * Save a new WhatsApp message template to the database.
 */
export const createTemplate = async (req, res) => {
  const { name, text } = req.body;

  if (!name || !text) {
    return res.status(400).send({ message: 'name and text are required' });
  }

  try {
    const template = await WaTemplate.create({
      name: name.trim(),
      text: text.trim()
    });

    req.log.info('whatsapp_template_created', { templateId: template.id });
    return res.status(200).send({
      message: 'WhatsApp template saved successfully',
      data: template
    });
  } catch (err) {
    req.log.error('Failed to create WhatsApp template:', err.stack || err.message);
    return res.status(500).send({ message: 'Error saving WhatsApp template' });
  }
};

/**
 * Delete a WhatsApp message template from the database.
 */
export const deleteTemplate = async (req, res) => {
  const { id } = req.params;

  try {
    const template = await WaTemplate.findByPk(id);
    if (!template) {
      return res.status(404).send({ message: 'WhatsApp template not found' });
    }

    await template.destroy();

    req.log.info('whatsapp_template_deleted', { templateId: id });
    return res.status(200).send({
      message: 'WhatsApp template deleted successfully'
    });
  } catch (err) {
    req.log.error(`Failed to delete WhatsApp template ${id}:`, err.message);
    return res.status(500).send({ message: 'Error deleting WhatsApp template' });
  }
};

/**
 * Handle file upload for media announcements and return media details.
 */
export const uploadMedia = async (req, res) => {
  if (!req.file) {
    return res.status(400).send({ message: 'No file uploaded' });
  }

  const mediaUrl = `/public/uploads/whatsapp/${req.file.filename}`;
  const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'document';

  req.log.info('whatsapp_media_uploaded', { filename: req.file.filename, mediaType });
  return res.status(200).send({
    message: 'File uploaded successfully',
    data: {
      mediaUrl,
      mediaType,
      filename: req.file.originalname,
      mimetype: req.file.mimetype
    }
  });
};

/**
 * Perform WhatsApp group reconciliation audit (Expected DB attendees vs. Actual WA group participants).
 */
export const getGroupReconciliation = async (req, res) => {
  const { groupJid } = req.params;

  if (!groupJid) {
    return res.status(400).send({ message: 'groupJid is required' });
  }

  try {
    // 1. Identify which event is associated with this group JID
    const utsav = await UtsavDb.findOne({ where: { whatsapp_group_jid: groupJid } });
    const shibir = await ShibirDb.findOne({ where: { whatsapp_group_jid: groupJid } });

    if (!utsav && !shibir) {
      return res.status(404).send({ message: 'No event registered with this WhatsApp group JID' });
    }

    // 2. Queue fetch_members job in DB
    const job = await WaGroupJob.create({
      action: 'fetch_members',
      status: 'pending',
      groupJid,
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
        return res.status(500).send({
          message: `WhatsApp service failed to fetch group participants: ${completedJob.error || 'Unknown error'}`
        });
      }
      attempts++;
    }

    if (!completedJob || completedJob.status !== 'success') {
      return res.status(500).send({
        message: 'Timeout waiting for WhatsApp service to fetch group members. Please make sure the WhatsApp worker process is running.'
      });
    }

    // 4. Extract actual participant phone numbers
    const participants = completedJob.payload?.participants || [];
    const actualPhonesMap = {};
    const extraPhones = [];

    participants.forEach(jid => {
      const phone = jid.split('@')[0];
      if (phone) {
        actualPhonesMap[phone] = jid;
      }
    });

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

      if (actualPhonesMap[formatted]) {
        matched.push(memberObj);
        matchedPhones.add(formatted);
      } else {
        missing.push(memberObj);
      }
    });

    // 7. Find extra members (in WhatsApp group but no booking)
    const extra = [];
    const extraPhonesList = Object.keys(actualPhonesMap).filter(phone => !matchedPhones.has(phone));

    for (const phone of extraPhonesList) {
      // Robust lookup by mobile in CardDb
      let card = await CardDb.findOne({
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

      extra.push({
        cardno: card ? card.cardno : null,
        issuedto: card ? card.issuedto : 'Unknown User',
        phone: phone,
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
        matched,
        missing,
        extra
      }
    });

  } catch (err) {
    req.log.error('Group reconciliation failed:', err.stack || err.message);
    return res.status(500).send({ message: 'Error checking reconciliation' });
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
          phone: item.phone
        });
        queuedJobs.push(job.id);
      } else if (item.action === 'remove') {
        const job = await WaGroupJob.create({
          action: 'remove_member',
          status: 'pending',
          groupJid,
          phone: item.phone
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
 * Reschedule a pending or failed WhatsApp automation job.
 */
export const rescheduleJob = async (req, res) => {
  const { id } = req.params;
  const { scheduledAt } = req.body;

  if (!scheduledAt) {
    return res.status(400).send({ message: 'scheduledAt is required' });
  }

  try {
    const job = await WaGroupJob.findOne({ where: { id } });
    if (!job) {
      return res.status(404).send({ message: 'WhatsApp job not found' });
    }

    await job.update({
      scheduledAt: new Date(scheduledAt),
      status: 'pending',
      attempts: 0,
      error: null
    });

    req.log.info('whatsapp_job_rescheduled', { jobId: id, scheduledAt });
    return res.status(200).send({
      message: 'WhatsApp job rescheduled successfully',
      data: job
    });
  } catch (err) {
    req.log.error(`Failed to reschedule WhatsApp job ${id}:`, err.message);
    return res.status(500).send({ message: 'Error rescheduling WhatsApp job' });
  }
};

/**
 * Cancel and delete a pending WhatsApp automation job.
 */
export const cancelJob = async (req, res) => {
  const { id } = req.params;

  try {
    const job = await WaGroupJob.findOne({ where: { id } });
    if (!job) {
      return res.status(404).send({ message: 'WhatsApp job not found' });
    }

    await job.destroy();

    req.log.info('whatsapp_job_cancelled', { jobId: id });
    return res.status(200).send({
      message: 'WhatsApp job cancelled successfully'
    });
  } catch (err) {
    req.log.error(`Failed to cancel WhatsApp job ${id}:`, err.message);
    return res.status(500).send({ message: 'Error cancelling WhatsApp job' });
  }
};
