import { Router } from 'express';
import * as controller from '../controllers/items.controller.js';
import { validate } from '../middleware/validate.js';
import { createItemSchema, itemIdParamsSchema } from '../validation/items.schemas.js';

export const itemsRouter = Router();
itemsRouter.post('/', validate('body', createItemSchema), controller.createItem);
itemsRouter.get('/:itemId', validate('params', itemIdParamsSchema), controller.getItemInventory);
