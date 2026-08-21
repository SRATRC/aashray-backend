/**
 * roomAllocationEngine.js
 * Smart Room & Bed Allocation Engine for Utsav events.
 *
 * Business Rules:
 *  STEP 0 - Exclusions: skip PR/SEVA KUTIR/FLAT res_status, flag missing data
 *  STEP 1 - Fast-Tracks: Flat owners, Flat Host Form guests, International pre/post stays
 *  STEP 2 - Classify: tag isNRI, isSenior, needsGF, isFullPkg, isInsideRC
 *  STEP 3 - Priority Sort: age DESC, isNRI DESC
 *  STEP 4 - 3-Pass Allocation: Strict → Relax Floor → Relax RC
 *  STEP 5 - Bed Assignment: youngest → _FLOOR (if addl_capacity > 0), others → _A, _B, _C
 *  STEP 6 - Turnaround: reclaim vacated beds after split-package mid-event checkout
 */

import database from '../config/database.js';
import { QueryTypes, Op } from 'sequelize';
import {
  RoomDb,
  UtsavRoomConfig,
  FlatDb,
  CustomForm,
  CustomFormResponse,
  RoomBooking
} from '../models/associations.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive property (RC_OAG / RC_NAG) and floor from room number.
 * OAG: 1–36, NAG: 37–60. GF = 0, 1F = 1.
 */
function getRoomMeta(roomNumber) {
  const num = parseInt(roomNumber, 10);
  if (isNaN(num)) return { property: 'EXTERNAL', floor: 0, isInsideRC: false };

  if (num >= 1 && num <= 36) {
    return { property: 'RC_OAG', floor: num <= 18 ? 0 : 1, isInsideRC: true };
  } else if (num >= 37 && num <= 60) {
    return { property: 'RC_NAG', floor: num <= 48 ? 0 : 1, isInsideRC: true };
  }
  return { property: 'EXTERNAL', floor: 0, isInsideRC: false };
}

/**
 * Group roomdb beds by room number, deriving capacity and meta.
 * Returns Map<roomNumber, { capacity, property, floor, gender, roomtype, beds[] }>
 */
async function getRoomDbGrouped() {
  const beds = await RoomDb.findAll({ raw: true });
  const groups = new Map();

  beds.forEach(bed => {
    const match = String(bed.roomno).match(/^(\d+)([A-Z]+)$/);
    if (!match) return;
    const [, num, bedLetter] = match;
    if (!groups.has(num)) {
      const meta = getRoomMeta(num);
      groups.set(num, {
        room_group: num,
        ...meta,
        capacity: 0,
        beds: [],
        gender: bed.gender,
        roomtype: bed.roomtype,
        roomstatus: bed.roomstatus
      });
    }
    groups.get(num).capacity++;
    groups.get(num).beds.push(bedLetter);
  });

  return groups;
}

// ─── Phase 1: Initialize Event Room Inventory ────────────────────────────────

/**
 * Auto-seed utsav_room_config from roomdb for the given utsavid.
 * Only creates rows that don't already exist (safe to re-run).
 * Returns summary of rooms initialized.
 */
export async function initializeEventRooms(utsavid) {
  const roomGroups = await getRoomDbGrouped();
  let created = 0;
  let skipped = 0;

  for (const [, room] of roomGroups) {
    const isBlocked = room.roomstatus === 'blocked' ? 1 : 0;
    const baseCap = room.capacity;
    const availCap = isBlocked ? 0 : baseCap;

    const [, wasCreated] = await UtsavRoomConfig.findOrCreate({
      where: { utsavid, room_group: room.room_group, property: room.property },
      defaults: {
        utsavid,
        room_group: room.room_group,
        property: room.property,
        is_inside_rc: 1,
        floor: room.floor,
        base_capacity: baseCap,
        addl_capacity: 0,
        avail_capacity: availCap,
        is_blocked: isBlocked,
        gender_override: '',
        gender_staying: '',
        alloc_rank: null,
        notes: isBlocked ? 'Blocked in RoomDB' : null
      }
    });

    wasCreated ? created++ : skipped++;
  }

  return { created, skipped, total: roomGroups.size };
}

// ─── Phase 2: Guest Preprocessing ────────────────────────────────────────────

/**
 * International center keywords for NRI detection (fallback if country is null).
 */
const NRI_CENTERS = [
  'usa west coast', 'usa east coast', 'uae', 'u.a.e', 'u.a.e.',
  'dubai', 'canada', 'uk', 'united kingdom', 'singapore', 'kenya',
  'australia', 'new zealand', 'germany', 'france'
];

/**
 * Classify guests with allocation tags.
 * @param {Array} participants - confirmed utsav booking records
 * @param {Object} config - { seniorAge, utsavStartDate, utsavEndDate, fastTracked: Set<cardno> }
 */
export function preprocessGuests(participants, config) {
  const { seniorAge = 65, utsavStartDate, utsavEndDate, fastTrackData = {} } = config;
  const { flatOwnerMap = new Map(), formGuestMap = new Map(), prePostRoomMap = new Map() } = fastTrackData;

  return participants
    .map(p => {
      const cardnoClean = String(p.cardno || '').trim();
      const mobClean = String(p.mobno || '').trim();
      const age = parseInt(p.age, 10) || 0;
      const country = String(p.country || '').trim().toLowerCase();
      const center = String(p.center || '').trim().toLowerCase();
      const resStatus = String(p.res_status || '').trim().toUpperCase();

      const isNRI = country && country !== 'india' && country !== 'ind';
      const isNRIByCenter = !isNRI && NRI_CENTERS.some(c => center.includes(c));
      const effectiveNRI = isNRI || isNRIByCenter;

      const isSenior = age >= seniorAge;
      const needsGF = isSenior; // seniors must get ground floor

      // Full-event package: checkin <= event start AND checkout >= event end
      let isFullPkg = false;
      if (utsavStartDate && utsavEndDate && p.checkin && p.checkout) {
        isFullPkg =
          p.checkin <= utsavStartDate && p.checkout >= utsavEndDate;
      }

      const isInsideRC = effectiveNRI || isSenior || isFullPkg;

      let isFastTracked = false;
      let fastTrackRoom = '';
      let fastTrackTag = '';
      let fastTrackReason = '';

      // 1. Flat Owner in flatdb
      if (flatOwnerMap.has(cardnoClean)) {
        const fno = flatOwnerMap.get(cardnoClean);
        isFastTracked = true;
        fastTrackRoom = 'Flat ' + fno;
        fastTrackTag = 'Flat Owner';
        fastTrackReason = `Flat Owner (Flat ${fno})`;
      }
      // 2. Flat Host Form Guest (co-owner or verified guest from form)
      else if (formGuestMap.has(cardnoClean) || formGuestMap.has(mobClean)) {
        const fno = formGuestMap.get(cardnoClean) || formGuestMap.get(mobClean);
        isFastTracked = true;
        fastTrackRoom = 'Flat ' + fno;
        fastTrackTag = 'Flat Guest';
        fastTrackReason = `Flat Host Form (Flat ${fno})`;
      }
      // 3. International Pre/Post booking
      else if (effectiveNRI && prePostRoomMap.has(cardnoClean)) {
        const prePost = prePostRoomMap.get(cardnoClean);
        isFastTracked = true;
        fastTrackRoom = prePost.roomno;
        fastTrackTag = 'Intl Pre/Post';
        fastTrackReason = `International (${prePost.type}: Room ${prePost.roomno})`;
      }
      // 4. PR / Seva Kutir / Flat resident status
      else if (['PR', 'SEVA KUTIR', 'FLAT'].includes(resStatus)) {
        isFastTracked = true;
        fastTrackRoom = p.roomno && p.roomno !== '-' ? p.roomno : resStatus;
        fastTrackTag = resStatus;
        fastTrackReason = `Resident Status: ${resStatus}`;
      }

      // Data quality flag (only for regular unassigned guests)
      const reviewFlag = !isFastTracked && (!p.age || !p.gender || !p.center);

      return {
        ...p,
        age,
        isNRI: effectiveNRI,
        isSenior,
        needsGF,
        isFullPkg,
        isInsideRC,
        reviewFlag,
        isFastTracked,
        allocated: isFastTracked,
        allottedRoom: isFastTracked ? fastTrackRoom : (p.roomno && p.roomno !== '-' ? p.roomno : null),
        bedLabel: isFastTracked ? fastTrackRoom : null,
        fastTrackTag,
        fastTrackReason,
        unallocated_reason: isFastTracked ? null : null
      };
    })
    .sort((a, b) => {
      // Fast-tracked first, then sort by age DESC, NRI DESC
      if (a.isFastTracked !== b.isFastTracked) return a.isFastTracked ? -1 : 1;
      if (b.age !== a.age) return b.age - a.age;
      return (b.isNRI ? 1 : 0) - (a.isNRI ? 1 : 0);
    });
}

// ─── Phase 3: Multi-Pass Room Allocation ─────────────────────────────────────

/**
 * Fetch the active room inventory for an event from utsav_room_config.
 */
export async function getEventRooms(utsavid) {
  return UtsavRoomConfig.findAll({
    where: {
      utsavid,
      is_blocked: 0,
      avail_capacity: { [Op.gt]: 0 }
    },
    order: [
      ['is_inside_rc', 'DESC'],
      ['floor', 'ASC'],
      ['alloc_rank', 'ASC'],
      ['room_group', 'ASC']
    ],
    raw: true
  });
}

/**
 * Resolve effective gender for a room (override → roomdb default → staying).
 */
function getEffectiveGender(room, roomDbGenders) {
  if (room.gender_staying) return room.gender_staying;
  if (room.gender_override) return room.gender_override;
  return roomDbGenders.get(room.room_group) || null; // null = any gender allowed
}

/**
 * Run one allocation pass over all unallocated guests.
 *
 * Pass levels:
 *  1 = Strict:       isInsideRC + needsGF + gender match
 *  2 = Relax Floor:  isInsideRC + gender match (any floor)
 *  3 = Relax RC:     gender match only (any room)
 *
 * Returns updated { rooms, guests } after pass.
 */
export function runAllocationPass(rooms, guests, roomDbGenders, passLevel) {
  // Work on mutable clones indexed by room_group+property
  const roomMap = new Map(rooms.map(r => [`${r.property}_${r.room_group}`, { ...r }]));

  for (const guest of guests) {
    if (guest.allocated || guest.reviewFlag) continue;

    for (const [key, room] of roomMap) {
      if (room.avail_capacity <= 0) continue;

      const effectiveGender = getEffectiveGender(room, roomDbGenders);

      // Gender check: must match or room is empty (no gender locked in yet)
      const genderOk = !effectiveGender || effectiveGender === guest.gender;
      if (!genderOk) continue;

      // Pass-level constraints
      if (passLevel === 1) {
        if (guest.isInsideRC && !room.is_inside_rc) continue;
        if (guest.needsGF && room.floor !== 0) continue;
      } else if (passLevel === 2) {
        if (guest.isInsideRC && !room.is_inside_rc) continue;
        // floor: any
      }
      // passLevel 3: any room, just gender

      // ✅ Match found — allocate
      guest.allocated = true;
      guest.allottedRoom = room.room_group;
      guest.allottedProperty = room.property;

      room.avail_capacity--;
      if (!room.gender_staying) room.gender_staying = guest.gender;

      roomMap.set(key, room);
      break;
    }
  }

  return {
    rooms: Array.from(roomMap.values()),
    guests
  };
}

// ─── Phase 4: Bed Assignment ─────────────────────────────────────────────────

/**
 * Assign specific bed labels within each room.
 * Rule: sort occupants by age ASC. If room has floor bedding (addl_capacity > 0),
 * youngest gets <ROOM>_FLOOR. Others get <ROOM>_A, _B, _C...
 */
export function assignBeds(rooms, guests) {
  const roomMap = new Map(rooms.map(r => [
    `${r.property}_${r.room_group}`,
    { ...r, occupants: [] }
  ]));

  // Group allocated guests by their room (skip fast-tracked guests because their bedLabel is already Flat X, PR, etc.)
  guests.forEach(g => {
    if (!g.allocated || !g.allottedRoom || g.isFastTracked) return;
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (roomMap.has(key)) {
      roomMap.get(key).occupants.push(g);
    }
  });

  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  for (const [, room] of roomMap) {
    if (!room.occupants.length) continue;

    const hasFloorBed = room.addl_capacity > 0;

    // Sort by age ASC — youngest first
    room.occupants.sort((a, b) => a.age - b.age);

    room.occupants.forEach((g, idx) => {
      if (hasFloorBed && idx === 0) {
        g.bedLabel = `${room.room_group}_FLOOR`;
      } else {
        const bedIdx = hasFloorBed ? idx - 1 : idx;
        g.bedLabel = `${room.room_group}_${ALPHA[bedIdx]}`;
      }
    });
  }

  return guests;
}

// ─── Phase 5: Mid-Event Turnaround ───────────────────────────────────────────

/**
 * After split-package Phase 1, reclaim beds vacated by short-stay guests.
 * Resets gender_staying on fully vacated rooms.
 *
 * @param {Array} phase1Guests - all Phase 1 allocated guests
 * @param {string} splitDate - YYYY-MM-DD checkout date of Phase 1 short-stay package
 * @returns {{ updatedRooms, vacatedRoomKeys }}
 */
export function handleTurnaround(rooms, phase1Guests, splitDate) {
  const roomMap = new Map(rooms.map(r => [
    `${r.property}_${r.room_group}`,
    { ...r, phase1Occupants: 0, phase1Vacating: 0 }
  ]));

  // Count occupants and how many are vacating on splitDate
  phase1Guests.forEach(g => {
    if (!g.allocated || !g.allottedRoom || g.isFastTracked) return;
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (!roomMap.has(key)) return;
    const room = roomMap.get(key);
    room.phase1Occupants++;
    if (g.checkout && g.checkout <= splitDate) {
      room.phase1Vacating++;
    }
  });

  const vacatedRoomKeys = [];

  for (const [key, room] of roomMap) {
    if (room.phase1Vacating > 0) {
      room.avail_capacity += room.phase1Vacating;
      // If fully vacated, reset gender so new gender can occupy
      if (room.phase1Occupants === room.phase1Vacating) {
        room.gender_staying = '';
      }
      vacatedRoomKeys.push(key);
    }
  }

  return {
    updatedRooms: Array.from(roomMap.values()),
    vacatedRoomKeys
  };
}

// ─── Full Allocation Run ──────────────────────────────────────────────────────

/**
 * Execute the complete smart allocation algorithm.
 *
 * @param {Object} params
 *   utsavid, participants, seniorAge, utsavStartDate, utsavEndDate,
 *   splitDate (optional), fastTrackData (flatOwnerMap, formGuestMap, prePostRoomMap)
 *
 * @returns {Object} { guests (with allottedRoom + bedLabel), rooms, summary }
 */
export async function runSmartAllocation(params) {
  const {
    utsavid,
    participants,
    seniorAge = 65,
    utsavStartDate,
    utsavEndDate,
    splitDate = null,
    fastTrackData = {}
  } = params;

  // Build roomdb gender map (permanent designations)
  const allBeds = await RoomDb.findAll({ raw: true });
  const roomDbGenders = new Map();
  allBeds.forEach(bed => {
    const match = String(bed.roomno).match(/^(\d+)/);
    if (match) roomDbGenders.set(match[1], bed.gender);
  });

  // Fetch event room inventory
  let rooms = await getEventRooms(utsavid);
  if (!rooms.length) {
    throw new Error('No room inventory found for this event. Please initialize rooms first.');
  }

  // Preprocess & classify guests
  const guests = preprocessGuests(participants, {
    seniorAge, utsavStartDate, utsavEndDate, fastTrackData
  });

  // Auto-detect split date if not explicitly provided
  let effectiveSplitDate = splitDate;
  if (!effectiveSplitDate && participants.length) {
    const midPkg = participants.find(p => p.checkout && utsavEndDate && p.checkout < utsavEndDate);
    if (midPkg) {
      effectiveSplitDate = midPkg.checkout;
    }
  }

  // ── Phase 1: Full-event & First Half guests (Pkg A + B) ──
  let phase1Guests = effectiveSplitDate
    ? guests.filter(g => !g.checkin || g.checkin <= effectiveSplitDate)
    : guests;
  // ── Phase 2: Second Half / Turnaround guests (Pkg C) ──
  let phase2Guests = effectiveSplitDate
    ? guests.filter(g => g.checkin && g.checkin > effectiveSplitDate)
    : [];

  // Pass 1 → 2 → 3 for Phase 1
  for (let pass = 1; pass <= 3; pass++) {
    const result = runAllocationPass(rooms, phase1Guests, roomDbGenders, pass);
    rooms = result.rooms;
    phase1Guests = result.guests;
  }

  // Bed assignment for Phase 1
  phase1Guests = assignBeds(rooms, phase1Guests);

  // ── Phase 2: Turnaround for Package C guests ──
  if (effectiveSplitDate && phase2Guests.length) {
    const { updatedRooms } = handleTurnaround(rooms, phase1Guests, effectiveSplitDate);
    rooms = updatedRooms;

    for (let pass = 1; pass <= 3; pass++) {
      const result = runAllocationPass(rooms, phase2Guests, roomDbGenders, pass);
      rooms = result.rooms;
      phase2Guests = result.guests;
    }
    phase2Guests = assignBeds(rooms, phase2Guests);
  }

  // Diagnose reason for each unallocated guest
  const maleRoomsAvail = rooms.filter(r => r.avail_capacity > 0 && (!r.gender_staying ? (r.gender_override === 'M' || roomDbGenders.get(r.room_group) === 'M') : r.gender_staying === 'M'));
  const femaleRoomsAvail = rooms.filter(r => r.avail_capacity > 0 && (!r.gender_staying ? (r.gender_override === 'F' || roomDbGenders.get(r.room_group) === 'F') : r.gender_staying === 'F'));

  const maleGFRoomsAvail = maleRoomsAvail.filter(r => r.floor === 0);
  const femaleGFRoomsAvail = femaleRoomsAvail.filter(r => r.floor === 0);

  const maleRCAvail = maleRoomsAvail.filter(r => r.is_inside_rc);
  const femaleRCAvail = femaleRoomsAvail.filter(r => r.is_inside_rc);

  const allGuests = [...phase1Guests, ...phase2Guests];

  allGuests.forEach(g => {
    if (g.allocated) {
      g.unallocated_reason = null;
      return;
    }

    if (g.reviewFlag) {
      const missing = [!g.age && 'Age', !g.gender && 'Gender', !g.center && 'Center'].filter(Boolean).join(', ');
      g.unallocated_reason = `Missing data: ${missing}`;
      return;
    }

    const isM = g.gender === 'M';
    const genderLabel = isM ? 'Male' : 'Female';
    const totalGenderAvail = isM ? maleRoomsAvail.length : femaleRoomsAvail.length;
    const gfGenderAvail = isM ? maleGFRoomsAvail.length : femaleGFRoomsAvail.length;
    const rcGenderAvail = isM ? maleRCAvail.length : femaleRCAvail.length;

    if (totalGenderAvail === 0) {
      g.unallocated_reason = `All ${genderLabel} rooms full (0 beds left)`;
    } else if (g.needsGF && gfGenderAvail === 0) {
      g.unallocated_reason = `All Ground Floor ${genderLabel} rooms full`;
    } else if (g.isInsideRC && rcGenderAvail === 0) {
      g.unallocated_reason = `All RC Inside ${genderLabel} rooms full`;
    } else {
      g.unallocated_reason = `No matching ${genderLabel} room available`;
    }
  });

  const summary = {
    total: allGuests.length,
    allocated: allGuests.filter(g => g.allocated).length,
    unallocated: allGuests.filter(g => !g.allocated && !g.reviewFlag).length,
    reviewRequired: allGuests.filter(g => g.reviewFlag).length,
    roomsUsed: rooms.filter(r => r.gender_staying).length,
    roomsAvailable: rooms.filter(r => r.avail_capacity > 0).length
  };

  return { guests: allGuests, rooms, summary };
}
