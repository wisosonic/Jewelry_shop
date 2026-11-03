/**
 * Domain error carrying an HTTP status code and optional structured details,
 * caught by {@link errorHandler} and translated directly into a response.
 * Use the static factories rather than the constructor at call sites.
 */
export class AppError extends Error {
  statusCode: number;
  details?: unknown;

  /** Creates an AppError with an explicit status code and message. */
  constructor(statusCode: number, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }

  /** 400 Bad Request, e.g. failed input validation. */
  static badRequest(message: string, details?: unknown) {
    return new AppError(400, message, details);
  }
  /** 401 Unauthorized, e.g. missing/invalid credentials or token. */
  static unauthorized(message = "Unauthorized") {
    return new AppError(401, message);
  }
  /** 403 Forbidden, e.g. authenticated but lacking the required role. */
  static forbidden(message = "Forbidden") {
    return new AppError(403, message);
  }
  /** 404 Not Found, e.g. a requested resource doesn't exist. */
  static notFound(message = "Not found") {
    return new AppError(404, message);
  }
  /** 409 Conflict, e.g. a uniqueness constraint or state conflict. */
  static conflict(message: string) {
    return new AppError(409, message);
  }
  /** 429 Too Many Requests, e.g. rate limiting or a resend cooldown. */
  static tooManyRequests(message: string, details?: unknown) {
    return new AppError(429, message, details);
  }
}
