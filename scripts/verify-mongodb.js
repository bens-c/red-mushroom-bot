import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import * as database from '../src/database.js';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before running this verification.');
const guildId = `verification-${crypto.randomUUID()}`;

try {
  await database.initializeDatabase();
  await database.setSetting(guildId, 'brand_name', 'Verification Team');
  const id = await database.createApplication(guildId, 'verification-user', [
    { question: 'Database check', answer: 'Connected' }
  ]);
  const reviewed = await database.reviewApplication(id, guildId, 'accepted', 'verification-reviewer', 'Automated check');
  if (reviewed !== 1 || (await database.getApplication(id, guildId))?.status !== 'accepted') {
    throw new Error('Atomic application review verification failed.');
  }
  console.log('MongoDB read/write and atomic review verification passed.');
} finally {
  await database.closeDatabase();
  const cleanupClient = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  try {
    await cleanupClient.connect();
    const targetDatabase = cleanupClient.db(process.env.MONGODB_DATABASE || 'red_mushroom_bot');
    await targetDatabase.collection('settings').deleteMany({ _id: guildId });
    await targetDatabase.collection('applications').deleteMany({ guild_id: guildId });
  } finally {
    await cleanupClient.close();
  }
}
