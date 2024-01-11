export const ErrorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Something went wrong';
  const data = err.data || err.stack;
  return res.status(statusCode).json({
    statusCode,
    message,
    data
  });
};
