// A request that sends none of a controller's list keys comes from the old
// staff panel, which expects a plain array in `data`. Each controller passes
// the keys it reads, so adding a key to one report does not change another.
export const isLegacyListRequest = (query, keys) =>
  keys.every((key) => query[key] === undefined);

// A non-legacy request with no `page` (the staff panel export) gets the whole
// filtered set, but never more than this many rows. Env override is for tests.
export const MAX_UNPAGED_ROWS =
  parseInt(process.env.MAX_UNPAGED_ROWS, 10) > 0
    ? parseInt(process.env.MAX_UNPAGED_ROWS, 10)
    : 10000;

// Escape `\`, `%` and `_` so a search term matches those characters literally
// inside a LIKE pattern.
export const escapeLike = (term) => String(term).replace(/[\\%_]/g, '\\$&');
