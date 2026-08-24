import { Router } from 'express';
import { itemsRouter } from './items.routes.js';
import { reservationsRouter } from './reservations.routes.js';
import * as reservationsController from '../controllers/reservations.controller.js';
import { validate } from '../middleware/validate.js';
import { expireReservationsSchema } from '../validation/reservations.schemas.js';

export const apiRouter = Router();

apiRouter.use('/v1/items', itemsRouter);
apiRouter.use('/v1/reservations', reservationsRouter);
apiRouter.post(
  '/v1/maintenance/expire-reservations',
  validate('body', expireReservationsSchema),
  reservationsController.expireReservations
);
