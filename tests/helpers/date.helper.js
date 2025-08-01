const TODAY = new Date();
export function nDaysFromToday(days) {
  return addDays(TODAY, days);
}

export function addDays(date, days) {
  const newDate = new Date(date);
  newDate.setDate(date.getDate() + days);
  return newDate;
}
