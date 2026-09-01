import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { MongoClient } from 'mongodb';

const integrationUri = process.env.MONGODB_TEST_URI;

test('provides defaults before a server has saved configuration', async () => {
  const database = await import('../src/database.js');
  assert.equal(database.getSetting('new-guild', 'brand_name'), 'Staff Team');
});

test('stores configuration and atomically reviews applications in MongoDB', { skip: !integrationUri }, async () => {
  process.env.MONGODB_URI = integrationUri;
  process.env.MONGODB_DATABASE ||= 'red_mushroom_bot';
  const database = await import('../src/database.js');
  const guildId = `test-${crypto.randomUUID()}`;

  await database.initializeDatabase();
  try {
    await database.setSetting(guildId, 'brand_name', 'Test Team');
    assert.equal(database.getSetting(guildId, 'brand_name'), 'Test Team');
    await database.resetSetting(guildId, 'brand_name');
    assert.equal(database.getSetting(guildId, 'brand_name'), 'Staff Team');

    const id = await database.createApplication(guildId, 'applicant', [
      { question: 'Why?', answer: 'Because.' }
    ]);
    assert.equal((await database.getPendingApplication(guildId, 'applicant')).id, id);
    assert.equal(await database.reviewApplication(id, guildId, 'accepted', 'reviewer', 'Strong answer'), 1);
    assert.equal(await database.reviewApplication(id, guildId, 'rejected', 'reviewer-2', 'Too late'), 0);
    assert.equal((await database.getApplication(id, guildId)).status, 'accepted');
    assert.deepEqual(await database.getApplicationStats(guildId), {
      total: 1,
      pending: 0,
      accepted: 1,
      rejected: 0
    });
    await database.getCollection('levels').updateOne(
      { guild_id: guildId, user_id: 'applicant' },
      { $set: { xp: 250 } },
      { upsert: true }
    );
    assert.equal((await database.getCollection('levels').findOne({ guild_id: guildId })).xp, 250);
  } finally {
    await database.closeDatabase();
    const cleanupClient = new MongoClient(integrationUri);
    try {
      await cleanupClient.connect();
      const targetDatabase = cleanupClient.db(process.env.MONGODB_DATABASE);
    await Promise.all([
      targetDatabase.collection('settings').deleteMany({ _id: guildId }),
      targetDatabase.collection('applications').deleteMany({ guild_id: guildId }),
      targetDatabase.collection('levels').deleteMany({ guild_id: guildId })
      ]);
    } finally {
      await cleanupClient.close();
    }
  }
});
