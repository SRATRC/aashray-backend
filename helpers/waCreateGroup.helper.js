// The worker's create_group step. If the event already has a group id the job just finishes,
// so a retry or a stuck-job recovery can never make a second WhatsApp group.
export async function runCreateGroupJob(sock, job, { UtsavDb, ShibirDb }) {
  const { name, type, eventId } = job.payload || {};
  if (!name || !type || !eventId) {
    throw new Error('Invalid payload for create_group action');
  }

  const Model = type === 'utsav' ? UtsavDb : type === 'shibir' ? ShibirDb : null;
  if (Model) {
    const event = await Model.findOne({ where: { id: eventId }, attributes: ['id', 'whatsapp_group_jid'] });
    if (event && event.whatsapp_group_jid) {
      await job.update({ status: 'success', groupJid: event.whatsapp_group_jid });
      console.log(`[WA Queue] Event already has group ${event.whatsapp_group_jid}; skipping creation of "${name}".`);
      return;
    }
  }

  console.log(`[WA Queue] Creating group: "${name}"`);
  try {
    // Create empty group
    const group = await sock.groupCreate(name, []);
    const groupJid = group.id;

    // Restrict message sending to admins only (announcement mode)
    await sock.groupSettingUpdate(groupJid, 'announcement');

    // Update database model with the new group JID
    if (Model) {
      await Model.update({ whatsapp_group_jid: groupJid }, { where: { id: eventId } });
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
}
