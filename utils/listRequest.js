// A request that sends none of a controller's list keys comes from the old
// staff panel, which expects a plain array in `data`. Each controller passes
// the keys it reads, so adding a key to one report does not change another.
export const isLegacyListRequest = (query, keys) =>
  keys.every((key) => query[key] === undefined);
