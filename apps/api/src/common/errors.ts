import type { ErrorCode } from '@jotion/shared';

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  setup_required: 409,
  already_set_up: 409,
  invalid_credentials: 401,
  token_invalid: 400,
  cycle: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal: 500,
};

/** Fachlicher Fehler mit stabilem Code. Wird vom Exception-Filter in { error } übersetzt. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = 'Ressource') => new AppError('not_found', `${what} nicht gefunden`);
export const forbidden = (message = 'Keine Berechtigung') => new AppError('forbidden', message);
