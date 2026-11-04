export class HttpError extends Error {
  constructor(status, message, code = 'error', details = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends HttpError {
  constructor(message, details = undefined) {
    super(400, message, 'validation_error', details);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'دسترسی مجاز نیست.') {
    super(403, message, 'forbidden');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'موردی یافت نشد.') {
    super(404, message, 'not_found');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends HttpError {
  constructor(message, code = 'conflict') {
    super(409, message, code);
    this.name = 'ConflictError';
  }
}

export function toPublicError(err) {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.code, message: err.message, details: err.details } };
  }
  return { status: 500, body: { error: 'internal_error', message: 'خطای داخلی سامانه رخ داد.' } };
}
