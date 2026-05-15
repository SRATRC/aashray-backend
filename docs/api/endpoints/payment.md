# Payment (Razorpay)

Payment processing endpoints for Razorpay integration.

**Base path:** `/api/v1/razorpay`

## POST /verifyPayment

Razorpay webhook endpoint for payment status callbacks.

**Auth:** None (verified via Razorpay webhook secret)

This endpoint receives webhook events from Razorpay when a payment status changes. It is not called directly by the client apps.

**Processing logic:**
1. Receives webhook payload with payment status
2. Logs the event to `razorpay_webhook` table
3. Updates transaction status based on payment status:
   - `captured` -> marks transactions as `completed`, updates booking status to `pending checkin` (rooms/flats) or `confirmed` (other types)
   - `failed` -> marks transactions as `failed`
   - `authorized` -> marks transactions as `authorized`
4. Sends unified booking confirmation email on successful capture

**Webhook payload fields used:**
- `payload.payment.entity.order_id` -- Maps to `razorpay_order_id` in transactions table
- `payload.payment.entity.id` -- Razorpay payment ID
- `payload.payment.entity.status` -- Payment status

---

## POST /pay

Create a Razorpay order for pending payment transactions.

**Auth:** `validateCard`

**Request body:**
```json
{
  "cardno": "RCOF1234"
}
```

Fetches all pending transactions for the user, calculates the total amount, and creates a Razorpay order.

**Success response (200):**
```json
{
  "message": "Order created",
  "data": {
    "orderId": "order_NkZmVh7JXXX",
    "amount": 330000,
    "currency": "INR"
  }
}
```

> Note: Amount is in paise (multiply rupees by 100). An order of 3300 INR becomes 330000 paise.

---

## POST /payv2

Enhanced version of the pay endpoint with category filtering.

**Auth:** `validateCard`

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "categories": ["room", "food"]
}
```

Creates a Razorpay order for pending transactions filtered by specific categories. This allows users to pay for specific booking types rather than all pending transactions at once.

**Success response (200):**
```json
{
  "message": "Order created",
  "data": {
    "orderId": "order_NkZmVh7JXXX",
    "amount": 220000,
    "currency": "INR"
  }
}
```
