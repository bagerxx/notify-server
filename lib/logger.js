import { randomUUID } from 'crypto';
import { COLORS, colorize } from './console-colors.js';

function statusColor(status) {
  if (status >= 500) return COLORS.red;
  if (status >= 400) return COLORS.yellow;
  if (status >= 300) return COLORS.cyan;
  return COLORS.green;
}

function methodColor(method) {
  switch (method) {
    case 'GET':
      return COLORS.cyan;
    case 'POST':
      return COLORS.magenta;
    case 'PUT':
      return COLORS.yellow;
    case 'DELETE':
      return COLORS.red;
    case 'PATCH':
      return COLORS.blue;
    default:
      return COLORS.gray;
  }
}

function levelColor(level) {
  if (level === 'ERROR') return COLORS.red;
  if (level === 'WARN') return COLORS.yellow;
  return COLORS.green;
}

function resolveMode(mode) {
  if (mode === false || mode === 'false') return 'off';
  if (mode === 'errors') return 'errors';
  return 'all';
}

function createRequestLogger(mode) {
  const resolved = resolveMode(mode);
  if (resolved === 'off') {
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : randomUUID();

    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);

    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const status = res.statusCode;
      const path = req.path;

      if (path === '/health' && status < 400) {
        return;
      }
      if (resolved === 'errors' && status < 400) {
        return;
      }

      const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
      const time = new Date().toISOString().slice(11, 19);
      const line = [
        colorize(time, COLORS.gray),
        colorize(level, levelColor(level)),
        colorize(String(status), statusColor(status)),
        colorize(req.method, methodColor(req.method)),
        path,
        colorize(`${durationMs.toFixed(0)}ms`, COLORS.gray),
      ].join(' ');

      if (level === 'ERROR') {
        console.error(line);
      } else {
        console.log(line);
      }
    });

    next();
  };
}

export {
  createRequestLogger,
};
