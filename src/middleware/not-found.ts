import type { RequestHandler } from 'express';
import { AppError, errorCodes } from '../errors/app-error.js';

export const notFound: RequestHandler = (_request, _response, next) => {
  next(new AppError(404, errorCodes.NOT_FOUND, 'Requested resource was not found.'));
};
