const getDates = (start_date, end_date) => {
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  const dateArray = [];
  // Step in UTC, the same clock formatDate reads. Local-time stepping skips a
  // day across a daylight-saving change on a server in such a zone.
  let currentDate = startDate;

  const formatDate = (date) => {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  while (currentDate <= endDate) {
    dateArray.push(formatDate(currentDate));
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  return dateArray;
};

// TO GET NO OF DAYS
// const days = moment(end_date).diff(moment(start_date), 'days');
// console.log(days);

export default getDates;
