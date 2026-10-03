// ISO string -> Date. `null` and `undefined` pass through: `null` clears a value and `undefined`
// leaves it untouched.
export const toDate = (isoString) =>
  isoString === undefined || isoString === null ? isoString : new Date(isoString);
