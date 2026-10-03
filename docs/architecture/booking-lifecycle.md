# Booking Lifecycle and Business Logic

This document covers every booking type's status flow, payment/transaction states, the credit system, cancellation rules, waitlist promotion, and cron automation. It is the single source of truth for understanding how bookings move through the system.

---

## Booking Types

| Constant | Category | Transaction Type | Notes |
|---|---|---|---|
| `TYPE_ROOM` | Accommodation | `room` | Regular room booking |
| `TYPE_GUEST_ROOM` | Accommodation | `room` | Alias for TYPE_ROOM |
| `TYPE_FLAT` | Accommodation | `flat` | Uses `room` credit pool |
| `TYPE_FOOD` | Meals | `food` | Free for non-guests |
| `TYPE_GUEST_BREAKFAST` | Meals | `breakfast` | Guest-specific |
| `TYPE_GUEST_LUNCH` | Meals | `lunch` | Guest-specific |
| `TYPE_GUEST_DINNER` | Meals | `dinner` | Guest-specific |
| `TYPE_TRAVEL` | Transport | `travel` | One-way trips |
| `TYPE_ADHYAYAN` | Programs | `adhyayan` | Study/retreat programs |
| `TYPE_GUEST_ADHYAYAN` | Programs | `adhyayan` | Alias for TYPE_ADHYAYAN |
| `TYPE_UTSAV` | Events | `utsav` | Festival/event packages |
| `TYPE_GUEST_UTSAV` | Events | `utsav` | Alias for TYPE_UTSAV |

---

## Status Flows by Booking Type

### Room / Flat Booking

**Statuses:** `waiting`, `pending`, `pending checkin`, `checkedin`, `checkedout`, `cancelled`, `admin cancelled`

```
┌─────────────────────────────────────────────────────┐
│                  BOOKING CREATED                     │
└──────────────┬───────────────────┬──────────────────┘
               │                   │
        (beds available)    (no beds available)
               │                   │
               ▼                   ▼
           pending              waiting
               │                   │
        (payment done)     (bed becomes available)
               │                   │
               ▼                   ▼
        pending checkin ◄──────────┘
               │
         (guest arrives)
               │
               ▼
           checkedin
               │
          (guest leaves)
               │
               ▼
          checkedout
```

**Special cases:**
- **Day visit** (0 nights): Goes directly to `pending checkin`, no payment
- **Flat owner booking own flat**: Goes directly to `pending checkin`, no transaction created
- **Non-flat-owner booking flat**: Goes to `pending`, must pay
- **Utsav boundary overlap**: Single-night booking overlapping utsav start/end → forced to `waiting`

**Cancellable from:** `waiting`, `pending`, `pending checkin`
**Not cancellable from:** `checkedin`, `checkedout`, `cancelled`, `admin cancelled`

---

### Travel Booking

**Statuses:** `waiting`, `awaiting confirmation`, `confirmed`, `proceed for payment`, `cancelled`, `admin cancelled`

```
┌─────────────────────────────────────────────────────┐
│                  BOOKING CREATED                     │
└──────────────┬───────────────────┬──────────────────┘
               │                   │
     (no conflict)         (same-direction booking
               │            already exists)
               ▼                   ▼
    awaiting confirmation       waiting
               │                   │
        (admin confirms)    (confirmed booking
               │             in same direction
               ▼             gets cancelled)
          confirmed                │
                                   ▼
                         awaiting confirmation
```

**Key rules:**
- Users cannot have two bookings in the **same direction** on the same date
- Direction = whether pickup/drop point is `'Research Centre'`
- Opposite-direction bookings on same day are allowed (arrive morning, depart evening)
- Waitlist promotion goes to `awaiting confirmation`, NOT directly to `confirmed` — requires admin review

**Cancellable from:** `waiting`, `awaiting confirmation`, `confirmed`, `proceed for payment`

---

### Adhyayan (Shibir) Booking

**Statuses:** `waiting`, `pending`, `confirmed`, `cancelled`, `admin cancelled`

```
┌─────────────────────────────────────────────────────┐
│                  BOOKING CREATED                     │
└──────┬────────────────┬─────────────────┬───────────┘
       │                │                 │
  (seats + open    (seats + open     (no seats OR
   + has fee)       + free)           not open)
       │                │                 │
       ▼                ▼                 ▼
    pending          confirmed         waiting
       │                                  │
  (payment done)              (seat opens via cron
       │                       or cancellation)
       ▼                                  │
   confirmed ◄────────────────────────────┘
                                   (promoted to pending,
                                    new transaction created)
```

**Side effects on confirmation/promotion:**
- Attendance record created with all 9 sessions marked `1` (attended)
- Only for `RESEARCH_CENTRE` location events

**Side effects on cancellation:**
- Attendance sessions 1-9 reset to `0`
- Seat opened → oldest waiting booking promoted to `pending`
- New transaction created for promoted user
- Promoted user emailed

---

### Utsav Booking

**Statuses:** `waiting`, `pending`, `confirmed`, `cash pending`, `cash completed`, `checkedin`, `cancelled`, `admin cancelled`

```
┌─────────────────────────────────────────────────────┐
│                  BOOKING CREATED                     │
└──────┬────────────────┬─────────────────┬───────────┘
       │                │                 │
  (seats + has fee) (seats + free)   (no seats OR
       │                │             utsav closed)
       ▼                ▼                 ▼
    pending          confirmed         waiting
       │                              (no auto-promotion)
  (payment done)
       │
       ▼
   confirmed
```

**Key rules:**
- **Samvatsari exclusivity**: Package ID 21 (Samvatsari) cannot coexist with packages 18 or 20 for the same user — enforced at booking time
- **Utsav closed**: All new bookings forced to `waiting` regardless of seat count
- **No auto-promotion**: Unlike adhyayan/travel, when a seat opens, waiting users are NOT automatically promoted. Seat count incremented but no status change
- **Admin bookings**: Always created as `waiting`, no transaction — admin manually promotes later

---

### Food Booking

Food bookings do NOT have a traditional status field. Each record tracks:
- `breakfast`, `lunch`, `dinner`: boolean (1/0) for what was booked
- `hightea`: `'TEA'`, `'COFFEE'`, or `'NONE'`
- `breakfast_plate_issued`, `lunch_plate_issued`, `dinner_plate_issued`: plate issuance tracking

**Charging rules:**
- `GUEST` status users: Charged per meal (breakfast ₹60, lunch ₹120, dinner ₹120)
- `MUMUKSHU`, `PR`, `SEVA KUTIR` status users: Free — no transaction created

**Cancellation cutoff:** User can cancel until 8:00 PM the previous day. Admins can cancel same-day.

**Cancellation mechanics:** Sets the individual meal flag to `0` (record not deleted), then cancels associated transaction.

---

## Transaction States

Transactions track payments for all booking types. Every paid booking has an associated transaction record.

**All transaction statuses:**

| Status | Constant | Meaning |
|---|---|---|
| `pending` | `STATUS_PAYMENT_PENDING` | Awaiting online payment |
| `cash pending` | `STATUS_CASH_PENDING` | Awaiting cash payment (non-India users) |
| `authorized` | `STATUS_PAYMENT_AUTHORIZED` | Razorpay authorized, not yet captured |
| `captured` | `STATUS_PAYMENT_CAPTURED` | Razorpay successfully captured |
| `completed` | `STATUS_PAYMENT_COMPLETED` | Payment successful (online) |
| `cash completed` | `STATUS_CASH_COMPLETED` | Cash payment received |
| `failed` | `STATUS_PAYMENT_FAILED` | Payment failed (can retry) |
| `cancelled` | `STATUS_CANCELLED` | User cancelled |
| `admin cancelled` | `STATUS_ADMIN_CANCELLED` | System/admin cancelled |
| `credited` | `STATUS_CREDITED` | Refund issued as credits |

### Payment Flow

```
Transaction Created
       │
       ├── India user ──────► STATUS_PAYMENT_PENDING
       │                           │
       │                    (Razorpay webhook)
       │                           │
       │                    ┌──────┴──────┐
       │                    │             │
       │              authorized       failed
       │                    │          (can retry,
       │                 captured    cron cancels after 24h)
       │                    │
       │               completed ───► booking confirmed
       │
       └── Non-India user ─► STATUS_CASH_PENDING
                                   │
                            (admin marks paid)
                                   │
                            cash completed ───► booking confirmed
```

### Razorpay Webhook Processing

The webhook receives three possible statuses:
1. **authorized** → Transaction set to `authorized` (intermediate, no booking change)
2. **captured** → Transaction set to `completed`, booking status updated:
   - Room/Flat → `pending checkin`
   - All others → `confirmed`
3. **failed** → Transaction set to `failed` (user can retry payment)

### Credit Application at Booking Time

When a transaction is created, `useCredit()` checks available credits:

```
Available credits for type ≥ full amount?
       │
       ├── Yes ─► Credits deducted, transaction.discount = credits used
       │          transaction.amount = 0, status = COMPLETED
       │          Booking immediately confirmed/pending checkin
       │
       └── No ──► Partial credits applied, transaction.discount = credits used
                  transaction.amount = remaining, status = PENDING
                  User must pay the remainder via Razorpay/cash
```

Transaction stores: `amount` (what user must pay) + `discount` (credits used) = total booking cost.

---

## Credit System

### Storage

Credits stored as JSON object on `CardDb.credits`:
```json
{ "room": 500, "adhyayan": 200, "food": 100, "travel": 0, "utsav": 300 }
```
Zero-value keys are deleted from the object.

### Credit Type Mapping

| Booking Type | Credit Type Used | Notes |
|---|---|---|
| Room | `room` | |
| Flat | `room` | Flat and room share the same credit pool |
| Food | `food` | |
| Travel | `travel` | |
| Adhyayan | `adhyayan` | |
| Utsav | `utsav` | |

### When Credits Are Added (Refunds)

Credits are added back on cancellation. The amount depends on **who cancels** and the **transaction status**:

| Transaction Status | User Cancels | Admin/Cron Cancels |
|---|---|---|
| `completed` / `cash completed` | Full refund: `amount + discount` | Full refund: `amount + discount` |
| `pending` / `cash pending` / `failed` | Discount only (credits already held) | Discount only |
| `cancelled` | Error (already cancelled) | Force full credits, status → `credited` |
| `admin cancelled` / `credited` | Error | Error |

### No-Refund Rules

**Travel and Utsav user cancellations get NO credits.** The transaction status is preserved but 0 credits are returned. This prevents users from gaming the system by booking and cancelling.

Admin cancellation of travel/utsav DOES issue full credits.

---

## Cancellation Rules Summary

| Booking Type | User Can Cancel From | Refund on User Cancel | Refund on Admin Cancel | Waitlist Promotion |
|---|---|---|---|---|
| **Room/Flat** | waiting, pending, pending checkin | Full credits | Full credits | None |
| **Travel** | waiting, awaiting confirmation, confirmed | **No credits** | Full credits | Oldest waiting → `awaiting confirmation` |
| **Adhyayan** | waiting, pending, confirmed | Full credits | Full credits | Oldest waiting → `pending` (new transaction created) |
| **Utsav** | Any non-cancelled status | **No credits** | Full credits | Seat freed, **no auto-promotion** |
| **Food** | Before 8 PM previous day | Full credits | Full credits (no time limit) | N/A |

---

## Cron Job: Auto-Cancellation

**Schedule:** Every 30 minutes
**Target:** Transactions with `status IN (pending, failed)` AND `createdAt <= now - 24 hours` AND `card.country = 'India'`

Non-India users are excluded because they typically pay cash and need more time.

### What the Cron Does Per Booking Type

| Type | Booking Status Set To | Transaction Action | Side Effects |
|---|---|---|---|
| **Room/Flat** | `admin cancelled` | Cancel + credit discount | Cancellation email sent |
| **Food** | Meal flag set to `0` | Cancel + credit discount | — |
| **Travel** | `admin cancelled` | Cancel + credit discount | Promote oldest waiting → `awaiting confirmation`, email promoted user |
| **Adhyayan** | `admin cancelled` | Cancel + credit discount | Reset attendance (sessions 1-9 → 0), promote oldest waiting → `pending`, create new transaction + attendance for promoted user, email both |
| **Utsav** | `admin cancelled` | Cancel + credit discount | Increment `available_seats` (only if utsav status = `open`), **no promotion** |

All cron operations run within a single database transaction — if any step fails, the entire batch rolls back.

---

## Guest vs Mumukshu Booking Differences

| Aspect | Mumukshu / PR / Seva Kutir | Guest |
|---|---|---|
| Identity | Has a card (`cardno`) | Registered in `guest_db`, linked via `bookedBy` cardno |
| Food charges | Free | Charged per meal |
| Food transaction type | No transaction | `TYPE_GUEST_BREAKFAST`, `TYPE_GUEST_LUNCH`, `TYPE_GUEST_DINNER` |
| Room/Flat booking | Books directly | Booked by a mumukshu on their behalf |
| Payment | Own payment | Paid by the mumukshu who booked |

---

## Admin vs User Booking Creation

| Aspect | User Books | Admin Books |
|---|---|---|
| **Room** | `pending` or `waiting` | Same as user |
| **Adhyayan** | `pending` (has fee), `confirmed` (free), or `waiting` | Always `waiting` if no seats or not open; no transaction created |
| **Utsav** | `pending`, `confirmed`, or `waiting` | Always `waiting`; no transaction created |
| **Travel** | `awaiting confirmation` or `waiting` | Same as user |
| **Transaction** | Created immediately | Not created (admin handles payment separately) |

---

## Prices

| Item | Price (₹) |
|---|---|
| AC Room (per night) | 1,100 |
| NAC Room (per night) | 700 |
| Breakfast | 60 |
| Lunch | 120 |
| Dinner | 120 |

All prices defined in `config/constants.js`.

---

## Related Code

| Area | File | Key Functions |
|---|---|---|
| All constants | `config/constants.js` | Status constants, prices, types |
| Transaction logic | `helpers/transactions.helper.js` | `cancelTransaction()`, `useCredit()`, `addCredit()`, `createPendingTransaction()` |
| Room booking | `helpers/roomBooking.helper.js` | Allocation, gender encoding, waitlist |
| Food booking | `helpers/foodBooking.helper.js` | `cancelFood()`, `cancelMeal()`, meal validation |
| Travel booking | `helpers/travelBooking.helper.js` | `checkTravelAlreadyBooked()`, `updateWaitingTravelBooking()` |
| Adhyayan booking | `helpers/adhyayanBooking.helper.js` | `openAdhyayanSeat()`, `resetShibirAttendance()`, `createShibirAttendanceEntry()` |
| Utsav booking | `helpers/utsavBooking.helper.js` | `openUtsavSeat()` |
| Razorpay webhook | `controllers/client/payment.controller.js` | Webhook processing |
| Cron automation | `cron.js` | 30-minute scheduled cancellation and promotion |
