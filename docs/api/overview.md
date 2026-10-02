# API Overview

## Base URL

All API endpoints are prefixed with `/api/v1/`. The server listens on the port defined by the `PORT` environment variable (default `3000`).

```
http://localhost:3000/api/v1/
```

## Utility Endpoints

| Endpoint          | Description                                                   |
| ----------------- | ------------------------------------------------------------- |
| `GET /api`        | Returns `{"data": "API is up and running...", "status": 200}` |
| `GET /api/health` | Database health check with connection pool status             |

## Route Organization

Routes are organized by audience and domain:

| Prefix                  | Audience         | Auth                      |
| ----------------------- | ---------------- | ------------------------- |
| `/api/v1/client/*`      | Mobile app users | `validateCard`            |
| `/api/v1/stay/*`        | Mobile app users | `validateCard`            |
| `/api/v1/food/*`        | Mobile app users | `validateCard`            |
| `/api/v1/travel/*`      | Mobile app users | `validateCard`            |
| `/api/v1/adhyayan/*`    | Mobile app users | `validateCard`            |
| `/api/v1/utsav/*`       | Mobile app users | `validateCard`            |
| `/api/v1/maintenance/*` | Mobile app users | `validateCard`            |
| `/api/v1/profile/*`     | Mobile app users | `validateCard`            |
| `/api/v1/wifi/*`        | Mobile app users | `validateCard`            |
| `/api/v1/razorpay/*`    | Mixed            | Partial                   |
| `/api/v1/support/*`     | Mobile app users | `validateCard`            |
| `/api/v1/guest/*`       | Mobile app users | `validateCard`            |
| `/api/v1/mumukshu/*`    | Mobile app users | `validateCard`            |
| `/api/v1/unified/*`     | Deprecated       | `validateCard`            |
| `/api/v1/location/*`    | Public           | None                      |
| `/api/v1/updates/*`     | Public           | None                      |
| `/api/v1/admin/*`       | Admin website    | `auth` + `authorizeRoles` |

## Common Request Headers

### Client (Mobile App) Requests

```
Content-Type: application/json
```

The `cardno` is passed in the request body, query string, or URL parameters. No `Authorization` header is needed for client routes.

### Admin (Website) Requests

```
Content-Type: application/json
Authorization: Bearer <jwt_token>
```

The JWT token is obtained from `POST /api/v1/admin/auth/login`.

## Response Format

### Success Response

```json
{
  "message": "Fetched results successfully",
  "data": { ... }
}
```

The `data` field varies by endpoint. It can be an object, array, or primitive value.

### Paginated Response

Some endpoints support pagination via `page` and `page_size` query parameters (or in the request body):

```json
{
  "message": "Fetched results successfully",
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "pageSize": 10,
    "totalCount": 42,
    "totalPages": 5,
    "hasMore": true
  }
}
```

Default page size varies by endpoint, commonly 10 or 20.

### Error Response

```json
{
  "statusCode": 400,
  "message": "Error description",
  "data": "Stack trace or additional error details"
}
```

See [Error Handling](../architecture/error-handling.md) for details.

## Pagination

Pagination is not standardized across all endpoints. Endpoints that support it accept:

- `page` -- Page number (1-based)
- `page_size` or `pageSize` -- Items per page

These are passed as query parameters or in the request body, depending on the endpoint.

> TODO (NEEDS FIX ⚠️): This needs implementation on admin side as none of the admin endpoints are paginated.

## Rate Limiting

There is no rate limiting configured at the application level. CORS is set to allow all origins (`origin: '*'`).

## File Uploads

Endpoints that accept file uploads use `multipart/form-data` via `multer`:

- **Profile picture:** `POST /api/v1/profile/upload` (uploaded to S3)
- **Excel files:** Various admin endpoints for bulk operations (WiFi codes, settlements, menus, room numbers) -- processed in memory via `multer` memory storage

## Deprecated Endpoints

The unified booking routes return HTTP 410 Gone:

- `POST /api/v1/unified/booking` -- returns `{ message: "This endpoint is deprecated..." }`
- `POST /api/v1/unified/validate` -- returns `{ message: "This endpoint is deprecated..." }`
