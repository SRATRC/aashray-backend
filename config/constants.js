export const TYPE_EXPENSE = 'expense';
export const TYPE_REFUND = 'refund';
export const TYPE_ROOM = 'room';
export const TYPE_GUEST_ROOM = 'room';
export const TYPE_FLAT = 'flat';
export const TYPE_FOOD = 'food';
export const TYPE_GUEST_BREAKFAST = 'breakfast';
export const TYPE_GUEST_LUNCH = 'lunch';
export const TYPE_GUEST_DINNER = 'dinner';
export const TYPE_TRAVEL = 'travel';
export const TYPE_ADHYAYAN = 'adhyayan';
export const TYPE_GUEST_ADHYAYAN = 'adhyayan';
export const TYPE_UTSAV = 'utsav';
export const TYPE_GUEST_UTSAV = 'utsav';
export const TRANSACTION_TYPE_UPI = 'upi';
export const TRANSACTION_TYPE_CASH = 'cash';
export const RAZORPAY_CALLBACK = 'razorpay_callback';
export const RESEARCH_CENTRE = 'Research Centre';
export const FEEDBACK_ELIGIBILITY_HOUR = 13;

// PRICES
export const BREAKFAST_PRICE = 60;
export const LUNCH_PRICE = 120;
export const DINNER_PRICE = 120;
export const NAC_ROOM_PRICE = 700;
export const AC_ROOM_PRICE = 1100;

// STATUS
export const STATUS_WAITING = 'waiting';
export const STATUS_CONFIRMED = 'confirmed';
export const STATUS_AWAITING_CONFIRMATION = 'awaiting confirmation';
export const STATUS_CANCELLED = 'cancelled';
export const STATUS_REJECTED = 'rejected';
export const STATUS_ACTIVE = 'active';
export const STATUS_INACTIVE = 'inactive';
export const STATUS_PENDING = 'pending';
export const STATUS_APPROVED = 'approved';
export const STATUS_AVAILABLE = 'available';
export const STATUS_RESET = 'reset';
export const STATUS_TAKEN = 'taken';
export const STATUS_OPEN = 'open';
export const STATUS_CLOSED = 'closed';
export const STATUS_DELETED = 'deleted';
export const STATUS_INPROGRESS = 'in progress';
export const STATUS_ADMIN_CANCELLED = 'admin cancelled';
export const STATUS_PAYMENT_PENDING = 'pending';
export const STATUS_PROCEED_FOR_PAYMENT = 'proceed for payment';
export const STATUS_SEATSFULL_CANCELLED = 'seats full cancel';
export const STATUS_WRONGFORM_CANCELLED = 'wrong form cancel';

export const STATUS_PAYMENT_COMPLETED = 'completed';
export const STATUS_AWAITING_REFUND = 'awaiting refund';
export const STATUS_PAYMENT_AUTHORIZED = 'authorized';
export const STATUS_PAYMENT_CAPTURED = 'captured';
export const STATUS_PAYMENT_FAILED = 'failed';
export const STATUS_CASH_PENDING = 'cash pending';
export const STATUS_CASH_COMPLETED = 'cash completed';
export const STATUS_CREDITED = 'credited';
export const STATUS_ONPREM = 'onprem';
export const STATUS_OFFPREM = 'offprem';
export const STATUS_RESIDENT = 'PR';
export const STATUS_MUMUKSHU = 'MUMUKSHU';
export const STATUS_SEVA_KUTIR = 'SEVA KUTIR';
export const STATUS_GUEST = 'GUEST';

// ROOM
export const ROOM_DETAIL = 'Room Booking';
export const ROOM_WL = 'WL';
export const ROOM_STATUS_PENDING_CHECKIN = 'pending checkin';
export const ROOM_STATUS_CHECKEDIN = 'checkedin';
export const ROOM_STATUS_CHECKEDOUT = 'checkedout';
export const ROOM_STATUS_AVAILABLE = 'available';
export const ROOM_BLOCKED = 'blocked';

// TRAVEL
export const TRAVEL_DETAIL = 'Travel Booking';
export const TRAVEL_TYPE_REGULAR = 'Regular';
export const TRAVEL_TYPE_FULL = 'full';

// ADMIN ROLES
export const ROLE_SUPER_ADMIN = 'superAdmin';
export const ROLE_ROOM_ADMIN = 'roomAdmin';
export const ROLE_CARD_ADMIN = 'cardAdmin';
export const ROLE_OFFICE_ADMIN = 'officeAdmin';
export const ROLE_ADHYAYAN_ADMIN = 'adhyayanAdmin';
export const ROLE_KOL_ADHYAYAN_ADMIN = 'adhyayanAdminKol';
export const ROLE_RAJ_ADHYAYAN_ADMIN = 'adhyayanAdminRaj';
export const ROLE_DHU_ADHYAYAN_ADMIN = 'adhyayanAdminDhu';
export const ROLE_UTSAV_ADMIN = 'utsavAdmin';
export const ROLE_FOOD_ADMIN = 'foodAdmin';
export const ROLE_TRAVEL_ADMIN = 'travelAdmin';
export const ROLE_DRI_TRAVEL_ADMIN = 'travelAdminDri';
export const ROLE_ACCOUNTS_ADMIN = 'accountsAdmin';
export const ROLE_PRA_ACCOUNTS_ADMIN = 'accountsAdminPra';
export const ROLE_GATE_ADMIN = 'gateAdmin';
export const ROLE_MAINTENANCE_ADMIN = 'maintenanceAdmin';
export const ROLE_HOUSEKEEPING_ADMIN = 'housekeepingAdmin';
export const ROLE_ELECTRICAL_ADMIN = 'electricalAdmin';
export const ROLE_AVT_ADMIN = 'avtAdmin';
export const ROLE_WIFI_ADMIN = 'wifiAdmin';
export const ROLE_UTSAV_READ_ONLY = 'utsavAdminReadOnly';
export const ROLE_SMILESTONES_ADMIN = 'smilesAdmin';
export const ROLE_ADHYAYAN_READ_ONLY = 'adhyayanAdminReadOnly';

// ERROR MESSAGES
export const ERR_CARD_NOT_PROVIDED = 'Cardno not provided';
export const ERR_CARD_NOT_FOUND = 'User not found';

export const ERR_INVALID_BOOKING_TYPE = 'Invalid booking type';
export const ERR_INVALID_DATE = 'Invalid date';
export const ERR_INVALID_MEAL_TIME = 'Invalid meal time';
export const ERR_BLOCKED_DATES = 'Dates are blocked';

export const ERR_ROOM_NO_BED_AVAILABLE = 'No beds available';
export const ERR_ROOM_ALREADY_BOOKED = 'Room already booked';
export const ERR_DATES_NOT_BETWEEN_UTSAV =
  'Booking start/end date should be inclusive of Utsav Start/End date ';

export const ERR_ROOM_NOT_FOUND = 'Room not found';
export const ERR_ROOM_INVALID_DURATION = 'Invalid booking duration';
export const ERR_ROOM_FAILED_TO_BOOK = 'Failed to book a room';
export const ERR_ROOM_MUST_BE_BOOKED =
  'Must have room booked on one or more selected dates';

export const ERR_FLAT_FAILED_TO_BOOK = 'Failed to book flat';

export const ERR_ADHYAYAN_ALREADY_BOOKED = 'Adhyayan already booked';
export const ERR_ADHYAYAN_NOT_FOUND = 'Adhyayan not found';
export const ERR_ADHYAYAN_NO_SEATS_AVAILABLE =
  "Selected Raj Adhyayan doesn't have any available seats.";

export const ERR_BOOKING_NOT_FOUND = 'Booking not found';
export const ERR_BOOKING_ALREADY_CANCELLED =
  'Cannot change status of already cancelled booking';
export const ERR_TRANSACTION_NOT_FOUND = 'Booking transaction not found';

export const ERR_FOOD_ALREADY_BOOKED = 'Food already booked';
export const ERR_TRAVEL_ALREADY_BOOKED = 'Travel already booked';
export const ERR_FLAT_ALREADY_BOOKED =
  'Flat already booked for one or more mumukshus during selected dates';
export const ERR_UTSAV_ALREADY_BOOKED = 'Utsav already booked';

export const ERR_FEEDBACK_ALREADY_SUBMITTED =
  'Feedback already submitted for this adhyayan';
export const ERR_FEEDBACK_NOT_ALLOWED =
  'You are not eligible to submit feedback for this adhyayan';
export const ERR_ADHYAYAN_NOT_COMPLETED =
  'Cannot submit feedback for ongoing or future adhyayan';

export const MSG_BOOKING_SUCCESSFUL = 'Booking successful';
export const MSG_UPDATE_SUCCESSFUL = 'Update successful';
export const MSG_BOOKING_WAITING = 'Some of the bookings are in waiting list';
export const MSG_CANCEL_SUCCESSFUL = 'Booking cancelled successfully';
export const MSG_FETCH_SUCCESSFUL = 'Fetched results successfully';

export const SUBJECT_BOOKING = 'Vitraag Vigyaan Aashray: ';
export const BOOKING_STATUS_PENDING = 'pending';

export const RAJ_PRAVAS_EMAIL = 'rajpravas7@gmail.com';
