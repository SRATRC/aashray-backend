# Database Schema

**Database:** MySQL 8.0+
**ORM:** Sequelize 6.37.7
**Driver:** mysql2 3.14.1

All models are defined in the `models/` directory. Relationships are centralized in `models/associations.js`.

---

## User and Authentication Models

### CardDb (`card_db`)

Primary user table. Each user has a physical card with a unique card number.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | unique, required | Card number (used as user identifier) |
| `issuedto` | STRING | required | Full name |
| `gender` | ENUM('M','F') | required | Gender |
| `dob` | DATEONLY | nullable | Date of birth |
| `mobno` | BIGINT | unique, required | Mobile number |
| `email` | STRING | nullable | Email address |
| `idType` | STRING | nullable | ID document type |
| `idNo` | STRING | nullable | ID document number |
| `address` | STRING | nullable | Address |
| `country` | STRING | nullable | Country |
| `state` | STRING | nullable | State |
| `city` | STRING | nullable | City |
| `pin` | STRING | nullable | PIN/ZIP code |
| `center` | STRING | nullable | Assigned centre |
| `pfp` | TEXT | nullable | Profile picture URL (S3) |
| `token` | TEXT | nullable | Push notification token |
| `active` | BOOLEAN | default: true | Active status |
| `status` | ENUM('onprem','offprem') | required | Current location status |
| `res_status` | ENUM('MUMUKSHU','PR','SEVA KUTIR','GUEST') | required | Resident type |
| `updatedBy` | STRING | required | Last update actor |
| `password` | STRING | required | bcrypt hashed password |
| `credits` | JSON | nullable | Credit balances by category |
| `showDevelopmentDashboard` | BOOLEAN | default: false | Feature flag |
| `username` | VIRTUAL | computed | Returns `cardno` (not stored) |

**Relationships:** Has many GateRecord, FoodDb, BulkFoodBooking, ShibirBookingDb, FlatBooking, RoomBooking, TravelDb, Transactions, GuestDb, GuestRelationship, MaintenanceDb, SupportTickets, AdhyayanFeedback, ShibirAttendanceDb. Has one UtsavBooking, PermanentWifiCodes.

---

### AdminUsers (`admin_users`)

Admin account table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `username` | STRING | unique, required | Login username |
| `password` | STRING | required | bcrypt hashed password |
| `status` | ENUM('active','inactive') | default: 'active' | Account status |

**Relationships:** Has many AdminRoles, Menu.

---

### AdminRoles (`admin_roles`)

Join table for admin-to-role assignment.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | INTEGER | PK, FK -> AdminUsers.id | Admin user |
| `role_name` | STRING | PK, FK -> Roles.name | Role name |
| `status` | ENUM('active','inactive') | default: 'active' | Assignment status |
| `updatedBy` | STRING | required | Last update actor |

**Composite primary key:** (`user_id`, `role_name`)

---

### Roles (`roles`)

Role definition table.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `name` | STRING | PK | Role identifier (e.g., `superAdmin`, `roomAdmin`) |
| `status` | ENUM('active','inactive') | default: 'active' | Role status |
| `updatedBy` | STRING | required | Last update actor |

---

### GuestDb (`guest_db`)

Guest profile information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | required, FK -> CardDb.cardno | Host card number |
| `name` | STRING | required | Guest name |
| `type` | STRING | required | Guest type |
| `mobno` | STRING | nullable | Guest mobile |
| `gender` | ENUM('M','F') | required | Gender |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

### GuestRelationship (`guest_relationship`)

Maps guests to their host card holders.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | required, FK -> CardDb.cardno | Host card |
| `guest` | STRING | required, FK -> CardDb.cardno | Guest card |
| `type` | STRING | required | Relationship type |
| `updatedBy` | STRING | required | Last update actor |

---

## Accommodation Models

### RoomDb (`roomdb`)

Room master data. **Timestamps disabled.**

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `roomno` | STRING | unique, required | Room number |
| `roomtype` | ENUM('ac','nac','NA') | required | AC/Non-AC/Not Applicable |
| `gender` | ENUM('M','F','SCM','SCF','NA') | required | Gender assignment |
| `roomstatus` | ENUM('available','blocked') | required | Availability |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

**Relationships:** Has many RoomBooking.

---

### RoomBooking (`room_booking`)

Room booking records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Guest card |
| `bookedBy` | STRING | nullable, FK -> CardDb.cardno | Booking creator |
| `roomno` | STRING | required, FK -> RoomDb.roomno | Assigned room |
| `checkin` | DATEONLY | required | Check-in date |
| `checkout` | DATEONLY | required | Check-out date |
| `nights` | INTEGER | required | Number of nights |
| `roomtype` | ENUM('ac','nac','NA') | required | Room type |
| `status` | ENUM('waiting','pending','pending checkin','checkedin','checkedout','cancelled','admin cancelled') | required | Booking status |
| `gender` | ENUM('M','F','SCM','SCF','NA') | required | Gender for room |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

### FlatDb (`flatdb`)

Flat master data. **Timestamps disabled.** Composite primary key.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `flatno` | INTEGER | PK | Flat number |
| `owner` | STRING | PK, FK -> CardDb.cardno | Flat owner card |
| `updatedBy` | STRING | required | Last update actor |

**Relationships:** Has many FlatBooking.

---

### FlatBooking (`flat_booking`)

Flat booking records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Guest card |
| `bookedBy` | STRING | nullable, FK -> CardDb.cardno | Booking creator |
| `flatno` | INTEGER | nullable, FK -> FlatDb.flatno | Flat number |
| `checkin` | DATEONLY | required | Check-in date |
| `checkout` | DATEONLY | required | Check-out date |
| `nights` | INTEGER | required | Number of nights |
| `status` | ENUM('waiting','pending','pending checkin','checkedin','checkedout','cancelled','admin cancelled') | required | Booking status |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

## Food Models

### FoodDb (`food_db`)

Individual meal bookings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Diner card |
| `bookedBy` | STRING | nullable, FK -> CardDb.cardno | Booking creator |
| `date` | DATEONLY | required | Meal date |
| `breakfast` | BOOLEAN | required | Breakfast booked |
| `breakfast_plate_issued` | BOOLEAN | default: false | Plate issued flag |
| `lunch` | BOOLEAN | required | Lunch booked |
| `lunch_plate_issued` | BOOLEAN | default: false | Plate issued flag |
| `dinner` | BOOLEAN | required | Dinner booked |
| `dinner_plate_issued` | BOOLEAN | default: false | Plate issued flag |
| `hightea` | ENUM('TEA','COFFEE','NONE') | default: 'NONE' | High tea preference |
| `spicy` | BOOLEAN | required | Spicy food preference |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

### BulkFoodBooking (`bulk_food_booking`)

Group/department meal bookings.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Booking card |
| `date` | DATEONLY | required | Meal date |
| `guestCount` | INTEGER | required | Number of guests |
| `breakfast` | INTEGER | required | Breakfast count |
| `lunch` | INTEGER | required | Lunch count |
| `dinner` | INTEGER | required | Dinner count |
| `breakfast_plate_issued` | INTEGER | default: 0 | Plates issued |
| `lunch_plate_issued` | INTEGER | default: 0 | Plates issued |
| `dinner_plate_issued` | INTEGER | default: 0 | Plates issued |
| `department` | STRING | values: RC, SREC, SRMC, Smilestones, Sanisa, Events-Guest, Personal | Department |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

### FoodPhysicalPlate (`food_physical_plate`)

Tracks physical plate counts issued per meal.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `date` | DATEONLY | PK | Date |
| `type` | ENUM('breakfast','lunch','dinner') | PK | Meal type |
| `count` | INTEGER | required | Plates issued |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

**Composite unique index:** (`date`, `type`)

---

### FoodRate (`foodrate`)

Meal pricing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `mealtype` | STRING | required | Meal type name |
| `rate` | INTEGER | required | Price in INR |
| `updatedBy` | STRING | required | Last update actor |

---

### Menu (`menu`)

Daily food menu.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `date` | DATEONLY | unique, required | Menu date |
| `breakfast` | STRING | required | Breakfast description |
| `lunch` | STRING | required | Lunch description |
| `dinner` | STRING | required | Dinner description |
| `updatedBy` | STRING | required, FK -> AdminUsers.username | Admin who set menu |

---

## Event Models

### ShibirDb (`shibir_db`)

Adhyayan/Shibir event master data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `name` | STRING | required | Event name |
| `speaker` | STRING | required | Speaker name |
| `month` | STRING | required | Display month |
| `start_date` | DATEONLY | required | Start date |
| `end_date` | DATEONLY | required | End date |
| `location` | STRING | default: 'Research Centre' | Location |
| `total_seats` | INTEGER | required | Total capacity |
| `available_seats` | INTEGER | required | Remaining seats |
| `food_allowed` | BOOLEAN | default: false | Food booking enabled |
| `amount` | INTEGER | required | Registration fee (INR) |
| `comments` | STRING | nullable | Notes |
| `status` | ENUM('open','closed','deleted') | default: 'open' | Event status |
| `updatedBy` | STRING | required | Last update actor |

**Relationships:** Has many ShibirBookingDb, ShibirAttendanceDb, AdhyayanFeedback.

---

### ShibirBookingDb (`shibir_booking_db`)

Adhyayan registrations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Attendee card |
| `bookedBy` | STRING | nullable, FK -> CardDb.cardno | Booking creator |
| `shibir_id` | INTEGER | required, FK -> ShibirDb.id | Shibir reference |
| `status` | ENUM('waiting','confirmed','cancelled','admin cancelled','pending') | default: 'pending' | Booking status |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

### ShibirAttendanceDb (`shibir_attendance_db`)

Attendance tracking per session (up to 9 sessions per shibir).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `shibir_id` | INTEGER | required, FK -> ShibirDb.id | Shibir reference |
| `bookingid` | STRING(255) | required, FK -> ShibirBookingDb.bookingid | Booking reference |
| `cardno` | STRING(255) | required, FK -> CardDb.cardno | Attendee card |
| `days` | INTEGER | required | Number of days |
| `session_1` ... `session_9` | BOOLEAN | default: false | Session scheduled flags |
| `session_1_attendance` ... `session_9_attendance` | BOOLEAN | default: false | Attendance marked flags |
| `updatedBy` | STRING(255) | nullable | Last update actor |

---

### AdhyayanFeedback (`adhyayan_feedback`)

Feedback submitted after attending a shibir.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `shibir_id` | INTEGER | required, FK -> ShibirDb.id | Shibir reference |
| `cardno` | STRING | required, FK -> CardDb.cardno | Respondent card |
| `swadhay_karta_rating` | INTEGER | required, 1-5 | Speaker rating |
| `personal_interaction_rating` | INTEGER | required, 1-5 | Interaction rating |
| `swadhay_karta_suggestions` | TEXT | nullable, max 1000 | Speaker suggestions |
| `raj_adhyayan_interest` | BOOLEAN | required | Interest in future events |
| `future_topics` | TEXT | nullable, max 1000 | Requested topics |
| `loved_most` | TEXT | nullable, max 1000 | Best aspects |
| `improvement_suggestions` | TEXT | nullable, max 1000 | Improvement ideas |
| `food_rating` | INTEGER | required, 1-5 | Food rating |
| `stay_rating` | INTEGER | required, 1-5 | Stay rating |
| `submitted_at` | DATE | default: NOW | Submission date |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

**Unique index:** (`shibir_id`, `cardno`) -- one feedback per user per shibir

---

### UtsavDb (`utsav_db`)

Festival/event master data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `name` | STRING | required | Event name |
| `start_date` | DATEONLY | required | Start date |
| `end_date` | DATEONLY | required | End date |
| `month` | STRING | required | Display month |
| `total_seats` | INTEGER | required | Total capacity |
| `available_seats` | INTEGER | required | Remaining seats |
| `location` | STRING | default: 'Research Centre' | Location |
| `comments` | STRING | nullable | Notes |
| `status` | ENUM('open','closed') | default: 'open' | Event status |
| `registration_deadline` | DATEONLY | nullable | Last registration date |

**Relationships:** Has many UtsavBooking, UtsavPackagesDb.

---

### UtsavPackagesDb (`utsav_packages_db`)

Package options within an utsav.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `utsavid` | INTEGER | required, FK -> UtsavDb.id | Parent utsav |
| `name` | STRING | required | Package name |
| `start_date` | DATEONLY | required | Package start |
| `end_date` | DATEONLY | required | Package end |
| `amount` | INTEGER | required | Price (INR) |
| `updatedBy` | STRING | required | Last update actor |

---

### UtsavBooking (`utsav_booking`)

Utsav registration records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Attendee card |
| `bookedBy` | STRING | nullable, FK -> CardDb.cardno | Booking creator |
| `utsavid` | INTEGER | required, FK -> UtsavDb.id | Utsav reference |
| `packageid` | INTEGER | required, FK -> UtsavPackagesDb.id | Package selected |
| `arrival` | STRING | required | Arrival details |
| `carno` | STRING | nullable | Vehicle number |
| `volunteer` | STRING | nullable | Volunteer assignment |
| `roomno` | STRING | nullable | Assigned room |
| `other` | STRING | nullable | Additional info |
| `status` | ENUM('confirmed','cancelled','pending','waiting','admin cancelled','cash completed','cash pending','checkedin') | | Booking status |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

## Travel Model

### TravelDb (`travel_db`)

Travel booking records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID booking identifier |
| `cardno` | STRING | required, FK -> CardDb.cardno | Traveler card |
| `bookedBy` | STRING | nullable, FK -> CardDb.cardno | Booking creator |
| `date` | DATEONLY | required | Travel date |
| `pickup_point` | STRING | required | Pickup location |
| `drop_point` | STRING | required | Drop location |
| `type` | STRING | required | Travel type |
| `luggage` | STRING | required | Luggage details |
| `arrival_time` | STRING | nullable | Expected arrival time |
| `leaving_post_adhyayan` | BOOLEAN | default: false | Leaving after adhyayan |
| `total_people` | INTEGER | nullable | Group size |
| `comments` | STRING | nullable | User comments |
| `admin_comments` | STRING | nullable | Admin notes |
| `status` | ENUM('waiting','awaiting confirmation','confirmed','cancelled','admin cancelled','proceed for payment') | default: 'waiting' | Booking status |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

## Financial Models

### Transactions (`transactions`)

All financial transactions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | required, FK -> CardDb.cardno | Payer card |
| `bookingid` | STRING | required | Associated booking ID |
| `category` | STRING | required | Transaction category (room, food, adhyayan, travel, utsav) |
| `amount` | DECIMAL | required | Amount in INR |
| `discount` | DECIMAL | default: 0 | Discount applied |
| `razorpay_order_id` | STRING | nullable | Razorpay order reference |
| `description` | STRING | nullable | Transaction description |
| `status` | ENUM('pending','completed','cash pending','cash completed','cancelled','admin cancelled','credited','authorized','captured','failed') | required | Payment status |
| `updatedBy` | STRING | default: 'USER' | Last update actor |

---

### RazorpayWebhook (`razorpay_webhook`)

Razorpay payment webhook event log.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `payment_id` | STRING | required, indexed | Razorpay payment ID |
| `order_id` | STRING | required | Razorpay order ID |
| `status` | STRING | required | Payment status |
| `json` | JSON | required | Full webhook payload |

---

### RazorpaySettlement (`razorpay_settlement`)

Settlement records from Razorpay.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | STRING | PK | Settlement ID |
| `amount` | FLOAT | required | Settlement amount |
| `status` | STRING | required | Settlement status |
| `fees` | FLOAT | required | Processing fees |
| `tax` | FLOAT | nullable | Tax amount |
| `utr` | STRING | nullable | UTR number |
| `cerated_at` | DATE | required | Creation date |

> TODO (NEEDS FIX ⚠️): The column name `cerated_at` appears to be a typo for `created_at`.

---

### RazorpaySettlementRecon (`razorpay_settlement_recon`)

Settlement reconciliation data (individual payment breakdowns).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `payment_id` | STRING | PK | Payment ID |
| `order_id` | STRING | PK | Order ID |
| `amount` | FLOAT | required | Payment amount |
| `fees` | FLOAT | required | Fees charged |
| `tax` | FLOAT | nullable | Tax |
| `credit_amount` | FLOAT | required | Net credit |
| `payment_notes` | STRING | nullable | Notes |
| `settlement_id` | STRING | required | Parent settlement |
| `settled_at` | DATE | required | Settlement date |
| `settlement_utr` | STRING | required | UTR number |

**Composite primary key:** (`payment_id`, `order_id`)

---

## Operational Models

### GateRecord (`gate_record`)

Entry/exit logs.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | required, FK -> CardDb.cardno | User card |
| `status` | ENUM('onprem','offprem') | required | Direction |
| `updatedBy` | STRING | required | Recorded by |

---

### MaintenanceDb (`maintenance_db`)

Facility maintenance requests.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `bookingid` | STRING | PK | UUID request identifier |
| `requested_by` | STRING | required, FK -> CardDb.cardno | Requester card |
| `department` | STRING | required, FK -> Departments.dept_name | Responsible department |
| `work_detail` | STRING | required | Work description |
| `area_of_work` | STRING | nullable | Location of work |
| `comments` | STRING | nullable | Additional comments |
| `status` | ENUM('open','closed','in progress') | default: 'open' | Request status |
| `finished_at` | INTEGER | nullable | Completion timestamp |
| `updatedBy` | STRING | required | Last update actor |

---

### Departments (`departments`)

Department master data.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `dept_name` | STRING | PK | Department name |
| `dept_head` | STRING | required | Department head name |
| `dept_email` | STRING | required | Department email |
| `updatedBy` | STRING | required | Last update actor |

---

### WifiDb (`wifi_pwd`)

Temporary WiFi password records.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `pwd_id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | nullable, FK -> CardDb.cardno | Assigned user |
| `password` | STRING | required | WiFi password |
| `roombookingid` | STRING | nullable | Associated room booking |
| `status` | ENUM('active','inactive') | default: 'active' | Code status |
| `updatedBy` | STRING | required | Last update actor |

---

### PermanentWifiCodes (`permanent_wifi_codes`)

Permanent WiFi code requests and assignments.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `cardno` | STRING | required, FK -> CardDb.cardno | Requester card |
| `username` | STRING | required | WiFi username |
| `code` | STRING | nullable | Assigned WiFi code |
| `ssid` | STRING | nullable | WiFi network SSID |
| `status` | ENUM('pending','approved','rejected','reset','deleted') | default: 'pending' | Request status |
| `requested_at` | DATE | default: NOW | Request date |
| `reviewed_at` | DATE | nullable | Review date |
| `reviewed_by` | STRING | nullable | Reviewing admin |
| `admin_comments` | TEXT | nullable | Admin notes |

---

## Reference Data Models

### BlockDates (`blockdates`)

Date ranges blocked from booking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `checkin` | DATEONLY | required | Block start date |
| `checkout` | DATEONLY | required | Block end date |
| `comments` | STRING | required | Reason for block |
| `status` | ENUM('active','inactive') | default: 'active' | Block status |
| `updatedBy` | STRING | required | Last update actor |

---

### SupportTickets (`support_tickets`)

Customer support tickets.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `issued_by` | STRING | required, FK -> CardDb.cardno | Reporter card |
| `service` | STRING | required | Service area |
| `issue` | TEXT | required | Issue description |

---

### Updates (`updates`)

Mobile app version tracking.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `os` | ENUM('android','ios') | required | Platform |
| `version` | STRING | required | Version string |
| `mandatory` | BOOLEAN | default: false | Force update flag |
| `releaseNotes` | TEXT | nullable | Release notes |

---

### CentreDb (`centre_db`)

Ashram centre locations.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PK, auto-increment | Internal ID |
| `name` | STRING | required | Centre name |

---

### Countries (`countries`), States (`states`), Cities (`cities`)

Hierarchical geographic data.

**Countries:** `id` (PK), `name`
**States:** `id` (PK), `country_id` (FK -> Countries), `name`
**Cities:** `id` (PK), `state_id` (FK -> States), `name`

---

## Cascade Rules

Most relationships use `ON DELETE CASCADE, ON UPDATE CASCADE`. Notable exceptions:

- `RoomBooking.bookedBy` -> CardDb uses `ON DELETE SET NULL` (preserves room booking if the person who created it is deleted)

## Timestamps

All models include `createdAt` and `updatedAt` (Sequelize defaults) except:
- **RoomDb** -- timestamps disabled
- **FlatDb** -- timestamps disabled
