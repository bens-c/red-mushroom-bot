import { MongoClient, ObjectId } from 'mongodb';

const defaultSettings = {
  brand_name: 'Staff Team',
  brand_color: '#d93636',
  application_title: 'Staff Application',
  application_description: 'Click the button below to apply for our staff team.',
  application_question_1: 'Why do you want to join the staff team?',
  application_question_2: 'What experience do you have?',
  application_question_3: 'How much time can you contribute each week?',
  application_question_4: 'What is your timezone?',
  application_question_5: 'Why should we choose you?',
  dm_on_decision: 'true',
  moderation_enabled: 'true',
  levels_enabled: 'true',
  giveaways_enabled: 'true',
  tickets_enabled: 'true',
  backups_enabled: 'true',
  movement_template: '{user} was **{action}** by {actor}.\n**Position:** {position}\n**Reason:** {reason}',
  application_accepted_template: 'Congratulations! Your application to **{server}** was accepted.',
  application_rejected_template: 'Thank you for applying to **{server}**. Your application was not accepted this time.'
};

let client;
let settingsCollection;
let applicationsCollection;
let databaseHandle;
const settingsCache = new Map();

export const settingKeys = Object.keys(defaultSettings);

export async function initializeDatabase() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Missing MONGODB_URI. Add the MongoDB Atlas connection string to .env.');
  client = new MongoClient(uri, { appName: 'red-mushroom-discord-bot' });
  await client.connect();
  databaseHandle = client.db(process.env.MONGODB_DATABASE || 'red_mushroom_bot');
  settingsCollection = databaseHandle.collection('settings');
  applicationsCollection = databaseHandle.collection('applications');

  const savedSettings = await settingsCollection.find({}).toArray();
  for (const document of savedSettings) {
    const { _id, ...settings } = document;
    settingsCache.set(String(_id), settings);
  }

  await Promise.all([
    applicationsCollection.createIndex({ guild_id: 1, status: 1 }, { name: 'guild_status' }),
    applicationsCollection.createIndex(
      { guild_id: 1, user_id: 1, status: 1, created_at: -1 },
      { name: 'guild_user_status_created' }
    ),
    databaseHandle.collection('moderation_cases').createIndex({ guild_id: 1, user_id: 1, created_at: -1 }),
    databaseHandle.collection('levels').createIndex({ guild_id: 1, xp: -1 }),
    databaseHandle.collection('levels').createIndex({ guild_id: 1, user_id: 1 }, { unique: true }),
    databaseHandle.collection('giveaways').createIndex({ status: 1, ends_at: 1 }),
    databaseHandle.collection('tickets').createIndex({ guild_id: 1, channel_id: 1 }, { unique: true }),
    databaseHandle.collection('reminders').createIndex({ delivered: 1, due_at: 1 }),
    databaseHandle.collection('backups').createIndex({ guild_id: 1, created_at: -1 })
  ]);
}

export function getCollection(name) {
  if (!databaseHandle) throw new Error('Database has not been initialized.');
  const allowed = ['moderation_cases', 'levels', 'giveaways', 'tickets', 'reminders', 'backups', 'afk', 'custom_commands'];
  if (!allowed.includes(name)) throw new Error(`Collection ${name} is not available.`);
  return databaseHandle.collection(name);
}

function ensureInitialized() {
  if (!settingsCollection || !applicationsCollection) throw new Error('Database has not been initialized.');
}

function objectId(id) {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

export function getSetting(guildId, key) {
  return settingsCache.get(guildId)?.[key] ?? defaultSettings[key] ?? null;
}

export async function setSetting(guildId, key, value) {
  ensureInitialized();
  const normalizedValue = String(value);
  await settingsCollection.updateOne(
    { _id: guildId },
    { $set: { [key]: normalizedValue } },
    { upsert: true }
  );
  settingsCache.set(guildId, { ...(settingsCache.get(guildId) || {}), [key]: normalizedValue });
}

export async function resetSetting(guildId, key) {
  ensureInitialized();
  await settingsCollection.updateOne({ _id: guildId }, { $unset: { [key]: '' } });
  const settings = { ...(settingsCache.get(guildId) || {}) };
  delete settings[key];
  settingsCache.set(guildId, settings);
}

export function getAllSettings(guildId) {
  return { ...defaultSettings, ...(settingsCache.get(guildId) || {}) };
}

export async function createApplication(guildId, userId, answers) {
  ensureInitialized();
  const result = await applicationsCollection.insertOne({
    guild_id: guildId,
    user_id: userId,
    answers,
    status: 'pending',
    reviewer_id: null,
    review_reason: null,
    review_message_id: null,
    created_at: new Date(),
    reviewed_at: null
  });
  return result.insertedId.toString();
}

export async function setApplicationMessage(id, messageId) {
  const _id = objectId(id);
  if (!_id) return;
  await applicationsCollection.updateOne({ _id }, { $set: { review_message_id: messageId } });
}

export async function getApplication(id, guildId) {
  const _id = objectId(id);
  if (!_id) return null;
  const application = await applicationsCollection.findOne({ _id, guild_id: guildId });
  if (application) application.id = application._id.toString();
  return application;
}

export async function getPendingApplication(guildId, userId) {
  const application = await applicationsCollection.findOne(
    { guild_id: guildId, user_id: userId, status: 'pending' },
    { sort: { created_at: -1 }, projection: { _id: 1 } }
  );
  return application ? { id: application._id.toString() } : null;
}

export async function reviewApplication(id, guildId, status, reviewerId, reason) {
  const _id = objectId(id);
  if (!_id) return 0;
  const result = await applicationsCollection.updateOne(
    { _id, guild_id: guildId, status: 'pending' },
    { $set: { status, reviewer_id: reviewerId, review_reason: reason || null, reviewed_at: new Date() } }
  );
  return result.modifiedCount;
}

export async function getApplicationStats(guildId) {
  const [total, pending, accepted, rejected] = await Promise.all([
    applicationsCollection.countDocuments({ guild_id: guildId }),
    applicationsCollection.countDocuments({ guild_id: guildId, status: 'pending' }),
    applicationsCollection.countDocuments({ guild_id: guildId, status: 'accepted' }),
    applicationsCollection.countDocuments({ guild_id: guildId, status: 'rejected' })
  ]);
  return { total, pending, accepted, rejected };
}

export async function closeDatabase() {
  if (client) await client.close();
  client = null;
  settingsCollection = null;
  applicationsCollection = null;
  databaseHandle = null;
  settingsCache.clear();
}
