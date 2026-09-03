import 'dotenv/config';
import { closeDatabase, initializeDatabase } from './database.js';
import { startWebPortal, stopWebPortal } from './web-portal.js';

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; stopping web portal.`);
  await stopWebPortal().catch(error => console.error('Web server shutdown failed:', error));
  await closeDatabase().catch(error => console.error('Database shutdown failed:', error));
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await initializeDatabase();
  console.log(`Web portal connected to MongoDB database ${process.env.MONGODB_DATABASE || 'red_mushroom_bot'}.`);
  startWebPortal();
} catch (error) {
  console.error('Web portal startup failed:', error.message);
  await closeDatabase();
  process.exit(1);
}
