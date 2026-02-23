export function nowIso() {
  return new Date().toISOString();
}

export function isDateWithinRange(dateInput, startInclusive, endInclusiveOrNull) {
  const date = new Date(dateInput);
  const start = new Date(startInclusive);
  const end = endInclusiveOrNull ? new Date(endInclusiveOrNull) : null;
  if (Number.isNaN(date.getTime()) || Number.isNaN(start.getTime())) {
    return false;
  }
  if (date < start) {
    return false;
  }
  if (end && date > end) {
    return false;
  }
  return true;
}

export function toDateKey(dateInput) {
  const d = new Date(dateInput);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString().slice(0, 10);
}
