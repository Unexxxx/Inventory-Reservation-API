import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError, errorCodes } from '../errors/app-error.js';

type RequestPart = 'body' | 'params' | 'query' | 'headers';

export function validate(part: RequestPart, schema: ZodTypeAny): RequestHandler {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request[part]);
    if (!result.success) {
      const fields = Object.fromEntries(
        result.error.issues.map((issue) => [issue.path.join('.') || part, issue.message])
      );
      next(new AppError(400, errorCodes.VALIDATION_ERROR, 'Request validation failed.', { fields }));
      return;
    }
    Object.defineProperty(request, part, { value: result.data, writable: true, configurable: true });
    next();
  };
}
