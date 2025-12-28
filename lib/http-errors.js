class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function badRequest(message, details) {
  return new HttpError(400, message, details);
}

function unauthorized(message) {
  return new HttpError(401, message || 'Unauthorized');
}

function forbidden(message) {
  return new HttpError(403, message || 'Forbidden');
}

function notFound(message) {
  return new HttpError(404, message || 'Not found');
}

export {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
};
