const logger = require('../utils/logger');
const { ApiError } = require('../utils/apiError');

function notFoundHandler(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const statusCode = err instanceof ApiError ? err.statusCode : err.statusCode || 500;

  if (statusCode >= 500) {
    logger.error(err.message, err.stack);
  } else {
    logger.warn(err.message);
  }

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error.',
    ...(err.details ? { details: err.details } : {}),
  });
}

module.exports = { notFoundHandler, errorHandler };
