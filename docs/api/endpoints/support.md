# Support

Support ticket creation for mobile app users.

**Base path:** `/api/v1/support`
**Auth:** `validateCard` on all routes

## POST /

Create a new support ticket.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "service": "Room Booking",
  "issue": "Unable to check in to room A101, showing pending status even though payment is completed."
}
```

**Success response (200):**
```json
{
  "message": "Ticket created successfully",
  "data": {
    "id": 42
  }
}
```

> Note: Email notification to the support team is currently commented out in the codebase. Tickets are stored in the database but no automatic notification is sent.
