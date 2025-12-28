import { randomUUID } from 'crypto';

function createRequestLogger(enabled) {
  if (!enabled) {
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
      const log = {
        level: 'info',
        msg: 'request_complete',
        requestId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip: req.ip,
      };
      console.log(JSON.stringify(log));
    });

    next();
  };
}

export {
  createRequestLogger,
};
