import { Op } from 'sequelize';
import SatshrutSession from '../../models/satshrut_sessions.model.js';
import SatshrutConfig from '../../models/satshrut_config.model.js';
import UtsavDb from '../../models/utsav_db.model.js';
import ApiError from '../../utils/ApiError.js';
import { STATUS_ACTIVE, STATUS_INACTIVE } from '../../config/constants.js';

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Extracts YouTube video ID from a full URL or returns a bare ID as-is.
 * Supports: youtu.be/ID, youtube.com/watch?v=ID, youtube.com/embed/ID
 */
const extractYouTubeId = (input) => {
  if (!input) return null;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|live|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i
  );
  return match ? match[1] : null;
};

/**
 * Parses HH:MM:SS or MM:SS string to total seconds.
 */
const parseTimestamp = (hms) => {
  if (!hms) return 0;
  const parts = String(hms).split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  const num = parseInt(hms);
  return isNaN(num) ? 0 : num;
};

/**
 * Converts total seconds back to HH:MM:SS for display.
 */
const secondsToHMS = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

/**
 * Add / subtract days to a YYYY-MM-DD string.
 */
const addDays = (dateStr, days) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
};

/**
 * Check if a date is a no-session day (Mon/Thu or Utsav).
 */
const isNoSessionDate = (dateStr, noSessionDays, utsavs) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  const jsDay = d.getUTCDay();
  if (noSessionDays.includes(jsDay)) return true;
  for (const u of utsavs) {
    if (dateStr >= u.start_date && dateStr <= u.end_date) return true;
  }
  return false;
};

/**
 * Get next valid session date skipping Mon, Thu, and Utsavs.
 */
const getNextValidSessionDate = (startDateStr, noSessionDays, utsavs) => {
  let curr = startDateStr;
  while (true) {
    curr = addDays(curr, 1);
    if (!isNoSessionDate(curr, noSessionDays, utsavs)) {
      return curr;
    }
  }
};

/**
 * Get previous valid session date skipping Mon, Thu, and Utsavs.
 */
const getPrevValidSessionDate = (startDateStr, noSessionDays, utsavs) => {
  let curr = startDateStr;
  while (true) {
    curr = addDays(curr, -1);
    if (!isNoSessionDate(curr, noSessionDays, utsavs)) {
      return curr;
    }
  }
};

/**
 * Returns existing config row or seeds a default singleton row.
 */
const getOrCreateConfig = async () => {
  let config = await SatshrutConfig.findOne({ where: { id: 1 } });
  if (!config) {
    config = await SatshrutConfig.create({
      id: 1,
      default_audio1_youtube_id: null,
      default_audio2_youtube_id: null,
      no_session_days: [1, 4]
    });
  }
  return config;
};

// ─── Session CRUD ──────────────────────────────────────────────────────────────

/**
 * POST /api/v1/admin/satshrut/session
 * Create a single session for a specific date.
 */
export const createSession = async (req, res) => {
  const {
    session_date, status,
    youtube_url, start_time, end_time,
    youtube2_url, start2_time, end2_time,
    notes, notes2, audio1_youtube_url, audio2_youtube_url
  } = req.body;

  if (status === STATUS_INACTIVE) {
    if (!session_date) throw new ApiError(400, 'session_date is required');
    const existing = await SatshrutSession.findOne({ where: { session_date } });
    if (existing) {
      await existing.update({ status: STATUS_INACTIVE, notes: notes || null });
      return res.status(200).json({ success: true, data: existing, message: 'Marked as no-session day' });
    }
    const session = await SatshrutSession.create({
      session_date,
      youtube_video_id: 'none',
      youtube_url: null,
      video_start_seconds: 0,
      video_end_seconds: 1,
      notes: notes || null,
      status: STATUS_INACTIVE,
      created_by: req.user?.id || null
    });
    return res.status(201).json({ success: true, data: session, message: 'Marked as no-session day' });
  }

  if (!session_date || !youtube_url || !start_time || !end_time) {
    throw new ApiError(400, 'session_date, youtube_url, start_time, and end_time are required');
  }

  const youtube_video_id = extractYouTubeId(youtube_url);
  if (!youtube_video_id) throw new ApiError(400, 'Invalid YouTube Video 1 URL or ID');

  const video_start_seconds = parseTimestamp(start_time);
  const video_end_seconds = parseTimestamp(end_time);

  if (video_end_seconds <= 0 || video_end_seconds <= video_start_seconds) {
    throw new ApiError(400, 'Video 1 end_time must be greater than 00:00:00 and after start_time');
  }

  // Optional Video 2 segment
  let youtube2_video_id = null;
  let video2_start_seconds = null;
  let video2_end_seconds = null;

  if (youtube2_url && start2_time && end2_time) {
    youtube2_video_id = extractYouTubeId(youtube2_url);
    if (!youtube2_video_id) throw new ApiError(400, 'Invalid YouTube Video 2 URL');
    video2_start_seconds = parseTimestamp(start2_time);
    video2_end_seconds = parseTimestamp(end2_time);
    if (video2_end_seconds <= video2_start_seconds) {
      throw new ApiError(400, 'Video 2 end_time must be after start_time');
    }
  }

  // Optional per-session audio overrides
  let audio1_youtube_id = null;
  if (audio1_youtube_url) {
    audio1_youtube_id = extractYouTubeId(audio1_youtube_url);
    if (!audio1_youtube_id) throw new ApiError(400, 'Invalid Audio 1 YouTube URL');
  }

  let audio2_youtube_id = null;
  if (audio2_youtube_url) {
    audio2_youtube_id = extractYouTubeId(audio2_youtube_url);
    if (!audio2_youtube_id) throw new ApiError(400, 'Invalid Audio 2 YouTube URL');
  }

  // Check for duplicate date
  const existing = await SatshrutSession.findOne({ where: { session_date } });
  if (existing) throw new ApiError(400, `A session already exists for ${session_date}`);

  // Warn if this is a no-session day
  const config = await getOrCreateConfig();
  const noSessionDays = config.no_session_days || [1, 4];
  const dayOfWeek = new Date(`${session_date}T12:00:00Z`).getDay();
  const isNoSessionDay = noSessionDays.includes(dayOfWeek);

  const session = await SatshrutSession.create({
    session_date,
    youtube_video_id,
    youtube_url: youtube_url.trim(),
    video_start_seconds,
    video_end_seconds,
    youtube2_video_id,
    youtube2_url: youtube2_url ? youtube2_url.trim() : null,
    video2_start_seconds,
    video2_end_seconds,
    audio1_youtube_id,
    audio1_youtube_url: audio1_youtube_url ? audio1_youtube_url.trim() : null,
    audio2_youtube_id,
    audio2_youtube_url: audio2_youtube_url ? audio2_youtube_url.trim() : null,
    notes: notes || null,
    notes2: notes2 || null,
    status: STATUS_ACTIVE,
    created_by: req.user?.id || null
  });

  return res.status(201).json({
    success: true,
    data: session,
    warning: isNoSessionDay
      ? 'Warning: This date falls on a no-session day (Monday or Thursday).'
      : null
  });
};

/**
 * POST /api/v1/admin/satshrut/session/bulk
 * Bulk create sessions from a parsed CSV payload.
 * Body: { sessions: [{ session_date, youtube_url, start_time, end_time, notes }] }
 */
export const bulkCreateSessions = async (req, res) => {
  const { sessions } = req.body;

  if (!Array.isArray(sessions) || sessions.length === 0) {
    throw new ApiError(400, 'sessions array is required and must not be empty');
  }

  const config = await getOrCreateConfig();
  const noSessionDays = config.no_session_days || [1, 4];

  const results = { created: [], skipped: [], errors: [] };

  for (const row of sessions) {
    const {
      session_date, youtube_url, start_time, end_time, notes,
      youtube2_url, start2_time, end2_time, notes2
    } = row;

    try {
      if (!session_date || !youtube_url || !start_time || !end_time) {
        results.errors.push({ session_date: session_date || '?', reason: 'Missing required fields for Video 1' });
        continue;
      }

      const youtube_video_id = extractYouTubeId(youtube_url);
      if (!youtube_video_id) {
        results.errors.push({ session_date, reason: 'Invalid Video 1 YouTube URL' });
        continue;
      }

      const video_start_seconds = parseTimestamp(start_time);
      const video_end_seconds = parseTimestamp(end_time);

      if (video_end_seconds <= 0 || video_end_seconds <= video_start_seconds) {
        results.errors.push({ session_date, reason: 'Video 1 end_time must be > 0 and after start_time' });
        continue;
      }

      // Optional Video 2 segment processing
      let youtube2_video_id = null;
      let video2_start_seconds = null;
      let video2_end_seconds = null;

      if (youtube2_url) {
        if (!start2_time || !end2_time) {
          results.errors.push({ session_date, reason: 'Video 2 start2_time and end2_time are required when youtube2_url is provided' });
          continue;
        }
        youtube2_video_id = extractYouTubeId(youtube2_url);
        if (!youtube2_video_id) {
          results.errors.push({ session_date, reason: 'Invalid Video 2 YouTube URL' });
          continue;
        }
        video2_start_seconds = parseTimestamp(start2_time);
        video2_end_seconds = parseTimestamp(end2_time);
        if (video2_end_seconds <= 0 || video2_end_seconds <= video2_start_seconds) {
          results.errors.push({ session_date, reason: 'Video 2 end_time must be greater than 00:00:00 and after start2_time' });
          continue;
        }
      }

      // Skip no-session days
      const dayOfWeek = new Date(`${session_date}T12:00:00Z`).getDay();
      if (noSessionDays.includes(dayOfWeek)) {
        results.skipped.push({ session_date, reason: 'No-session day (Monday/Thursday)' });
        continue;
      }

      // Skip duplicate dates
      const existing = await SatshrutSession.findOne({ where: { session_date } });
      if (existing) {
        results.skipped.push({ session_date, reason: 'Session already exists for this date' });
        continue;
      }

      await SatshrutSession.create({
        session_date,
        youtube_video_id,
        youtube_url: youtube_url.trim(),
        video_start_seconds,
        video_end_seconds,
        youtube2_video_id,
        youtube2_url: youtube2_url ? youtube2_url.trim() : null,
        video2_start_seconds,
        video2_end_seconds,
        notes: notes || null,
        notes2: notes2 || null,
        status: STATUS_ACTIVE,
        created_by: req.user?.id || null
      });

      results.created.push({ session_date });
    } catch (err) {
      results.errors.push({ session_date: session_date || '?', reason: err.message });
    }
  }

  return res.status(201).json({
    success: true,
    data: results,
    message: `Created: ${results.created.length} | Skipped: ${results.skipped.length} | Errors: ${results.errors.length}`
  });
};

/**
 * GET /api/v1/admin/satshrut/sessions
 * List sessions. Optional query params: month (1-12), year (YYYY)
 */
export const listSessions = async (req, res) => {
  const { month, year } = req.query;

  const where = {};

  if (month && year) {
    const m = parseInt(month);
    const y = parseInt(year);
    const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
    // Last day of month
    const lastDay = new Date(y, m, 0).getDate();
    const endDate = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    where.session_date = { [Op.between]: [startDate, endDate] };
  }

  const sessions = await SatshrutSession.findAll({
    where,
    order: [['session_date', 'ASC']]
  });

  // Fetch Utsavs for calendar display
  const utsavs = await UtsavDb.findAll({
    attributes: ['id', 'name', 'start_date', 'end_date', 'status'],
    order: [['start_date', 'ASC']]
  }).catch(() => []);

  // Enrich with human-readable timestamps for frontend display
  const enriched = sessions.map((s) => {
    const v1Dur = Math.max(0, (s.video_end_seconds || 0) - (s.video_start_seconds || 0));
    const v2Dur = (s.video2_end_seconds !== null && s.video2_start_seconds !== null && s.video2_end_seconds > s.video2_start_seconds)
      ? (s.video2_end_seconds - s.video2_start_seconds)
      : 0;
    const totalVideoSecs = v1Dur + v2Dur;

    const startDisplay = secondsToHMS(s.video_start_seconds || 0);
    const endDisplay = secondsToHMS(s.video_end_seconds || 0);

    return {
      ...s.toJSON(),
      start_time_display: startDisplay,
      end_time_display: endDisplay,
      start2_time_display: s.video2_start_seconds !== null ? secondsToHMS(s.video2_start_seconds) : null,
      end2_time_display: s.video2_end_seconds !== null ? secondsToHMS(s.video2_end_seconds) : null,
      video1_duration_seconds: v1Dur,
      video2_duration_seconds: v2Dur,
      video_duration_seconds: totalVideoSecs,
      duration_minutes: Math.max(1, Math.round(totalVideoSecs / 60))
    };
  });

  return res.status(200).json({ success: true, data: enriched, utsavs });
};

/**
 * PATCH /api/v1/admin/satshrut/session/:id
 * Update an existing session.
 */
export const updateSession = async (req, res) => {
  const { id } = req.params;
  const {
    youtube_url, start_time, end_time,
    youtube2_url, start2_time, end2_time,
    notes, notes2, status, audio1_youtube_url, audio2_youtube_url
  } = req.body;

  const session = await SatshrutSession.findByPk(id);
  if (!session) throw new ApiError(404, 'Session not found');

  const updateData = {};

  if (youtube_url !== undefined) {
    const youtube_video_id = extractYouTubeId(youtube_url);
    if (!youtube_video_id) throw new ApiError(400, 'Invalid YouTube Video 1 URL');
    updateData.youtube_video_id = youtube_video_id;
    updateData.youtube_url = youtube_url ? youtube_url.trim() : null;
  }

  if (start_time !== undefined) updateData.video_start_seconds = parseTimestamp(start_time);
  if (end_time !== undefined) updateData.video_end_seconds = parseTimestamp(end_time);

  if (youtube2_url !== undefined) {
    if (youtube2_url === null || youtube2_url === '') {
      updateData.youtube2_video_id = null;
      updateData.youtube2_url = null;
      updateData.video2_start_seconds = null;
      updateData.video2_end_seconds = null;
    } else {
      const y2Id = extractYouTubeId(youtube2_url);
      if (!y2Id) throw new ApiError(400, 'Invalid YouTube Video 2 URL');
      updateData.youtube2_video_id = y2Id;
      updateData.youtube2_url = youtube2_url.trim();
    }
  }

  if (start2_time !== undefined) updateData.video2_start_seconds = start2_time ? parseTimestamp(start2_time) : null;
  if (end2_time !== undefined) updateData.video2_end_seconds = end2_time ? parseTimestamp(end2_time) : null;

  if (notes !== undefined) updateData.notes = notes;
  if (notes2 !== undefined) updateData.notes2 = notes2;
  if (status !== undefined) {
    if (![STATUS_ACTIVE, STATUS_INACTIVE].includes(status)) {
      throw new ApiError(400, 'status must be active or inactive');
    }
    updateData.status = status;
  }
  if (audio1_youtube_url !== undefined) {
    if (audio1_youtube_url === null || audio1_youtube_url === '') {
      updateData.audio1_youtube_id = null;
      updateData.audio1_youtube_url = null;
    } else {
      const audioId = extractYouTubeId(audio1_youtube_url);
      if (!audioId) throw new ApiError(400, 'Invalid Audio 1 YouTube URL');
      updateData.audio1_youtube_id = audioId;
      updateData.audio1_youtube_url = audio1_youtube_url.trim();
    }
  }
  if (audio2_youtube_url !== undefined) {
    if (audio2_youtube_url === null || audio2_youtube_url === '') {
      updateData.audio2_youtube_id = null;
      updateData.audio2_youtube_url = null;
    } else {
      const audioId = extractYouTubeId(audio2_youtube_url);
      if (!audioId) throw new ApiError(400, 'Invalid Audio 2 YouTube URL');
      updateData.audio2_youtube_id = audioId;
      updateData.audio2_youtube_url = audio2_youtube_url.trim();
    }
  }

  // Validate timestamps after merge
  const finalStart = updateData.video_start_seconds ?? session.video_start_seconds;
  const finalEnd = updateData.video_end_seconds ?? session.video_end_seconds;
  if (finalEnd <= 0 || finalEnd <= finalStart) {
    throw new ApiError(400, 'Video 1 end_time must be greater than 00:00:00 and after start_time');
  }

  // Validate Video 2 timestamps after merge if Video 2 exists
  const finalY2 = updateData.youtube2_video_id !== undefined ? updateData.youtube2_video_id : session.youtube2_video_id;
  const finalStart2 = updateData.video2_start_seconds !== undefined ? updateData.video2_start_seconds : session.video2_start_seconds;
  const finalEnd2 = updateData.video2_end_seconds !== undefined ? updateData.video2_end_seconds : session.video2_end_seconds;

  if (finalY2) {
    if (finalStart2 === null || finalEnd2 === null) {
      throw new ApiError(400, 'Video 2 start and end times are required when Video 2 is set');
    }
    if (finalEnd2 <= 0 || finalEnd2 <= finalStart2) {
      throw new ApiError(400, 'Video 2 end_time must be greater than 00:00:00 and after start_time');
    }
  }

  await session.update(updateData);

  return res.status(200).json({ success: true, data: session });
};

/**
 * DELETE /api/v1/admin/satshrut/session/:id
 */
export const deleteSession = async (req, res) => {
  const { id } = req.params;

  const session = await SatshrutSession.findByPk(id);
  if (!session) throw new ApiError(404, 'Session not found');

  await session.destroy();

  return res.status(200).json({ success: true, message: 'Session deleted successfully' });
};

// ─── Global Config ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/satshrut/config
 */
export const getConfig = async (req, res) => {
  const config = await getOrCreateConfig();
  return res.status(200).json({
    success: true,
    data: config.toJSON()
  });
};

/**
 * PUT /api/v1/admin/satshrut/config
 */
export const updateConfig = async (req, res) => {
  const { default_audio1_youtube_url, default_audio2_youtube_url, no_session_days, bhakti_videos } = req.body;

  const config = await getOrCreateConfig();

  const updateData = {};

  if (default_audio1_youtube_url !== undefined) {
    if (default_audio1_youtube_url === null || default_audio1_youtube_url === '') {
      updateData.default_audio1_youtube_id = null;
    } else {
      const audioId = extractYouTubeId(default_audio1_youtube_url);
      if (!audioId) throw new ApiError(400, 'Invalid Audio 1 YouTube URL');
      updateData.default_audio1_youtube_id = audioId;
    }
  }

  if (default_audio2_youtube_url !== undefined) {
    if (default_audio2_youtube_url === null || default_audio2_youtube_url === '') {
      updateData.default_audio2_youtube_id = null;
    } else {
      const audioId = extractYouTubeId(default_audio2_youtube_url);
      if (!audioId) throw new ApiError(400, 'Invalid Audio 2 YouTube URL');
      updateData.default_audio2_youtube_id = audioId;
    }
  }

  if (no_session_days !== undefined) {
    if (!Array.isArray(no_session_days)) {
      throw new ApiError(400, 'no_session_days must be an array of day numbers (0=Sun … 6=Sat)');
    }
    updateData.no_session_days = no_session_days;
  }

  if (bhakti_videos !== undefined) {
    if (!Array.isArray(bhakti_videos) || bhakti_videos.length !== 4) {
      throw new ApiError(400, 'bhakti_videos must be an array of exactly 4 video objects');
    }
    const processed = bhakti_videos.map((v, i) => {
      // Allow empty/null slots — admin can clear a week
      if (!v || !v.youtube_url || !v.youtube_url.trim()) {
        return { youtube_id: null, youtube_url: null, start_seconds: 0, end_seconds: 0 };
      }
      const trimmedUrl = v.youtube_url.trim();
      const vid = extractYouTubeId(trimmedUrl);
      if (!vid) throw new ApiError(400, `Bhakti video for Week ${i + 1} has an invalid YouTube URL`);

      const start = parseInt(v.start_seconds) || 0;
      const end = parseInt(v.end_seconds) || 0;

      if (start < 0) {
        throw new ApiError(400, `Bhakti video for Week ${i + 1} start time cannot be negative`);
      }
      if (end < 0) {
        throw new ApiError(400, `Bhakti video for Week ${i + 1} end time cannot be negative`);
      }
      if (end > 0 && end <= start) {
        throw new ApiError(400, `Bhakti video for Week ${i + 1} end time must be greater than start time`);
      }

      return {
        youtube_id: vid,
        youtube_url: trimmedUrl,
        start_seconds: start,
        end_seconds: end
      };
    });
    updateData.bhakti_videos = processed;
  }

  await config.update(updateData);

  return res.status(200).json({ success: true, data: config });
};

// ─── Player Endpoint ───────────────────────────────────────────────────────────

export const getTodaySession = async (req, res) => {
  const dateParam = req.query.date;
  const targetDate = dateParam || new Date().toISOString().split('T')[0];

  // 1. Check for an explicitly scheduled active session first
  const session = await SatshrutSession.findOne({
    where: { session_date: targetDate, status: STATUS_ACTIVE }
  });

  const config = await getOrCreateConfig();

  // 2. If no explicit session is scheduled, check for Monday Bhakti virtual session
  if (!session) {
    const targetD = new Date(targetDate + 'T12:00:00Z');
    const jsDay = targetD.getUTCDay();
    const noSessionDays = config.no_session_days || [1, 4];

    // Only serve virtual Bhakti if Monday (1) is configured as a no-session day
    if (jsDay === 1 && noSessionDays.includes(1)) {
      const bhaktiVideos = config.bhakti_videos;

      if (Array.isArray(bhaktiVideos) && bhaktiVideos.length > 0) {
        // Continuous rolling 4-week cycle across month boundaries (Anchor: 2026-08-03 is Monday, Week 1)
        const BHAKTI_EPOCH_MONDAY_UTC = Date.UTC(2026, 7, 3);
        const weeksDiff = Math.floor((targetD.getTime() - BHAKTI_EPOCH_MONDAY_UTC) / (7 * 24 * 3600 * 1000));
        const videoIndex = ((weeksDiff % 4) + 4) % 4; // 0–3
        const bhaktiVideo = bhaktiVideos[videoIndex];

        if (bhaktiVideo && bhaktiVideo.youtube_id) {
          const vidDur = (bhaktiVideo.end_seconds && bhaktiVideo.start_seconds !== undefined && bhaktiVideo.end_seconds > bhaktiVideo.start_seconds)
            ? (bhaktiVideo.end_seconds - bhaktiVideo.start_seconds)
            : 0;

          return res.status(200).json({
            success: true,
            data: {
              session_date: targetDate,
              session_type: 'bhakti',
              youtube_video_id: bhaktiVideo.youtube_id,
              youtube_url: bhaktiVideo.youtube_url,
              video_start_seconds: bhaktiVideo.start_seconds || 0,
              video_end_seconds: bhaktiVideo.end_seconds || 0,
              video_duration_seconds: vidDur,
              video1_duration_seconds: vidDur,
              video2_duration_seconds: 0,
              notes: `Bhakti — Week ${videoIndex + 1}`,
              week_index: videoIndex + 1
            }
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: null,
      config: config.toJSON(),
      message: 'No session scheduled for this date'
    });
  }

  // Per-session audio overrides global config audio IDs
  const audio1YoutubeId = session.audio1_youtube_id || config.default_audio1_youtube_id;
  const audio2YoutubeId = session.audio2_youtube_id || config.default_audio2_youtube_id;

  const v1Dur = session.video_end_seconds - session.video_start_seconds;
  const v2Dur = (session.video2_end_seconds && session.video2_start_seconds && session.video2_end_seconds > session.video2_start_seconds)
    ? (session.video2_end_seconds - session.video2_start_seconds)
    : 0;

  return res.status(200).json({
    success: true,
    data: {
      ...session.toJSON(),
      // Resolved audio details (merged)
      audio1_youtube_id: audio1YoutubeId,
      audio2_youtube_id: audio2YoutubeId,
      // Convenience display fields
      start_time_display: secondsToHMS(session.video_start_seconds),
      end_time_display: secondsToHMS(session.video_end_seconds),
      start2_time_display: session.video2_start_seconds !== null ? secondsToHMS(session.video2_start_seconds) : null,
      end2_time_display: session.video2_end_seconds !== null ? secondsToHMS(session.video2_end_seconds) : null,
      video1_duration_seconds: v1Dur,
      video2_duration_seconds: v2Dur,
      video_duration_seconds: v1Dur + v2Dur
    }
  });
};

/**
 * POST /api/v1/admin/satshrut/session/move
 * Move or swap a single session from source_date to target_date.
 * Body: { source_date, target_date, mode: 'move' | 'swap' }
 */
export const moveSession = async (req, res) => {
  const { source_date, target_date, mode = 'move', overwrite = false } = req.body;

  if (!source_date || !target_date) {
    throw new ApiError(400, 'source_date and target_date are required');
  }

  if (source_date === target_date) {
    throw new ApiError(400, 'Source and target dates must be different');
  }

  if (!['move', 'swap'].includes(mode)) {
    throw new ApiError(400, "mode must be 'move' or 'swap'");
  }

  const sourceSession = await SatshrutSession.findOne({ where: { session_date: source_date } });
  if (!sourceSession) {
    throw new ApiError(404, `No session found for date ${source_date}`);
  }

  const targetSession = await SatshrutSession.findOne({ where: { session_date: target_date } });

  if (mode === 'move' && targetSession && !overwrite) {
    throw new ApiError(409, `A session already exists on target date ${target_date}. Please confirm overwrite or select Swap mode.`);
  }

  const t = await SatshrutSession.sequelize.transaction();
  try {
    if (mode === 'swap') {
      if (targetSession) {
        // Use a temporary date to prevent unique key collision
        await sourceSession.update({ session_date: '1970-01-01' }, { transaction: t });
        await targetSession.update({ session_date: source_date }, { transaction: t });
        await sourceSession.update({ session_date: target_date }, { transaction: t });
      } else {
        await sourceSession.update({ session_date: target_date }, { transaction: t });
      }
    } else {
      // mode === 'move' (overwrite target if exists, clear source)
      if (targetSession) {
        await targetSession.destroy({ transaction: t });
      }
      await sourceSession.update({ session_date: target_date }, { transaction: t });
    }

    await t.commit();
    return res.status(200).json({
      success: true,
      message: `Session ${mode === 'swap' ? 'swapped' : 'moved'} successfully from ${source_date} to ${target_date}`,
      overwritten: mode === 'move' && Boolean(targetSession)
    });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};

/**
 * POST /api/v1/admin/satshrut/session/shift
 * Shift all scheduled sessions on or after from_date forward or backward by 1 valid session day.
 * Automatically skips Mon, Thu, and Utsavs.
 * Body: { from_date, direction: 'forward' | 'backward' }
 */
export const shiftSessions = async (req, res) => {
  const { from_date, direction = 'forward' } = req.body;

  if (!from_date) {
    throw new ApiError(400, 'from_date is required');
  }

  if (!['forward', 'backward'].includes(direction)) {
    throw new ApiError(400, "direction must be 'forward' or 'backward'");
  }

  // Get all sessions starting on or after from_date
  const sessions = await SatshrutSession.findAll({
    where: {
      session_date: { [Op.gte]: from_date }
    },
    order: [['session_date', 'ASC']]
  });

  if (!sessions.length) {
    return res.status(200).json({
      success: true,
      message: `No sessions found on or after ${from_date} to shift.`,
      shifted_count: 0
    });
  }

  const config = await getOrCreateConfig();
  const noSessionDays = config.no_session_days || [1, 4];
  const utsavs = await UtsavDb.findAll({
    attributes: ['start_date', 'end_date']
  }).catch(() => []);

  // Compute new target dates for each session
  const shiftMap = []; // [{ session, oldDate, newDate }]

  for (const s of sessions) {
    const oldDate = s.session_date;
    const newDate = direction === 'forward'
      ? getNextValidSessionDate(oldDate, noSessionDays, utsavs)
      : getPrevValidSessionDate(oldDate, noSessionDays, utsavs);
    shiftMap.push({ session: s, oldDate, newDate });
  }

  // Check if backward shift collides with an existing session prior to from_date
  if (direction === 'backward') {
    const firstTargetDate = shiftMap[0].newDate;
    const existingCollision = await SatshrutSession.findOne({
      where: {
        session_date: firstTargetDate,
        id: { [Op.notIn]: sessions.map(s => s.id) }
      }
    });
    if (existingCollision) {
      throw new ApiError(400, `Cannot shift backward: Date ${firstTargetDate} already has an existing scheduled session.`);
    }
  }

  // Execute in transaction: first park all in temp dates to prevent unique key conflict, then assign final dates
  const t = await SatshrutSession.sequelize.transaction();
  try {
    // Step 1: Assign temporary placeholder dates (e.g. 1970-01-01, 1970-01-02, ...)
    for (let i = 0; i < shiftMap.length; i++) {
      const tempDate = addDays('1970-01-01', i);
      await shiftMap[i].session.update({ session_date: tempDate }, { transaction: t });
    }

    // Step 2: Assign final calculated target dates
    for (const item of shiftMap) {
      await item.session.update({ session_date: item.newDate }, { transaction: t });
    }

    await t.commit();
    return res.status(200).json({
      success: true,
      message: `Shifted ${shiftMap.length} session(s) ${direction} successfully.`,
      shifted_count: shiftMap.length
    });
  } catch (err) {
    await t.rollback();
    throw err;
  }
};
