# Profile (Client)

User profile management, transactions, and notifications.

**Base path:** `/api/v1/profile`
**Auth:** `validateCard` on all routes

## GET /

Fetch user profile data.

**Query params:**
- `cardno` (required)

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": {
    "cardno": "RCOF1234",
    "issuedto": "John Doe",
    "gender": "M",
    "mobno": 9876543210,
    "email": "john@example.com",
    "address": "123 Main St",
    "country": "India",
    "state": "Maharashtra",
    "city": "Mumbai",
    "center": "Research Centre",
    "pfp": "https://bucket.s3.region.amazonaws.com/RCOF1234/photo.jpg",
    "status": "onprem",
    "res_status": "PR",
    "isFlatOwner": false
  }
}
```

The `isFlatOwner` flag is computed by checking if the user owns any flats.

---

## PUT /

Update user profile details.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "email": "newemail@example.com",
  "address": "456 New St",
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
}
```

The `token` field stores the Expo push notification token for the mobile app.

---

## POST /upload

Upload a profile picture to S3.

**Content-Type:** `multipart/form-data`

**Form data:**
- `cardno` -- User's card number
- `pfp` -- Image file (validated for image mimetype)

**Success response (200):**
```json
{
  "message": "Upload successful",
  "data": {
    "url": "https://bucket.s3.region.amazonaws.com/RCOF1234/1711843200-photo.jpg"
  }
}
```

**Side effects:**
- Deletes the previous profile picture from S3 (if one exists)
- Updates the `pfp` field on the card record

---

## GET /transactions

Fetch transaction history for the user.

**Query params:**
- `cardno` (required)
- `page` -- Page number
- `page_size` -- Items per page
- `status` -- Filter by transaction status
- `category` -- Filter by category (room, food, adhyayan, travel, utsav)

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    {
      "id": 42,
      "bookingid": "uuid-string",
      "category": "room",
      "amount": 1100,
      "status": "completed",
      "description": "Room Booking",
      "createdAt": "2026-04-01T10:00:00.000Z",
      "booking": {
        "checkin": "2026-04-01",
        "checkout": "2026-04-02",
        "roomno": "A101"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalCount": 15,
    "totalPages": 2,
    "hasMore": true
  }
}
```

Uses a complex SQL query that joins multiple booking tables (room, flat, travel, shibir, utsav) to attach booking details to each transaction.

---

## POST /notification

Send a push notification to the user's device.

**Request body:**
```json
{
  "cardno": "RCOF1234",
  "title": "Notification Title",
  "body": "Notification message body"
}
```

Uses Expo push notification service. Requires the user to have a valid push token stored in their profile.
