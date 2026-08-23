import type { ErrorRequestHandler } from 'express';
import { AppError, errorCodes } from '../errors/app-error.js';

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {})
      }
    });
    return;
  }

  console.error('Unhandled request error', error instanceof Error ? error.message : 'Unknown error');
  response.status(500).json({
    error: { code: errorCodes.INTERNAL_ERROR, message: 'An unexpected error occurred.' }
  });
};
