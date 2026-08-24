import { getDatabase } from '../client.js';
import type { ItemInventory } from '../../types/domain.js';

export async function createItem(name: string, totalQuantity: number): Promise<ItemInventory> {
  const sql = getDatabase();
  const [row] = await sql<{ result: ItemInventory }[]>`
    select public.create_item_atomic(${name}::text, ${totalQuantity}::bigint) as result
  `;
  if (!row) throw new Error('create_item_atomic returned no result');
  return row.result;
}

export async function getItemInventory(itemId: string): Promise<ItemInventory | null> {
  const sql = getDatabase();
  const [row] = await sql<{ result: ItemInventory | null }[]>`
    select public.get_item_inventory(${itemId}::uuid) as result
  `;
  return row?.result ?? null;
}
