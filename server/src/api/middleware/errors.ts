import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { CommandError } from '../../devices/Device.js';
import { AlertError } from '../../engine/AlertManager.js';
import { RuleNotFoundError } from '../../engine/AutomationEngine.js';

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: unknown) {
    super(message);
  }
}

/** Parse + validate, throwing a 400 with field-level details on failure. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Validation failed', formatZod(r.error));
  return r.data;
}

export function formatZod(err: ZodError) {
  return err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}

/** Wrap async route handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };

export function errorHandler(onServerError: (err: unknown, req: Request) => void) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    if (err instanceof CommandError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'OFFLINE' ? 409 : 422;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof AlertError) {
      res.status(err.code === 'NOT_FOUND' ? 404 : 409).json({ error: err.message });
      return;
    }
    if (err instanceof RuleNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof RangeError) {
      res.status(422).json({ error: err.message });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
    onServerError(err, req);
    res.status(500).json({ error: 'Internal server error' });
  };
}
