import { Router } from 'express';
import * as controller from '../controllers/reservations.controller.js';
import { validate } from '../middleware/validate.js';
import {
  createReservationSchema,
  idempotencyHeadersSchema,
  reservationIdParamsSchema
} from '../validation/reservations.schemas.js';

export const reservationsRouter = Router();
reservationsRouter.post(
  '/',
  validate('headers', idempotencyHeadersSchema),
  validate('body', createReservationSchema),
  controller.createReservation
);
reservationsRouter.post(
  '/:reservationId/confirm',
  validate('params', reservationIdParamsSchema),
  controller.confirmReservation
);
reservationsRouter.post(
  '/:reservationId/cancel',
  validate('params', reservationIdParamsSchema),
  controller.cancelReservation
);
