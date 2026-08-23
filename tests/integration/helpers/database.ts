import postgres from 'postgres';

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const integrationSql = testDatabaseUrl ? postgres(testDatabaseUrl, { max: 20, prepare: false }) : null;
const adminDatabaseUrl = process.env.TEST_DATABASE_ADMIN_URL;
const adminSql = adminDatabaseUrl ? postgres(adminDatabaseUrl, { max: 1, prepare: false }) : null;

export async function cleanDatabase(): Promise<void> {
  if (!adminSql) return;
  await adminSql`truncate table public.reservations, public.items restart identity cascade`;
}

export async function closeIntegrationDatabase(): Promise<void> {
  await integrationSql?.end({ timeout: 5 });
  await adminSql?.end({ timeout: 5 });
}
