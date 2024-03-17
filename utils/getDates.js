const getDates = (start_date, end_date) => {
  const startDate = new Date(start_date);
  const endDate = new Date(end_date);

  const dateArray = [];
  let currentDate = startDate;

  const formatDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  while (currentDate <= endDate) {
    dateArray.push(formatDate(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return dateArray;
};

// TO GET NO OF DAYS
// const days = moment(end_date).diff(moment(start_date), 'days');
// console.log(days);

export default getDates;
