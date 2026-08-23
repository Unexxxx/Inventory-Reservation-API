import type { NextFunction, Request, Response } from 'express';
import * as itemsService from '../services/items.service.js';

export async function createItem(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(201).json(await itemsService.createItem(request.body.initialQuantity as number));
  } catch (error) { next(error); }
}

export async function getItemInventory(request: Request, response: Response, next: NextFunction): Promise<void> {
  try {
    response.status(200).json(await itemsService.getItemInventory(request.params.itemId as string));
  } catch (error) { next(error); }
}
