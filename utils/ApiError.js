class ApiError extends Error {
  constructor(statusCode, message, data) {
    super();
    this.statusCode = statusCode;
    this.message = message;
    if (data) {
      this.data = data;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export default ApiError;
