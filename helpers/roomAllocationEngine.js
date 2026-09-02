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

    const [record, wasCreated] = await UtsavRoomConfig.findOrCreate({
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

    if (wasCreated) {
      created++;
    } else {
      // Sync is_blocked from roomdb in case room status changed since last init
      if (record.is_blocked !== isBlocked) {
        await record.update({
          is_blocked: isBlocked,
          avail_capacity: isBlocked ? 0 : record.base_capacity,
          notes: isBlocked ? 'Blocked in RoomDB' : record.notes
        });
      }
      skipped++;
    }
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
 * @param {Object} config - { seniorAge, utsavStartDate, utsavEndDate, engagementMap, fastTrackData, pastHistoryMap }
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
        const uStart = new Date(utsavStartDate).getTime();
        const uEnd = new Date(utsavEndDate).getTime();
        const pCin = new Date(p.checkin).getTime();
        const pCout = new Date(p.checkout).getTime();
        if (!isNaN(uStart) && !isNaN(uEnd) && !isNaN(pCin) && !isNaN(pCout)) {
          isFullPkg = pCin <= uStart && pCout >= uEnd;
        } else {
          isFullPkg = p.checkin <= utsavStartDate && p.checkout >= utsavEndDate;
        }
      }

      const isInsideRC = effectiveNRI || isSenior || isFullPkg;

      // Fairness Stay History: Check last 2 events for Inside RC stay
      const pastHistory = (config.pastHistoryMap && config.pastHistoryMap.get(cardnoClean)) || [];
      const last2Events = pastHistory.slice(0, 2);
      const hadRecentRC = last2Events.some(ev => ev.location_type === 'RC');
      const pastRcCount = pastHistory.filter(ev => ev.location_type === 'RC').length;

      // Engagement Score
      const isEngaged = !!(config.engagementMap && config.engagementMap.get(cardnoClean));

      let isFastTracked = false;
      let fastTrackRoom = '';
      let fastTrackTag = '';
      let fastTrackReason = '';

      // 1. Flat / Room Owner in flatdb
      if (flatOwnerMap.has(cardnoClean)) {
        const fno = flatOwnerMap.get(cardnoClean);
        const fNum = parseInt(fno, 10);
        const isRcRoom = !isNaN(fNum) && fNum >= 1 && fNum <= 60;
        const prefix = isRcRoom ? 'Room ' : 'Flat ';
        isFastTracked = true;
        fastTrackRoom = prefix + fno;
        fastTrackTag = isRcRoom ? 'Room Owner' : 'Flat Owner';
        fastTrackReason = `${isRcRoom ? 'Room' : 'Flat'} Owner (${prefix}${fno})`;
      }
      // 2. Flat / Room Host Form Guest (co-owner or verified guest from form)
      else if (formGuestMap.has(cardnoClean) || formGuestMap.has(mobClean)) {
        const fno = formGuestMap.get(cardnoClean) || formGuestMap.get(mobClean);
        const fNum = parseInt(fno, 10);
        const isRcRoom = !isNaN(fNum) && fNum >= 1 && fNum <= 60;
        const prefix = isRcRoom ? 'Room ' : 'Flat ';
        isFastTracked = true;
        fastTrackRoom = prefix + fno;
        fastTrackTag = isRcRoom ? 'Room Guest' : 'Flat Guest';
        fastTrackReason = `Host Form (${prefix}${fno})`;
      }
      // 3. Pre/Post event room booking
      else if (prePostRoomMap.has(cardnoClean) && prePostRoomMap.get(cardnoClean).roomno && prePostRoomMap.get(cardnoClean).roomno !== 'NA' && prePostRoomMap.get(cardnoClean).roomno !== '-') {
        const prePost = prePostRoomMap.get(cardnoClean);
        isFastTracked = true;
        fastTrackRoom = prePost.roomno;
        fastTrackTag = effectiveNRI ? 'Intl Pre/Post' : 'Pre/Post Stay';
        fastTrackReason = `Pre/Post Event Stay (${prePost.type}: Room ${prePost.roomno})`;
      }
      // 4. PR / Seva Kutir / Flat resident status
      else if (['PR', 'SEVA KUTIR', 'FLAT'].includes(resStatus)) {
        isFastTracked = true;
        fastTrackRoom = p.roomno && p.roomno !== '-' ? p.roomno : resStatus;
        fastTrackTag = resStatus;
        fastTrackReason = `Resident Status: ${resStatus}`;
      }
      // 5. Manual admin assignment
      else if (p.roomno && p.roomno !== '-' && p.updatedBy && p.updatedBy !== 'SYSTEM-ROOM-ALLOCATION') {
        isFastTracked = true;
        fastTrackRoom = p.roomno;
        fastTrackTag = 'Manual';
        fastTrackReason = `Manually assigned by admin (${p.updatedBy})`;
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
        isEngaged,
        reviewFlag,
        isFastTracked,
        allocated: isFastTracked,
        allottedRoom: isFastTracked ? fastTrackRoom : (p.roomno && p.roomno !== '-' ? p.roomno : null),
        bedLabel: isFastTracked ? fastTrackRoom : null,
        fastTrackTag,
        fastTrackReason,
        hadRecentRC,
        pastRcCount,
        unallocated_reason: isFastTracked ? null : null
      };
    })
    .sort((a, b) => {
      // 1. Fast-tracked first
      if (a.isFastTracked !== b.isFastTracked) return a.isFastTracked ? -1 : 1;

      // 2. Senior Citizen (65+)
      if (a.isSenior !== b.isSenior) return a.isSenior ? -1 : 1;

      // 3. Full Event Package
      if (a.isFullPkg !== b.isFullPkg) return a.isFullPkg ? -1 : 1;

      // 4. Engagement Score
      if (a.isEngaged !== b.isEngaged) return a.isEngaged ? -1 : 1;

      // 5. Fairness Rule: Those who have NOT had RC in the last 2 events get priority
      if (a.hadRecentRC !== b.hadRecentRC) return a.hadRecentRC ? 1 : -1;

      // 6. Age DESC
      return (b.age || 0) - (a.age || 0);
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
    { ...r, allOccupants: [] }
  ]));

  // Group all allocated guests belonging to this room (both fast-tracked and dynamic)
  guests.forEach(g => {
    if (!g.allocated || !g.allottedRoom) return;
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (roomMap.has(key)) {
      roomMap.get(key).allOccupants.push(g);
    }
  });

  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  for (const [, room] of roomMap) {
    if (!room.allOccupants.length) continue;

    // Find fast-tracked occupants with fixed bed letters (e.g. Room 1_B)
    const dynamicOccupants = [];
    const usedLetters = new Set();

    room.allOccupants.forEach(g => {
      const cleanLabel = String(g.bedLabel || '').replace(/^Room\s*(No\.?|#)?\s*/i, '').trim();
      const match = cleanLabel.match(/^(\d+)_?([A-Z])$/i);
      if (g.isFastTracked && match) {
        usedLetters.add(match[2].toUpperCase());
      } else {
        dynamicOccupants.push(g);
      }
    });

    // Available wood cot letters not claimed by fixed fast-tracked occupants
    const availableCotLetters = [];
    for (let i = 0; i < room.base_capacity; i++) {
      if (!usedLetters.has(ALPHA[i])) {
        availableCotLetters.push(ALPHA[i]);
      }
    }

    // Sort dynamic occupants by age DESC
    dynamicOccupants.sort((a, b) => (b.age || 0) - (a.age || 0));

    let floorCount = 1;
    dynamicOccupants.forEach(g => {
      if (availableCotLetters.length > 0) {
        const letter = availableCotLetters.shift();
        g.bedLabel = `Room ${room.room_group}_${letter}`;
      } else {
        g.bedLabel = floorCount === 1
          ? `Room ${room.room_group}_FLOOR`
          : `Room ${room.room_group}_FLOOR_${floorCount}`;
        floorCount++;
      }
    });
  }

  return guests;
}

/**
 * Assign beds respecting mid-event turnaround (Package B checking out -> Package C checking in).
 * Package C takes beds vacated by Package B rather than creating extra floor beds.
 */
export function assignSplitBeds(rooms, allGuests, effectiveSplitDate) {
  if (!effectiveSplitDate) {
    return assignBeds(rooms, allGuests);
  }

  // Phase 1 guests: Package A (All 8 days) + Package B (First 4 days)
  let phase1Guests = allGuests.filter(g => !g.checkin || g.checkin <= effectiveSplitDate);
  phase1Guests = assignBeds(rooms, phase1Guests);

  // Phase 2 guests: Package A (staying) + Package C (checking in)
  const pkgAGuests = allGuests.filter(g => g.allocated && g.checkout && g.checkout > effectiveSplitDate && (!g.checkin || g.checkin <= effectiveSplitDate));
  const pkgCGuests = allGuests.filter(g => g.allocated && g.checkin && g.checkin > effectiveSplitDate);

  const roomMap = new Map(rooms.map(r => [`${r.property}_${r.room_group}`, r]));
  const roomPkgA = new Map();
  pkgAGuests.forEach(g => {
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (!roomPkgA.has(key)) roomPkgA.set(key, []);
    roomPkgA.get(key).push(g);
  });

  const roomPkgC = new Map();
  pkgCGuests.forEach(g => {
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (!roomPkgC.has(key)) roomPkgC.set(key, []);
    roomPkgC.get(key).push(g);
  });

  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  for (const [key, cGuests] of roomPkgC) {
    const room = roomMap.get(key);
    if (!room) continue;

    // Find beds already claimed by Pkg A in this room
    const aGuests = roomPkgA.get(key) || [];
    const usedLetters = new Set();
    aGuests.forEach(g => {
      const cleanLabel = String(g.bedLabel || '').replace(/^Room\s*(No\.?|#)?\s*/i, '').trim();
      const match = cleanLabel.match(/^(\d+)_?([A-Z])$/i);
      if (match) usedLetters.add(match[2].toUpperCase());
    });

    // Available cot letters for Pkg C in this room
    const availableCotLetters = [];
    for (let i = 0; i < room.base_capacity; i++) {
      if (!usedLetters.has(ALPHA[i])) {
        availableCotLetters.push(ALPHA[i]);
      }
    }

    // Sort Pkg C guests by age DESC
    cGuests.sort((a, b) => (b.age || 0) - (a.age || 0));

    let floorCount = 1;
    cGuests.forEach(g => {
      if (availableCotLetters.length > 0) {
        const letter = availableCotLetters.shift();
        g.bedLabel = `Room ${room.room_group}_${letter}`;
      } else {
        g.bedLabel = floorCount === 1
          ? `Room ${room.room_group}_FLOOR`
          : `Room ${room.room_group}_FLOOR_${floorCount}`;
        floorCount++;
      }
    });
  }

  return allGuests;
}

// ─── Phase 5: Floor Bed Rebalancing ─────────────────────────────────────────

/**
 * After bed assignment, ensure floor beds (_FLOOR) go strictly to youngsters (age 18-40).
 * If any guest older than 40 is on a floor bed AND an unallocated youngster of the same gender exists,
 * the youngster takes the floor bed and the older guest is freed for a follow-up allocation pass.
 *
 * @param {Array} rooms - event room config array
 * @param {Array} allGuests - all guests (allocated + unallocated)
 * @returns {Array} updated guests array
 */
export function rebalanceFloorBeds(rooms, allGuests) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  // Build a map of room -> occupants for quick lookup
  const roomOccupants = new Map();
  allGuests.forEach(g => {
    if (!g.allocated || !g.allottedRoom || g.isFastTracked || !g.bedLabel) return;
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (!roomOccupants.has(key)) roomOccupants.set(key, []);
    roomOccupants.get(key).push(g);
  });

  for (const [key, occupants] of roomOccupants) {
    // Find guests on floor beds
    const floorOccupants = occupants.filter(g => g.bedLabel && g.bedLabel.includes('_FLOOR'));
    if (!floorOccupants.length) continue;

    for (const floorGuest of floorOccupants) {
      // Rebalance if the floor occupant is older than 40 (floor beds are strictly for youngsters 18-40)
      if (floorGuest.age <= 40) continue;

      // Find an unallocated youngster (age 18-40) of the same gender
      const youngster = allGuests.find(g =>
        !g.allocated &&
        !g.reviewFlag &&
        !g.isFastTracked &&
        g.gender === floorGuest.gender &&
        g.age >= 18 &&
        g.age <= 40
      );

      if (!youngster) continue; // No youngster available — leave on floor

      // Swap: older guest vacates floor bed, youngster takes it
      const vacatedBedLabel = floorGuest.bedLabel;
      const roomNum = floorGuest.allottedRoom;
      const roomProperty = floorGuest.allottedProperty;

      // Assign youngster to the floor bed
      youngster.allocated = true;
      youngster.allottedRoom = roomNum;
      youngster.allottedProperty = roomProperty;
      youngster.bedLabel = vacatedBedLabel;
      youngster.fastTrackTag = '';
      youngster.unallocated_reason = null;

      // Free the older guest — mark unallocated so follow-up pass finds them a wood cot
      floorGuest.allocated = false;
      floorGuest.allottedRoom = null;
      floorGuest.allottedProperty = null;
      floorGuest.bedLabel = null;
      floorGuest.unallocated_reason = 'Rebalanced: floor bed given to youngster';

      // Update room occupants map to reflect the swap
      roomOccupants.get(key).splice(roomOccupants.get(key).indexOf(floorGuest), 1, youngster);
    }
  }

  return allGuests;
}

// ─── Phase 6: Centre Diversification ─────────────────────────────────────────

/**
 * Post-allocation soft swap: try to avoid clustering guests from the same centre
 * in the same room. Swaps are only performed if they don't violate gender/floor/senior rules.
 * This is a best-effort pass — no beds are left empty.
 *
 * @param {Array} rooms - event room config array
 * @param {Array} allGuests - all allocated guests
 * @returns {Array} updated guests array
 */
export function diversifyCentres(rooms, allGuests) {
  // Build room -> occupants map
  const roomOccupants = new Map();
  allGuests.forEach(g => {
    if (!g.allocated || !g.allottedRoom || g.isFastTracked || !g.bedLabel) return;
    const key = `${g.allottedProperty}_${g.allottedRoom}`;
    if (!roomOccupants.has(key)) roomOccupants.set(key, []);
    roomOccupants.get(key).push(g);
  });

  // Build room metadata map (floor, gender)
  const roomMeta = new Map(rooms.map(r => [`${r.property}_${r.room_group}`, r]));

  for (const [key1, occupants1] of roomOccupants) {
    // Find centres with 2+ guests in this room
    const centreCounts = {};
    occupants1.forEach(g => {
      const c = String(g.center || '').trim().toLowerCase();
      if (c) centreCounts[c] = (centreCounts[c] || 0) + 1;
    });

    const clusteredCentres = Object.entries(centreCounts)
      .filter(([, count]) => count >= 2)
      .map(([centre]) => centre);

    if (!clusteredCentres.length) continue;

    const meta1 = roomMeta.get(key1);
    if (!meta1) continue;

    // Try to find a swap partner from another room
    for (const clusteredCentre of clusteredCentres) {
      // Pick the youngest clustered guest as the swap candidate (least disruptive)
      const g1 = occupants1
        .filter(g => String(g.center || '').trim().toLowerCase() === clusteredCentre)
        .sort((a, b) => (a.age || 0) - (b.age || 0))[0];

      if (!g1) continue;

      // Find a swap partner: different centre, same gender, same floor tier, not senior-needing-GF
      let swapped = false;
      for (const [key2, occupants2] of roomOccupants) {
        if (key2 === key1) continue;
        const meta2 = roomMeta.get(key2);
        if (!meta2) continue;

        // Must be same floor tier and same gender gender_staying
        if (meta1.floor !== meta2.floor) continue;

        const g2 = occupants2.find(g =>
          g.gender === g1.gender &&
          String(g.center || '').trim().toLowerCase() !== clusteredCentre &&
          // Don't move a senior off ground floor
          !(g.needsGF && meta1.floor !== 0) &&
          !(g1.needsGF && meta2.floor !== 0)
        );

        if (!g2) continue;

        // Perform swap
        const tmpRoom = g1.allottedRoom;
        const tmpProperty = g1.allottedProperty;
        const tmpBed = g1.bedLabel;

        g1.allottedRoom = g2.allottedRoom;
        g1.allottedProperty = g2.allottedProperty;
        g1.bedLabel = g2.bedLabel;

        g2.allottedRoom = tmpRoom;
        g2.allottedProperty = tmpProperty;
        g2.bedLabel = tmpBed;

        // Update occupant lists
        occupants1.splice(occupants1.indexOf(g1), 1, g2);
        occupants2.splice(occupants2.indexOf(g2), 1, g1);

        swapped = true;
        break;
      }

      if (swapped) break; // One swap per cluster per room per pass is enough
    }
  }

  return allGuests;
}

// ─── Phase 7: Mid-Event Turnaround ───────────────────────────────────────────

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

  // Preprocess & classify guests with past stay history fairness and engagement score
  const guests = preprocessGuests(participants, {
    seniorAge, utsavStartDate, utsavEndDate, fastTrackData,
    pastHistoryMap: params.pastHistoryMap || new Map(),
    engagementMap: params.engagementMap || new Map()
  });

  // ── Deduct inventory for Fast-Tracked RC Guests ──
  const rcRoomLookup = new Map(rooms.map(r => [r.room_group, r]));
  guests.forEach(g => {
    if (!g.isFastTracked || !g.allottedRoom) return;
    const clean = String(g.allottedRoom).replace(/^Room\s*(No\.?|#)?\s*/i, '').trim();
    const match = clean.match(/^(\d+)_?([A-Z]|FLOOR(?:_\d+)?)?$/i);
    if (match) {
      const rNum = match[1];
      const bedSuffix = match[2];
      if (rcRoomLookup.has(rNum)) {
        const room = rcRoomLookup.get(rNum);
        g.allottedProperty = room.property;
        g.allottedRoom = room.room_group;
        if (bedSuffix) {
          g.bedLabel = `Room ${room.room_group}_${bedSuffix.toUpperCase()}`;
        } else {
          g.bedLabel = `Room ${room.room_group}`;
        }
        room.avail_capacity = Math.max(0, room.avail_capacity - 1);
        if (!room.gender_staying && g.gender) {
          room.gender_staying = g.gender;
        }
      }
    }
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

  let allGuests = [...phase1Guests, ...phase2Guests];

  // ── Phase 3: Floor Bed Rebalancing (seniors off floor beds → youngsters 18-40) ──
  allGuests = rebalanceFloorBeds(rooms, allGuests);

  // Re-run allocation pass for any seniors displaced from floor beds
  const rebalancedUnallocated = allGuests.filter(g => !g.allocated && !g.reviewFlag && !g.isFastTracked);
  if (rebalancedUnallocated.length) {
    for (let pass = 1; pass <= 3; pass++) {
      const result = runAllocationPass(rooms, rebalancedUnallocated, roomDbGenders, pass);
      rooms = result.rooms;
    }
    allGuests = assignBeds(rooms, allGuests);
  }

  // ── Phase 4: Centre Diversification (soft swap — best effort) ──
  allGuests = diversifyCentres(rooms, allGuests);

  // ── Phase 5: Final Bed Assignment & Floor Bed Verification ──
  // Re-sort occupants inside each room by age DESC so oldest always get cots (A, B, C, D) and youngsters (18-40) get floor beds
  allGuests = assignSplitBeds(rooms, allGuests, effectiveSplitDate);
  allGuests = rebalanceFloorBeds(rooms, allGuests);

  // Re-run allocation pass for any guest displaced from floor beds in final rebalance
  const finalDisplaced = allGuests.filter(g => !g.allocated && !g.reviewFlag && !g.isFastTracked);
  if (finalDisplaced.length) {
    for (let pass = 1; pass <= 3; pass++) {
      const result = runAllocationPass(rooms, finalDisplaced, roomDbGenders, pass);
      rooms = result.rooms;
    }
  }

  allGuests = assignSplitBeds(rooms, allGuests, effectiveSplitDate);

  // Diagnose reason for each unallocated guest
  const maleRoomsAvail = rooms.filter(r => r.avail_capacity > 0 && (!r.gender_staying ? (r.gender_override === 'M' || roomDbGenders.get(r.room_group) === 'M') : r.gender_staying === 'M'));
  const femaleRoomsAvail = rooms.filter(r => r.avail_capacity > 0 && (!r.gender_staying ? (r.gender_override === 'F' || roomDbGenders.get(r.room_group) === 'F') : r.gender_staying === 'F'));

  const maleGFRoomsAvail = maleRoomsAvail.filter(r => r.floor === 0);
  const femaleGFRoomsAvail = femaleRoomsAvail.filter(r => r.floor === 0);

  const maleRCAvail = maleRoomsAvail.filter(r => r.is_inside_rc);
  const femaleRCAvail = femaleRoomsAvail.filter(r => r.is_inside_rc);

  // allGuests already combined above after phase 3+4

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
