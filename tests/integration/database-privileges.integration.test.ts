import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

const runtimeUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!runtimeUrl)('runtime database privileges', () => {
  it('rejects direct DML and permits approved functions', async () => {
    const sql = postgres(runtimeUrl!, { prepare: false });
    await expect(sql`insert into public.items(total_quantity) values (1)`).rejects.toThrow();
    const [row] = await sql<{ result: { totalQuantity: number } }[]>`select public.create_item_atomic(1) result`;
    expect(row?.result.totalQuantity).toBe(1);
    await sql.end();
  });

  it('has no mutation-function execute grant for PUBLIC', async () => {
    const sql = postgres(runtimeUrl!, { prepare: false });
    const [row] = await sql<{ allowed: boolean }[]>`
      select has_function_privilege('public', 'public.create_item_atomic(bigint)', 'execute') allowed`;
    expect(row?.allowed).toBe(false);
    await sql.end();
  });
});
