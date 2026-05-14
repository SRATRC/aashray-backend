# Location

Geographic reference data endpoints. Available on both client and admin paths with the same implementation.

**Base paths:** `/api/v1/location` (client) and `/api/v1/admin/location` (admin)
**Auth:** None (public endpoints)

## GET /countries

Fetch all countries.

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    { "key": 1, "value": "INDIA" },
    { "key": 2, "value": "USA" }
  ]
}
```

Returns data formatted as key/value pairs for dropdown consumption.

---

## GET /states/:country

Fetch states for a country.

**Path params:**
- `country` -- Country name

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    { "key": 1, "value": "Maharashtra" },
    { "key": 2, "value": "Gujarat" }
  ]
}
```

---

## GET /cities/:country/:state

Fetch cities for a country and state.

**Path params:**
- `country` -- Country name
- `state` -- State name

---

## GET /centres

Fetch all ashram centres.

**Success response (200):**
```json
{
  "message": "Fetched results successfully",
  "data": [
    { "id": 1, "name": "Research Centre" },
    { "id": 2, "name": "Kolkata Centre" }
  ]
}
```

---

## POST /

Bulk insert location data (countries, states, cities) from a JSON file.

This is a setup/migration endpoint, not typically called in normal operation.
