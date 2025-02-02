export const TYPE_EXPENSE = 'expense';
export const TYPE_REFUND = 'refund';
export const TYPE_ROOM = 'room';
export const TYPE_GUEST_ROOM = 'guest_room';
export const TYPE_FLAT = 'flat';
export const TYPE_GUEST_FLAT = 'guest_flat';
export const TYPE_FOOD = 'food';
export const TYPE_GUEST_FOOD = 'guest_food';
export const TYPE_TRAVEL = 'travel';
export const TYPE_ADHYAYAN = 'adhyayan';
export const TYPE_GUEST_ADHYAYAN = 'guest_adhyayan';
export const TYPE_UTSAV = 'utsav';
export const TYPE_GUEST_UTSAV = 'guest_utsav';
export const TRANSACTION_TYPE_UPI = 'upi';
export const TRANSACTION_TYPE_CASH = 'cash';

// PRICES
export const BREAKFAST_PRICE = 50;
export const LUNCH_PRICE = 100;
export const DINNER_PRICE = 100;
export const NAC_ROOM_PRICE = 400;
export const AC_ROOM_PRICE = 600;
export const TRAVEL_PRICE = 350;
export const FULL_TRAVEL_PRICE = 2300;
export const RAZORPAY_FEE = 0.005; // 0.5%

// STATUS
export const STATUS_WAITING = 'waiting';
export const STATUS_CONFIRMED = 'confirmed';
export const STATUS_CANCELLED = 'cancelled';
export const STATUS_REJECTED = 'rejected';
export const STATUS_ACTIVE = 'active';
export const STATUS_INACTIVE = 'inactive';
export const STATUS_AVAILABLE = 'available';
export const STATUS_TAKEN = 'taken';
export const STATUS_OPEN = 'open';
export const STATUS_CLOSED = 'closed';
export const STATUS_ADMIN_CANCELLED = 'admin cancelled';
export const STATUS_PAYMENT_PENDING = 'pending';
export const STATUS_PAYMENT_COMPLETED = 'completed';
export const STATUS_AWAITING_REFUND = 'awaiting refund';
export const STATUS_CASH_PENDING = 'cash pending';
export const STATUS_CASH_COMPLETED = 'cash completed';
export const STATUS_CREDITED = 'credited';
export const STATUS_ONPREM = 'onprem';
export const STATUS_OFFPREM = 'offprem';
export const STATUS_RESIDENT = 'PR';
export const STATUS_MUMUKSHU = 'MUMUKSHU';
export const STATUS_SEVA_KUTIR = 'SEVA KUTIR';
export const STATUS_GUEST = 'guest';

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
export const TRAVEL_TYPE_SINGLE = 'single';
export const TRAVEL_TYPE_FULL = 'full';

// ADMIN ROLES
export const ROLE_SUPER_ADMIN = 'superAdmin';
export const ROLE_OFFICE_ADMIN = 'officeAdmin';
export const ROLE_ADHYAYAN_ADMIN = 'adhyayanAdmin';
export const ROLE_UTSAV_ADMIN = 'utsavAdmin';
export const ROLE_FOOD_ADMIN = 'foodAdmin';
export const ROLE_TRAVEL_ADMIN = 'travelAdmin';

// ERROR MESSAGES
export const ERR_CARD_NOT_PROVIDED = 'Cardno not provided';
export const ERR_CARD_NOT_FOUND = 'Card does not exist';

export const ERR_INVALID_BOOKING_TYPE = 'Invalid booking type';
export const ERR_INVALID_DATE = 'Invalid date';
export const ERR_INVALID_MEAL_TIME = 'Invalid meal time';
export const ERR_BLOCKED_DATES = 'Dates are blocked';

export const ERR_ROOM_NO_BED_AVAILABLE = 'No beds available';
export const ERR_ROOM_ALREADY_BOOKED = 'Room already booked';
export const ERR_ROOM_NOT_FOUND = 'Room not found';
export const ERR_ROOM_INVALID_DURATION = 'Invalid booking duration';
export const ERR_ROOM_FAILED_TO_BOOK = 'Failed to book a room';
export const ERR_ROOM_MUST_BE_BOOKED =
  'Must have room booked on one or more selected dates';

export const ERR_ADHYAYAN_ALREADY_BOOKED = 'Adhyayan already booked';
export const ERR_ADHYAYAN_NOT_FOUND = 'Adhyayan not found';
export const ERR_ADHYAYAN_NO_SEATS_AVAILABLE = 'Selected Raj Adhyayan doesn\'t have any available seats.';

export const ERR_BOOKING_NOT_FOUND = 'Booking not found';
export const ERR_BOOKING_ALREADY_CANCELLED = 'Cannot change status of already cancelled booking';
export const ERR_TRANSACTION_NOT_FOUND = 'Booking transaction not found';

export const ERR_FOOD_ALREADY_BOOKED = 'Food already booked';
export const ERR_TRAVEL_ALREADY_BOOKED = 'Travel already booked';
export const ERR_FLAT_ALREADY_BOOKED = 'Flat already booked';

export const MSG_BOOKING_SUCCESSFUL = 'Booking successful';
export const MSG_UPDATE_SUCCESSFUL = 'Update successful';
export const MSG_CANCEL_SUCCESSFUL = 'Cancel successful';
