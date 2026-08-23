import { Router } from 'express';
import { itemsRouter } from './items.routes.js';
import { reservationsRouter } from './reservations.routes.js';

export const apiRouter = Router();
apiRouter.use('/items', itemsRouter);
apiRouter.use('/reservations', reservationsRouter);
