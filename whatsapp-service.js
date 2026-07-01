import './config/environment.js';
import makeWASocket, { DisconnectReason, BufferJSON } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import pino from 'pino';
import database from './config/database.js';
import { WaGroupJob, UtsavDb, ShibirDb } from './models/associations.js';
import { useDatabaseAuthState } from './helpers/waDbAuth.helper.js';
import qrcodeTerminal from 'qrcode-terminal';
import { Op } from 'sequelize';
import moment from 'moment-timezone';
import cron from 'node-cron';

const STATUS_FILE = path.join(process.cwd(), 'whatsapp_status.json');

// Write connection status to a JSON file so Express API instances can read it
function updateStatus(status, qr = null) {
  try {
    const data = {
      status,
      qr,
      updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Failed to write WhatsApp status file:', err.message);
  }
}

let isConnOpen = false;
let isQueueRunning = false;
let activeSocket = null;
let disconnectTimer = null;
let isAlertSent = false;

async function processQueue(sock) {
  if (!isConnOpen) {
    isQueueRunning = false;
    return;
  }

  let job = null;
  try {
    // 1. Fetch one pending job (respect scheduled time if defined) sorted by priority
    job = await WaGroupJob.findOne({
      where: {
        status: 'pending',
        [Op.or]: [
          { scheduledAt: null },
          { scheduledAt: { [Op.lte]: new Date() } }
        ]
      },
      order: [
        ['priority', 'ASC'],
        ['createdAt', 'ASC']
      ]
    });

    if (!job) {
      // No jobs, sleep 5 seconds and check again
      setTimeout(() => processQueue(sock), 5000);
      return;
    }

    // 2. Mark job as processing
    await job.update({ status: 'processing', attempts: job.attempts + 1 });
    console.log(`[WA Queue] Processing job ${job.id}: ${job.action}`);

    if (job.action === 'create_group') {
      const { name, type, eventId } = job.payload || {};
      if (!name || !type || !eventId) {
        throw new Error('Invalid payload for create_group action');
      }

      console.log(`[WA Queue] Creating group: "${name}"`);
      try {
        // Create empty group
        const group = await sock.groupCreate(name, []);
        const groupJid = group.id;

        // Restrict message sending to admins only (announcement mode)
        await sock.groupSettingUpdate(groupJid, 'announcement');

        // Update database model with the new group JID
        if (type === 'utsav') {
          await UtsavDb.update({ whatsapp_group_jid: groupJid }, { where: { id: eventId } });
        } else if (type === 'shibir') {
          await ShibirDb.update({ whatsapp_group_jid: groupJid }, { where: { id: eventId } });
        }

        await job.update({ status: 'success', groupJid });
        console.log(`[WA Queue] Group created successfully: "${name}" -> JID: ${groupJid}`);
      } catch (createErr) {
        console.error(`[WA Queue] Failed to create group:`, createErr.message);
        if (createErr.message && (createErr.message.includes('bad-request') || createErr.message.includes('400'))) {
          await job.update({ status: 'failed', error: `WhatsApp rejected creation: ${createErr.message}` });
          console.log(`[WA Queue] Job marked as failed due to rejection (non-retryable).`);
        } else {
          throw createErr;
        }
      }

    } else if (job.action === 'add_member') {
      const { phone, groupJid } = job;
      if (!phone || !groupJid) {
        throw new Error('Missing phone or groupJid for add_member action');
      }

      const participantJid = `${phone}@s.whatsapp.net`;
      console.log(`[WA Queue] Adding ${phone} to group ${groupJid}`);

      try {
        const response = await sock.groupParticipantsUpdate(groupJid, [participantJid], 'add');
        const result = response[0] || {};

        // Check if user was restricted by privacy settings (status code 403)
        if (result.status === '403') {
          console.log(`[WA Queue] User ${phone} has privacy restrictions. DMing invite link.`);
          const code = await sock.groupInviteCode(groupJid);
          const inviteLink = `https://chat.whatsapp.com/${code}`;
          
          await sock.sendMessage(participantJid, {
            text: `Pranam! We tried adding you to the official WhatsApp group for the event, but were unable to due to your WhatsApp privacy settings. Please join the group manually using this invite link:\n\n${inviteLink}`
          });
        } else if (result.status && result.status !== '200') {
          throw new Error(`Failed to add participant (status code: ${result.status})`);
        }

        await job.update({ status: 'success' });
        console.log(`[WA Queue] Added ${phone} to group successfully.`);
      } catch (addErr) {
        console.error(`[WA Queue] Failed to add participant ${phone}:`, addErr.message);
        if (addErr.message && (addErr.message.includes('bad-request') || addErr.message.includes('400') || addErr.message.includes('not-authorized'))) {
          await job.update({ status: 'failed', error: `WhatsApp rejected addition: ${addErr.message}` });
          console.log(`[WA Queue] Job marked as failed due to rejection (non-retryable).`);
        } else {
          throw addErr;
        }
      }

    } else if (job.action === 'remove_member') {
      const { phone, groupJid } = job;
      if (!phone || !groupJid) {
        throw new Error('Missing phone or groupJid for remove_member action');
      }

      const participantJid = `${phone}@s.whatsapp.net`;
      console.log(`[WA Queue] Removing ${phone} from group ${groupJid}`);

      try {
        await sock.groupParticipantsUpdate(groupJid, [participantJid], 'remove');
        await job.update({ status: 'success' });
        console.log(`[WA Queue] Removed ${phone} from group successfully.`);
      } catch (removeErr) {
        console.error(`[WA Queue] Failed to remove participant ${phone}:`, removeErr.message);
        if (removeErr.message && (removeErr.message.includes('bad-request') || removeErr.message.includes('400') || removeErr.message.includes('not-authorized'))) {
          await job.update({ status: 'failed', error: `WhatsApp rejected removal: ${removeErr.message}` });
          console.log(`[WA Queue] Job marked as failed due to rejection (non-retryable).`);
        } else {
          throw removeErr;
        }
      }
    } else if (job.action === 'send_message') {
      const { groupJid, text, mediaUrl, mediaType, filename, mimetype } = job.payload || {};
      if (!groupJid || (text === undefined && !mediaUrl)) {
        throw new Error('Missing groupJid or message content for send_message action');
      }

      let textToSend = text || '';

      // Resolve Merge Tags
      if (textToSend.includes('{{') && textToSend.includes('}}')) {
        console.log(`[WA Queue] Resolving merge tags for JID ${groupJid}`);
        const cleanJid = groupJid.split('@')[0].trim();
        
        let event = await UtsavDb.findOne({
          where: {
            whatsapp_group_jid: {
              [Op.like]: `%${cleanJid}%`
            }
          }
        });
        let isUtsav = true;
        if (!event) {
          event = await ShibirDb.findOne({
            where: {
              whatsapp_group_jid: {
                [Op.like]: `%${cleanJid}%`
              }
            }
          });
          isUtsav = false;
        }

        if (event) {
          textToSend = textToSend.replace(/\{\{event_name\}\}/g, event.name || '');

          const dateStr = event.start_date ? moment(event.start_date).format('DD MMM YYYY') : '';
          textToSend = textToSend.replace(/\{\{start_date\}\}/g, dateStr);

          const venueStr = event.location || 'Research Centre';
          textToSend = textToSend.replace(/\{\{venue\}\}/g, venueStr);

          if (textToSend.includes('{{group_link}}')) {
            try {
              const code = await sock.groupInviteCode(groupJid);
              textToSend = textToSend.replace(/\{\{group_link\}\}/g, `https://chat.whatsapp.com/${code}`);
            } catch (linkErr) {
              console.error(`[WA Queue] Link tag resolve failed:`, linkErr.message);
              textToSend = textToSend.replace(/\{\{group_link\}\}/g, '');
            }
          }
        }
      }

      // Check if we need to send media or plain text
      let sentMsg = null;
      if (mediaUrl) {
        const absolutePath = path.join(process.cwd(), mediaUrl.replace(/^\//, ''));
        console.log(`[WA Queue] Sending media broadcast of type ${mediaType} to group ${groupJid}`);
        
        if (!fs.existsSync(absolutePath)) {
          console.error(`[WA Queue] Media file not found at path: ${absolutePath}`);
          throw new Error(`Media file not found at path: ${absolutePath}`);
        }
        
        const mediaBuffer = fs.readFileSync(absolutePath);
        if (mediaType === 'image') {
          sentMsg = await sock.sendMessage(groupJid, {
            image: mediaBuffer,
            caption: textToSend
          });
        } else {
          sentMsg = await sock.sendMessage(groupJid, {
            document: mediaBuffer,
            mimetype: mimetype || 'application/octet-stream',
            fileName: filename || 'attachment',
            caption: textToSend
          });
        }
      } else {
        console.log(`[WA Queue] Sending message to group ${groupJid}`);
        sentMsg = await sock.sendMessage(groupJid, { text: textToSend });
      }
      
      const sentMsgId = sentMsg?.key?.id || null;
      await job.update({ status: 'success', msgId: sentMsgId });
      console.log(`[WA Queue] Message sent successfully. Saved msgId: ${sentMsgId}`);

    } else if (job.action === 'send_poll') {
      const { groupJid } = job;
      const { name, options } = job.payload || {};
      if (!groupJid || !name || !options) {
        throw new Error('Missing groupJid, name or options for send_poll action');
      }

      console.log(`[WA Queue] Sending poll to group ${groupJid}: "${name}"`);
      const sentPoll = await sock.sendMessage(groupJid, {
        poll: {
          name,
          values: options,
          selectableCount: 1
        }
      });
      const sentMsgId = sentPoll?.key?.id || null;
      await job.update({ status: 'success', msgId: sentMsgId });
      console.log(`[WA Queue] Poll sent successfully. Saved msgId: ${sentMsgId}`);
    } else if (job.action === 'fetch_members') {
      const { groupJid } = job;
      if (!groupJid) {
        throw new Error('Missing groupJid for fetch_members action');
      }

      console.log(`[WA Queue] Fetching group participants for JID: ${groupJid}`);
      try {
        const metadata = await sock.groupMetadata(groupJid);
        const participants = (metadata.participants || []).map(p => p.id);

        await job.update({
          status: 'success',
          payload: { participants }
        });
        console.log(`[WA Queue] Fetched ${participants.length} JIDs successfully.`);
      } catch (fetchErr) {
        console.error(`[WA Queue] Failed to fetch group metadata:`, fetchErr.message);
        await job.update({ status: 'failed', error: `WhatsApp API fetch error: ${fetchErr.message}` });
      }
    } else if (job.action === 'update_group_settings') {
      const { groupJid, announcement, name, description } = job.payload || {};
      if (!groupJid) {
        throw new Error('Missing groupJid for update_group_settings action');
      }

      console.log(`[WA Queue] Updating settings for group JID ${groupJid}`);
      
      if (announcement !== undefined) {
        await sock.groupSettingUpdate(groupJid, announcement ? 'announcement' : 'not_announcement');
        console.log(`[WA Queue] Set posting restriction to announcement=${announcement}`);
      }
      
      if (name) {
        await sock.groupUpdateSubject(groupJid, name);
        console.log(`[WA Queue] Set group subject to "${name}"`);
      }
      
      if (description) {
        await sock.groupUpdateDescription(groupJid, description);
        console.log(`[WA Queue] Set group description to "${description}"`);
      }
      
      await job.update({ status: 'success' });
      console.log(`[WA Queue] Group settings updated successfully.`);
    }

    // Process next job with randomized jitter for broadcasts (rate limiting)
    let delay = 1000;
    if (job && (job.action === 'send_message' || job.action === 'send_poll')) {
      delay = 2000 + Math.floor(Math.random() * 3000); // 2000ms to 5000ms
      console.log(`[WA Queue] Broadcast delay applied: ${delay}ms`);
    }
    setTimeout(() => processQueue(sock), delay);

  } catch (err) {
    console.error(`[WA Queue] Error processing job ${job ? job.id : 'unknown'}:`, err);
    if (job) {
      const attempts = job.attempts;
      if (attempts < 3) {
        await job.update({ status: 'pending', error: err.message });
      } else {
        await job.update({ status: 'failed', error: err.message });
      }
    }
    // Sleep longer on error (10 seconds)
    setTimeout(() => processQueue(sock), 10000);
  }
}

async function connectToWhatsApp() {
  console.log('[WA Service] Initializing connection state...');
  const { state, saveCreds } = await useDatabaseAuthState('whatsapp_default');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'warn' }),
    printQRInTerminal: true
  });

  activeSocket = sock;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        console.log('[WA Service] New QR code generated. Generate Base64 image...');
        const qrDataUrl = await QRCode.toDataURL(qr);
        updateStatus('qr_ready', qrDataUrl);
        
        // Print the QR code in the terminal (since Baileys deprecated auto-printing)
        qrcodeTerminal.generate(qr, { small: true });
      } catch (qrErr) {
        console.error('Failed to generate QR Data URL:', qrErr);
      }
    }

    if (connection === 'close') {
      isConnOpen = false;
      isQueueRunning = false;
      activeSocket = null;

      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output.statusCode
        : null;

      const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

      console.log(`[WA Service] Connection closed. Status Code: ${statusCode}, Logged Out: ${isLoggedOut}`);
      updateStatus('disconnected', null);

      // Start alert timer if not already running
      if (!disconnectTimer && !isAlertSent) {
        disconnectTimer = setTimeout(async () => {
          try {
            console.log('[WA Service] Service has been disconnected for 5 minutes. Sending alerts...');
            const { default: sendMail } = await import('./utils/sendMail.js');
            const { sendWhatsAppMessage } = await import('./utils/sendWhatsAppMessage.js');
            
            const alertEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_EMAIL || 'admin@example.com';
            await sendMail({
              email: alertEmail,
              subject: '🚨 Aashray WhatsApp Service Offline Alert',
              html: `
                <h3>Aashray WhatsApp Automation Offline</h3>
                <p>The WhatsApp automation service has been offline for more than 5 minutes.</p>
                <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Disconnect Reason:</strong> Code ${statusCode} (${isLoggedOut ? 'Logged Out' : 'Disconnected/Lost Connection'})</p>
                <p>Please log in to the admin dashboard and scan the QR code to re-link your device if necessary.</p>
              `
            });

            // Send WhatsApp Alert to 918274856695 using template fallback
            const components = [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'Aashray WA Service' },
                  { type: 'text', text: 'Offline Alert' },
                  { type: 'text', text: `disconnected (offline >5 mins, code ${statusCode || 'unknown'})` }
                ]
              }
            ];
            await sendWhatsAppMessage('918274856695', 'admin_status_updated', components);
            isAlertSent = true;
          } catch (alertErr) {
            console.error('[WA Service] Failed to send disconnect alerts:', alertErr.message);
          }
        }, 5 * 60 * 1000); // 5 minutes
      }

      if (isLoggedOut) {
        console.log('[WA Service] Session was logged out or invalidated. Deleting credentials from DB to start fresh...');
        try {
          const { WaSession } = await import('./models/associations.js');
          await WaSession.destroy({ where: { id: 'whatsapp_default' } });
          console.log('[WA Service] Credentials deleted. Reconnecting to generate a new QR code...');
        } catch (dbErr) {
          console.error('[WA Service] Failed to delete session from DB:', dbErr.message);
        }
      }

      // Reconnect in all cases: if logged out, it will now start fresh and generate a new QR code.
      setTimeout(connectToWhatsApp, 5000);
    } else if (connection === 'connecting') {
      updateStatus('connecting', null);
    } else if (connection === 'open') {
      isConnOpen = true;
      updateStatus('connected', null);
      console.log('[WA Service] Connection established successfully! 🚀');

      // Clear disconnect alert timer and reset flag
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      if (isAlertSent) {
        // Send a recovery alert
        try {
          console.log('[WA Service] Service reconnected. Sending recovery alerts...');
          const { default: sendMail } = await import('./utils/sendMail.js');
          const { sendWhatsAppMessage } = await import('./utils/sendWhatsAppMessage.js');
          
          const alertEmail = process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_EMAIL || 'admin@example.com';
          await sendMail({
            email: alertEmail,
            subject: '✅ Aashray WhatsApp Service Reconnected',
            html: `
              <h3>Aashray WhatsApp Automation Reconnected</h3>
              <p>The WhatsApp automation service is back online and has successfully re-established its connection.</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
            `
          });

          const components = [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'Aashray WA Service' },
                { type: 'text', text: 'Online Status' },
                { type: 'text', text: 'reconnected successfully (back online)' }
              ]
            }
          ];
          await sendWhatsAppMessage('918274856695', 'admin_status_updated', components);
        } catch (alertErr) {
          console.error('[WA Service] Failed to send recovery alerts:', alertErr.message);
        }
        isAlertSent = false;
      }

      if (!isQueueRunning) {
        isQueueRunning = true;
        processQueue(sock);
      }
    }
  });

  sock.ev.on('message-receipt.update', async (receipts) => {
    try {
      for (const r of receipts) {
        const { key, receipt } = r;
        const msgId = key.id;
        
        const job = await WaGroupJob.findOne({ where: { msgId } });
        if (!job) continue;
        
        let currentReceipts = job.receipts || {};
        const participantJid = key.participant || key.remoteJid;
        
        let newStatus = 'delivered';
        if (receipt.readAt || receipt.status === 3 || receipt.status === 'read') {
          newStatus = 'read';
        }
        
        if (currentReceipts[participantJid] === 'read') {
          continue;
        }
        
        currentReceipts[participantJid] = newStatus;
        
        let deliveredCount = 0;
        let readCount = 0;
        for (const jid in currentReceipts) {
          const status = currentReceipts[jid];
          if (status === 'read') {
            readCount++;
            deliveredCount++;
          } else if (status === 'delivered') {
            deliveredCount++;
          }
        }
        
        await job.update({
          receipts: currentReceipts,
          deliveredCount,
          readCount
        });
      }
    } catch (receiptErr) {
      console.error('[WA Service] Receipt update handler failed:', receiptErr.message);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

// Schedule daily media cleanup at midnight (00:00)
cron.schedule('0 0 * * *', () => {
  console.log('[WA Service] Starting daily media cleanup...');
  try {
    const uploadDir = path.join(process.cwd(), 'public/uploads/whatsapp');
    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      const now = Date.now();
      const expirationTime = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      let deletedCount = 0;
      for (const file of files) {
        const filePath = path.join(uploadDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > expirationTime) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      console.log(`[WA Service] Media cleanup finished. Deleted ${deletedCount} files.`);
    }
  } catch (err) {
    console.error('[WA Service] Media cleanup failed:', err.message);
  }
});

// Graceful shutdown handling
const handleShutdown = async (signal) => {
  console.log(`[WA Service] Received ${signal}. Starting shutdown...`);
  isConnOpen = false;
  isQueueRunning = false;
  if (activeSocket) {
    try {
      activeSocket.end();
    } catch (e) {}
  }
  process.exit(0);
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

// Main entry point
(async () => {
  try {
    await database.authenticate();
    console.log('[WA Service] Database connected successfully.');
    await connectToWhatsApp();
  } catch (error) {
    console.error('[WA Service] Initialization failed:', error);
    process.exit(1);
  }
})();
