import app from './app.js';
import { getEnvironment } from './config/env.js';
import { closeDatabase } from './db/client.js';

const { PORT } = getEnvironment();
const server = app.listen(PORT, () => console.log(`Inventory API listening on port ${PORT}`));

async function shutdown(): Promise<void> {
  server.close(async () => {
    await closeDatabase();
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
