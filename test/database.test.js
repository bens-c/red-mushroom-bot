import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'red-mushroom-bot-'));
process.env.DATABASE_PATH = path.join(testDirectory, 'test.sqlite');
const database = await import('../src/database.js');

after(() => {
  database.closeDatabase();
  fs.rmSync(testDirectory, { recursive: true, force: true });
});

test('stores server-specific configuration', () => {
  assert.equal(database.getSetting('guild-a', 'brand_name'), 'Staff Team');
  database.setSetting('guild-a', 'brand_name', 'Test Team');
  assert.equal(database.getSetting('guild-a', 'brand_name'), 'Test Team');
  assert.equal(database.getSetting('guild-b', 'brand_name'), 'Staff Team');
  database.resetSetting('guild-a', 'brand_name');
  assert.equal(database.getSetting('guild-a', 'brand_name'), 'Staff Team');
});

test('creates and atomically reviews applications', () => {
  const id = database.createApplication('guild-a', 'applicant', [
    { question: 'Why?', answer: 'Because.' }
  ]);
  assert.equal(database.getPendingApplication('guild-a', 'applicant').id, id);
  assert.equal(database.reviewApplication(id, 'guild-a', 'accepted', 'reviewer', 'Strong answer'), 1);
  assert.equal(database.reviewApplication(id, 'guild-a', 'rejected', 'reviewer-2', 'Too late'), 0);
  assert.equal(database.getApplication(id, 'guild-a').status, 'accepted');
  assert.deepEqual(database.getApplicationStats('guild-a'), {
    total: 1,
    pending: 0,
    accepted: 1,
    rejected: 0
  });
});
