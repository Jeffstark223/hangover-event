const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { ApiError } = require('../utils/apiError');

/**
 * Protects admin-only routes. Expects `Authorization: Bearer <token>`.
 * Tokens are issued by POST /api/admin/auth/login.
 */
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed authorization header.'));
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.admin = { id: payload.sub, email: payload.email, name: payload.name };
    return next();
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired session. Please log in again.'));
  }
}

module.exports = { requireAdmin };
