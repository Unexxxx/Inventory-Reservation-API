import postgres from 'postgres';
import { getEnvironment } from '../config/env.js';

let client: ReturnType<typeof postgres> | undefined;

export function getDatabase(): ReturnType<typeof postgres> {
  if (!client) {
    client = postgres(getEnvironment().DATABASE_URL, {
      max: 3,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      transform: { undefined: null }
    });
  }
  return client;
}

export async function closeDatabase(): Promise<void> {
  if (client) {
    await client.end({ timeout: 5 });
    client = undefined;
  }
}
