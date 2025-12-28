import { forbidden } from './http-errors.js';

function normalizeIp(ip) {
  if (!ip) {
    return '';
  }
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

function createIpAllowlistMiddleware(allowedIps, enabled) {
  if (!enabled || !Array.isArray(allowedIps) || allowedIps.length === 0) {
    return (req, res, next) => next();
  }

  const allowed = new Set(allowedIps.map(normalizeIp));

  return (req, res, next) => {
    const ip = normalizeIp(req.ip);
    if (allowed.has(ip)) {
      return next();
    }
    return next(forbidden('IP address is not allowed'));
  };
}

export {
  createIpAllowlistMiddleware,
};
