const catchAsync = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(async (err) => {
    try {
      if (req.transaction) {
        await req.transaction.rollback();
      }
    } catch (err) {
      console.log(err);
    }
    next(err);
  });
};

export default catchAsync;
