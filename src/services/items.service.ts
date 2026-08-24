import * as itemsRepository from '../db/repositories/items.repository.js';
import { AppError, errorCodes } from '../errors/app-error.js';
import type { ItemInventory } from '../types/domain.js';

export function createItem(name: string, initialQuantity: number): Promise<ItemInventory> {
  return itemsRepository.createItem(name, initialQuantity);
}

export async function getItemInventory(itemId: string): Promise<ItemInventory> {
  const item = await itemsRepository.getItemInventory(itemId);
  if (!item) throw new AppError(404, errorCodes.NOT_FOUND, 'Requested item was not found.');
  return item;
}
