import fs from 'fs';
import path from 'path';
import multer from 'multer';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { WaGroupJob, WaTemplate, UtsavDb, ShibirDb } from '../../models/associations.js';

// Uploads live OUTSIDE /public and are never served statically.
// Staff download them through an authenticated route only.
export const WA_UPLOAD_DIR = path.join(process.cwd(), 'uploads/whatsapp');
export const WA_UPLOAD_URL_PREFIX = 'uploads/whatsapp/';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TEXT_LENGTH = 4096;
const MAX_POLL_OPTIONS = 12;
const STORED_NAME_RE = /^media-\d+-[0-9a-f]{16}\.(jpg|png|webp|pdf)$/;
const PRIORITIES = ['high', 'normal', 'low'];

// mimetype -> [extension, mediaType, magic-byte check]
const ALLOWED_TYPES = {
  'image/jpeg': ['jpg', 'image', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  'image/png': ['png', 'image', (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  'image/webp': ['webp', 'image', (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP'],
  'application/pdf': ['pdf', 'document', (b) => b.slice(0, 5).toString() === '%PDF-']
};

const ensureUploadDir = () => fs.mkdirSync(WA_UPLOAD_DIR, { recursive: true });

export const waUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try { ensureUploadDir(); cb(null, WA_UPLOAD_DIR); } catch (e) { cb(e); }
    },
    // The stored name is generated here. The client name never reaches the disk path.
    filename: (req, file, cb) => {
      const info = ALLOWED_TYPES[file.mimetype];
      cb(null, `media-${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${info ? info[0] : 'bin'}`);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      const err = new Error('Only JPEG, PNG, WebP images and PDF files are allowed');
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  }
});

/** Wrap multer so type/size errors become a clean 400 instead of a 500. */
export const handleWaUpload = (req, res, next) => {
  waUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(400).send({
      message: tooBig ? `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` : (err.message || 'Upload failed')
    });
  });
};

const isEventGroup = async (groupJid) => {
  if (typeof groupJid !== 'string' || !groupJid.endsWith('@g.us')) return false;
  const [u, s] = await Promise.all([
    UtsavDb.findOne({ attributes: ['id'], where: { whatsapp_group_jid: groupJid } }),
    ShibirDb.findOne({ attributes: ['id'], where: { whatsapp_group_jid: groupJid } })
  ]);
  return Boolean(u || s);
};

/** Upload a media file for a later broadcast. */
export const uploadMedia = async (req, res) => {
  if (!req.file) return res.status(400).send({ message: 'No file uploaded' });
  const info = ALLOWED_TYPES[req.file.mimetype];
  const filePath = path.join(WA_UPLOAD_DIR, req.file.filename);
  try {
    // The mimetype comes from the client, so check the real file bytes too.
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(16);
    fs.readSync(fd, head, 0, 16, 0);
    fs.closeSync(fd);
    if (!info || !info[2](head)) {
      fs.unlinkSync(filePath);
      return res.status(400).send({ message: 'File content does not match its type' });
    }
  } catch (err) {
    try { fs.unlinkSync(filePath); } catch (_) { /* already gone */ }
    req.log.error('Failed to check WhatsApp upload:', err.message);
    return res.status(500).send({ message: 'Error uploading file' });
  }
  req.log.info('whatsapp_media_uploaded', { filename: req.file.filename, mediaType: info[1] });
  return res.status(200).send({
    message: 'File uploaded successfully',
    data: {
      mediaUrl: `${WA_UPLOAD_URL_PREFIX}${req.file.filename}`,
      mediaType: info[1],
      filename: String(req.file.originalname || 'attachment').slice(0, 200),
      mimetype: req.file.mimetype
    }
  });
};

/** Authenticated download of an uploaded file. */
export const getMedia = async (req, res) => {
  const { filename } = req.params;
  if (!STORED_NAME_RE.test(filename)) return res.status(400).send({ message: 'Invalid file name' });
  const filePath = path.join(WA_UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send({ message: 'File not found' });
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', 'attachment');
  return res.sendFile(filePath);
};

/** Queue a message or poll to an event's WhatsApp group. */
export const broadcastMessage = async (req, res) => {
  const { groupJid, text, action, scheduledAt, mediaUrl, mediaType, filename, mimetype, pollQuestion, pollOptions } = req.body || {};
  const priority = req.body?.priority || 'normal';

  if (!groupJid) return res.status(400).send({ message: 'groupJid is required' });
  if (!PRIORITIES.includes(priority)) return res.status(400).send({ message: 'priority must be high, normal or low' });
  if (action !== undefined && !['send_message', 'send_poll'].includes(action)) {
    return res.status(400).send({ message: 'action must be send_message or send_poll' });
  }

  let when = null;
  if (scheduledAt) {
    when = new Date(scheduledAt);
    if (Number.isNaN(when.getTime())) return res.status(400).send({ message: 'scheduledAt is not a valid date' });
  }

  try {
    // Only a group that belongs to an Utsav or Adhyayan can be a target.
    if (!(await isEventGroup(groupJid))) {
      return res.status(400).send({ message: 'groupJid is not a known Utsav or Adhyayan group' });
    }

    let jobAction = 'send_message';
    const payload = { groupJid };

    if (action === 'send_poll' || pollQuestion) {
      jobAction = 'send_poll';
      const options = Array.isArray(pollOptions) ? pollOptions.map((o) => String(o).trim()).filter(Boolean) : [];
      if (!pollQuestion || String(pollQuestion).trim() === '' || options.length < 2 || options.length > MAX_POLL_OPTIONS) {
        return res.status(400).send({ message: `pollQuestion and 2 to ${MAX_POLL_OPTIONS} pollOptions are required for polls` });
      }
      payload.name = String(pollQuestion).trim().slice(0, 255);
      payload.options = options;
    } else {
      const body = typeof text === 'string' ? text.trim() : '';
      if (!body && !mediaUrl) return res.status(400).send({ message: 'text or mediaUrl is required' });
      if (body.length > MAX_TEXT_LENGTH) return res.status(400).send({ message: `text is longer than ${MAX_TEXT_LENGTH} characters` });
      payload.text = body;
      if (mediaUrl) {
        // Only a file this API stored may be sent. This blocks path traversal and local-file reads.
        const m = typeof mediaUrl === 'string' && mediaUrl.startsWith(WA_UPLOAD_URL_PREFIX)
          ? mediaUrl.slice(WA_UPLOAD_URL_PREFIX.length) : '';
        if (!STORED_NAME_RE.test(m) || !fs.existsSync(path.join(WA_UPLOAD_DIR, m))) {
          return res.status(400).send({ message: 'mediaUrl must be a file returned by the upload endpoint' });
        }
        payload.mediaUrl = mediaUrl;
        payload.mediaType = mediaType === 'document' ? 'document' : 'image';
        payload.filename = String(filename || 'attachment').slice(0, 200);
        payload.mimetype = String(mimetype || 'application/octet-stream').slice(0, 100);
      }
    }

    const job = await WaGroupJob.create({
      action: jobAction,
      status: 'pending',
      groupJid,
      payload,
      priority,
      scheduledAt: when
    });
    req.log.info('broadcast_message_queued', { jobId: job.id, action: jobAction, groupJid });
    return res.status(200).send({ message: 'Broadcast message queued successfully', data: { jobId: job.id } });
  } catch (err) {
    req.log.error('Failed to queue broadcast message:', err.stack || err.message);
    return res.status(500).send({ message: 'Error queueing broadcast message' });
  }
};

/** Recently sent or queued broadcast messages and polls. */
export const getSentMessages = async (req, res) => {
  try {
    const messages = await WaGroupJob.findAll({
      where: { action: { [Op.in]: ['send_message', 'send_poll'] } },
      order: [['createdAt', 'DESC']],
      limit: 100
    });
    const [utsavs, shibirs] = await Promise.all([
      UtsavDb.findAll({ attributes: ['name', 'whatsapp_group_jid'], where: { whatsapp_group_jid: { [Op.ne]: null } } }),
      ShibirDb.findAll({ attributes: ['name', 'whatsapp_group_jid'], where: { whatsapp_group_jid: { [Op.ne]: null } } })
    ]);
    const jidMap = {};
    [...utsavs, ...shibirs].forEach((e) => { if (e.whatsapp_group_jid) jidMap[e.whatsapp_group_jid] = e.name; });

    const data = messages.map((msg) => {
      const row = msg.toJSON();
      const target = row.groupJid || row.payload?.groupJid;
      row.resolvedGroupName = jidMap[target] || null;
      return row;
    });
    return res.status(200).send({ message: 'Fetched sent WhatsApp messages successfully', data });
  } catch (err) {
    req.log.error('Failed to fetch sent WhatsApp messages:', err.stack || err.message);
    return res.status(500).send({ message: 'Error fetching sent WhatsApp messages' });
  }
};

/** Recently failed jobs of any kind. */
export const getFailedJobs = async (req, res) => {
  try {
    const data = await WaGroupJob.findAll({ where: { status: 'failed' }, order: [['updatedAt', 'DESC']], limit: 50 });
    return res.status(200).send({ message: 'Fetched failed WhatsApp jobs successfully', data });
  } catch (err) {
    req.log.error('Failed to fetch failed WhatsApp jobs:', err.message);
    return res.status(500).send({ message: 'Error fetching failed WhatsApp jobs' });
  }
};

const parseId = (v) => (/^\d+$/.test(String(v)) ? Number(v) : null);

/** Put one failed job back in the queue. */
export const retryJob = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).send({ message: 'Invalid job id' });
  try {
    // Conditional update: only a job that is still failed moves back to pending.
    const [count] = await WaGroupJob.update({ status: 'pending', attempts: 0, error: null }, { where: { id, status: 'failed' } });
    if (!count) return res.status(404).send({ message: 'Failed job not found' });
    req.log.info('whatsapp_job_retry_queued', { jobId: id });
    return res.status(200).send({ message: 'WhatsApp job reset to pending successfully', data: await WaGroupJob.findByPk(id) });
  } catch (err) {
    req.log.error(`Failed to retry WhatsApp job ${id}:`, err.message);
    return res.status(500).send({ message: 'Error retrying WhatsApp job' });
  }
};

/** Put every failed job back in the queue. */
export const retryAllJobs = async (req, res) => {
  try {
    const [retriedCount] = await WaGroupJob.update({ status: 'pending', attempts: 0, error: null }, { where: { status: 'failed' } });
    req.log.info('whatsapp_jobs_retry_all_queued', { count: retriedCount });
    return res.status(200).send({ message: `Successfully queued ${retriedCount} failed jobs for retry`, data: { retriedCount } });
  } catch (err) {
    req.log.error('Failed to retry all WhatsApp jobs:', err.message);
    return res.status(500).send({ message: 'Error retrying all WhatsApp jobs' });
  }
};

/** Change the planned time of a pending or failed job. Never touches a job that is running. */
export const rescheduleJob = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).send({ message: 'Invalid job id' });
  const { scheduledAt } = req.body || {};
  if (!scheduledAt) return res.status(400).send({ message: 'scheduledAt is required' });
  const when = new Date(scheduledAt);
  if (Number.isNaN(when.getTime())) return res.status(400).send({ message: 'scheduledAt is not a valid date' });
  try {
    const [count] = await WaGroupJob.update(
      { scheduledAt: when, status: 'pending', attempts: 0, error: null },
      { where: { id, status: { [Op.in]: ['pending', 'failed'] } } }
    );
    if (!count) {
      const exists = await WaGroupJob.findByPk(id, { attributes: ['id'] });
      return exists
        ? res.status(409).send({ message: 'Only a pending or failed job can be rescheduled' })
        : res.status(404).send({ message: 'WhatsApp job not found' });
    }
    req.log.info('whatsapp_job_rescheduled', { jobId: id, scheduledAt: when.toISOString() });
    return res.status(200).send({ message: 'WhatsApp job rescheduled successfully', data: await WaGroupJob.findByPk(id) });
  } catch (err) {
    req.log.error(`Failed to reschedule WhatsApp job ${id}:`, err.message);
    return res.status(500).send({ message: 'Error rescheduling WhatsApp job' });
  }
};

/** Cancel a job that has not started. */
export const cancelJob = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).send({ message: 'Invalid job id' });
  try {
    const count = await WaGroupJob.destroy({ where: { id, status: 'pending' } });
    if (!count) {
      const exists = await WaGroupJob.findByPk(id, { attributes: ['id'] });
      return exists
        ? res.status(409).send({ message: 'Only a pending job can be cancelled' })
        : res.status(404).send({ message: 'WhatsApp job not found' });
    }
    req.log.info('whatsapp_job_cancelled', { jobId: id });
    return res.status(200).send({ message: 'WhatsApp job cancelled successfully' });
  } catch (err) {
    req.log.error(`Failed to cancel WhatsApp job ${id}:`, err.message);
    return res.status(500).send({ message: 'Error cancelling WhatsApp job' });
  }
};

export const getTemplates = async (req, res) => {
  try {
    const data = await WaTemplate.findAll({ order: [['name', 'ASC']] });
    return res.status(200).send({ message: 'Fetched WhatsApp templates successfully', data });
  } catch (err) {
    req.log.error('Failed to fetch WhatsApp templates:', err.message);
    return res.status(500).send({ message: 'Error fetching WhatsApp templates' });
  }
};

export const createTemplate = async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!name || !text) return res.status(400).send({ message: 'name and text are required' });
  if (name.length > 255) return res.status(400).send({ message: 'name is longer than 255 characters' });
  if (text.length > MAX_TEXT_LENGTH) return res.status(400).send({ message: `text is longer than ${MAX_TEXT_LENGTH} characters` });
  try {
    const template = await WaTemplate.create({ name, text });
    req.log.info('whatsapp_template_created', { templateId: template.id });
    return res.status(200).send({ message: 'WhatsApp template saved successfully', data: template });
  } catch (err) {
    req.log.error('Failed to create WhatsApp template:', err.stack || err.message);
    return res.status(500).send({ message: 'Error saving WhatsApp template' });
  }
};

export const deleteTemplate = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).send({ message: 'Invalid template id' });
  try {
    const count = await WaTemplate.destroy({ where: { id } });
    if (!count) return res.status(404).send({ message: 'WhatsApp template not found' });
    req.log.info('whatsapp_template_deleted', { templateId: id });
    return res.status(200).send({ message: 'WhatsApp template deleted successfully' });
  } catch (err) {
    req.log.error(`Failed to delete WhatsApp template ${id}:`, err.message);
    return res.status(500).send({ message: 'Error deleting WhatsApp template' });
  }
};
