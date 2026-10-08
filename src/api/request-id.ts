import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Injectable, type NestMiddleware } from '@nestjs/common';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Accept a caller's ID only if it is short and log-safe; otherwise generate one. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

type RequestWithId = IncomingMessage & { id?: unknown };

/**
 * Returns the request's ID, assigning one on first use: the X-Request-Id header if
 * present and safe, otherwise a new UUID. Echoes it in the response header.
 */
export function assignRequestId(req: RequestWithId, res: ServerResponse): string {
  if (typeof req.id === 'string') {
    return req.id;
  }
  const header = req.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  req.id = id;
  if (!res.headersSent) {
    res.setHeader(REQUEST_ID_HEADER, id);
  }
  return id;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: ServerResponse, next: () => void): void {
    assignRequestId(req, res);
    next();
  }
}
