import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import express from 'express';
import helmet from 'helmet';
import { getAllSettings, getCollection, setSetting } from './database.js';

const ChannelType = { GuildText: 0, GuildCategory: 4, GuildAnnouncement: 5 };
const ADMINISTRATOR = 8n;
const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const channelSettings = {
  application_channel: 'Application reviews', movement_channel: 'Staff movements', log_channel: 'Audit log',
  announcement_channel: 'General announcements', ticket_category: 'Ticket category', transcript_channel: 'Ticket transcripts',
  welcome_channel: 'Welcome messages', starboard_channel: 'Starboard'
};
const roleSettings = {
  manager_role: 'Bot managers', reviewer_role: 'Application reviewers', accepted_role: 'Default accepted role',
  support_role: 'Ticket support', autorole_role: 'Automatic member role'
};
const optionSettings = {
  dm_on_decision: 'Application decision DMs', moderation_enabled: 'Moderation', levels_enabled: 'XP and levels',
  giveaways_enabled: 'Giveaways', tickets_enabled: 'Tickets', backups_enabled: 'Backups', sticky_enabled: 'Sticky messages',
  reaction_roles_enabled: 'Reaction roles', automod_enabled: 'Native AutoMod', starboard_enabled: 'Starboard',
  event_logs_enabled: 'Event logs', welcome_enabled: 'Welcome messages'
};
const textSettings = {
  brand_name: 'Brand name', brand_color: 'Brand color', application_title: 'Application title',
  application_description: 'Application description', application_question_1: 'Application question 1',
  application_question_2: 'Application question 2', application_question_3: 'Application question 3',
  application_question_4: 'Application question 4', application_question_5: 'Application question 5',
  movement_template: 'Staff movement template', welcome_message: 'Welcome message', leave_message: 'Leave message'
};
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GUILD_CACHE_TTL_MS = 15_000;
let webServer;
const guildCache = new Map();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(part => part.includes('=')).map(part => {
    const separator = part.indexOf('=');
    return [decodeURIComponent(part.slice(0, separator)), decodeURIComponent(part.slice(separator + 1))];
  }));
}

function encryptToken(value, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function decryptToken(value, secret) {
  const [iv, tag, encrypted] = String(value).split('.').map(part => Buffer.from(part, 'base64url'));
  const key = crypto.createHash('sha256').update(secret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

async function discordRequest(path, { token, tokenType = 'Bot', method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`https://discord.com/api/v10${path}`, {
      method,
      headers: { authorization: `${tokenType} ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    if (response.status === 429 && attempt < 2) {
      const rateLimit = await response.json().catch(() => ({}));
      const retryMs = Math.min(Math.max(Number(rateLimit.retry_after || 1) * 1000, 250), 15_000);
      await new Promise(resolveDelay => setTimeout(resolveDelay, retryMs));
      continue;
    }
    if (!response.ok) {
      const error = new Error(`Discord API ${response.status}: ${path}`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  throw new Error(`Discord API rate limit: ${path}`);
}

async function oauthAccessToken(session, { clientId, clientSecret, sessionSecret, baseUrl }) {
  if (new Date(session.oauth_expires_at).getTime() > Date.now() + 60_000) return decryptToken(session.oauth_access_token, sessionSecret);
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: decryptToken(session.oauth_refresh_token, sessionSecret), redirect_uri: `${baseUrl}/auth/callback` })
  });
  const token = await response.json();
  if (!response.ok) throw Object.assign(new Error('Discord login expired. Please sign in again.'), { status: 401 });
  const update = {
    oauth_access_token: encryptToken(token.access_token, sessionSecret),
    oauth_refresh_token: encryptToken(token.refresh_token, sessionSecret),
    oauth_expires_at: new Date(Date.now() + token.expires_in * 1000)
  };
  await getCollection('web_sessions').updateOne({ _id: session._id }, { $set: update });
  Object.assign(session, update);
  return token.access_token;
}

function tokenHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stateSignature(state, secret) {
  return crypto.createHmac('sha256', secret).update(state).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function setCookie(response, name, value, { maxAge, secure, clear = false } = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) attributes.push('Secure');
  if (clear) attributes.push('Max-Age=0');
  else if (maxAge) attributes.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  response.append('Set-Cookie', attributes.join('; '));
}

async function oauthAdminGuilds(session, config) {
  const accessToken = await oauthAccessToken(session, config);
  const oauthGuilds = await discordRequest('/users/@me/guilds', { token: accessToken, tokenType: 'Bearer' });
  return oauthGuilds.filter(guild => (BigInt(guild.permissions || '0') & ADMINISTRATOR) === ADMINISTRATOR);
}

async function adminGuilds(session, config, { useCache = false } = {}) {
  const cacheKey = String(session._id);
  const cached = guildCache.get(cacheKey);
  if (useCache && cached?.expiresAt > Date.now()) return cached.guilds;
  const admins = await oauthAdminGuilds(session, config);
  const installed = await Promise.all(admins.map(async guild => {
    try { return await discordRequest(`/guilds/${guild.id}?with_counts=true`, { token: config.botToken }); }
    catch (error) { if (error.status === 403 || error.status === 404) return null; throw error; }
  }));
  const guilds = installed.filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  if (useCache) guildCache.set(cacheKey, { guilds, expiresAt: Date.now() + GUILD_CACHE_TTL_MS });
  return guilds;
}

async function requireGuildAdmin(session, guildId, config, knownAdminGuilds = null) {
  const admin = knownAdminGuilds
    ? knownAdminGuilds.find(item => item.id === guildId)
    : (await oauthAdminGuilds(session, config)).find(item => item.id === guildId);
  if (!admin) return null;
  let guild;
  try { guild = await discordRequest(`/guilds/${guildId}?with_counts=true`, { token: config.botToken }); }
  catch (error) { if (error.status === 403 || error.status === 404) return null; throw error; }
  const [channels, roles] = await Promise.all([
    discordRequest(`/guilds/${guildId}/channels`, { token: config.botToken }),
    discordRequest(`/guilds/${guildId}/roles`, { token: config.botToken })
  ]);
  guild.memberCount = guild.approximate_member_count || 0;
  guild.channels = channels;
  guild.roles = roles;
  return guild;
}

function positionKey(name) {
  return String(name).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

function layout({ title, content, session = null, guilds = [], currentGuild = null, csrf = '' }) {
  const guildLinks = guilds.map(guild => `<a class="guild-link${guild.id === currentGuild?.id ? ' active' : ''}" href="/dashboard/${guild.id}"><span>${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>${escapeHtml(guild.name)}</a>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf-token" content="${escapeHtml(csrf)}"><title>${escapeHtml(title)} · Red Mushroom</title><link rel="stylesheet" href="/portal.css"></head><body>
    <div class="shell">
      ${session ? `<aside><a class="logo" href="/dashboard"><span>🍄</span><b>Red Mushroom</b></a><nav>${guildLinks || '<p class="muted">No admin servers found.</p>'}</nav><form class="logout api-form" action="/auth/logout" method="post"><button type="submit">Sign out</button></form></aside>` : ''}
      <main class="${session ? '' : 'centered'}">${session ? `<header><div><p class="eyebrow">CONTROL PANEL</p><h1>${escapeHtml(currentGuild?.name || 'Your servers')}</h1></div><div class="user"><img src="${escapeHtml(session.avatarUrl)}" alt=""><span>${escapeHtml(session.username)}</span></div></header>` : ''}${content}</main>
    </div><div id="save-bar" role="status" aria-live="polite"><div><strong>Unsaved changes</strong><span>Your new configuration is ready to save.</span></div><button id="save-all" class="primary" type="button">Save changes</button></div><div id="toast" role="status" aria-live="polite"></div><script src="/portal.js" defer></script></body></html>`;
}

function loginPage(clientId) {
  return layout({ title: 'Sign in', content: `<section class="login-card"><div class="mushroom">🍄</div><p class="eyebrow">RED MUSHROOM BOT</p><h1>One dashboard.<br>Every server setting.</h1><p>Sign in with Discord to manage servers where you have Administrator permission.</p><a class="primary" href="/auth/discord">Continue with Discord</a><div class="security-note"><span>◆</span> Permissions are checked live on every change.</div></section><p class="login-foot">Application ${escapeHtml(clientId)}</p>` });
}

function selectOptions(items, selected, emptyLabel) {
  return `<option value="">${escapeHtml(emptyLabel)}</option>${items.map(item => `<option value="${item.id}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
}

function settingForm(kind, key, label, control) {
  return `<form class="setting-row setting-form" action="settings" method="post"><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(key)}</small></div><input type="hidden" name="kind" value="${kind}"><input type="hidden" name="key" value="${key}">${control}</form>`;
}

function guildDashboard(guild, settings, positions) {
  const channels = guild.channels.filter(channel => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)).sort((a, b) => a.position - b.position);
  const categories = guild.channels.filter(channel => channel.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position);
  const roles = guild.roles.filter(role => role.id !== guild.id && !role.managed).sort((a, b) => b.position - a.position);
  const channelForms = Object.entries(channelSettings).map(([key, label]) => settingForm('channel', key, label, `<select name="value">${selectOptions(key === 'ticket_category' ? categories : channels, settings[key], 'Not configured')}</select>`)).join('');
  const roleForms = Object.entries(roleSettings).map(([key, label]) => settingForm('role', key, label, `<select name="value">${selectOptions(roles, settings[key], 'Not configured')}</select>`)).join('');
  const optionForms = Object.entries(optionSettings).map(([key, label]) => settingForm('option', key, label, `<select name="value"><option value="true"${settings[key] === 'true' ? ' selected' : ''}>Enabled</option><option value="false"${settings[key] !== 'true' ? ' selected' : ''}>Disabled</option></select>`)).join('');
  const textForms = Object.entries(textSettings).map(([key, label]) => settingForm('text', key, label, key.includes('description') || key.includes('message') || key.includes('template') ? `<textarea name="value" rows="3">${escapeHtml(settings[key])}</textarea>` : `<input name="value" value="${escapeHtml(settings[key])}" maxlength="1000">`)).join('');
  const positionRows = positions.map(position => `<article class="position"><div><span class="status ${position.open ? 'on' : 'off'}"></span><strong>${escapeHtml(position.name)}</strong><small>${escapeHtml(position.description)}</small><p>Review: #${escapeHtml(guild.channels.find(channel => channel.id === position.review_channel_id)?.name || 'missing')} ${position.accepted_role_id ? ` · Role: @${escapeHtml(guild.roles.find(role => role.id === position.accepted_role_id)?.name || 'missing')}` : ''}</p></div><div class="position-actions"><form class="api-form" action="application-positions/${encodeURIComponent(position.key)}/toggle" method="post"><input type="hidden" name="open" value="${position.open ? 'false' : 'true'}"><button>${position.open ? 'Close' : 'Open'}</button></form><form class="api-form" action="application-positions/${encodeURIComponent(position.key)}" method="delete"><button class="danger">Remove</button></form></div></article>`).join('');
  return `<div class="stats"><article><span>SERVER</span><strong>${guild.memberCount}</strong><small>members</small></article><article><span>MODULES</span><strong>${Object.keys(optionSettings).filter(key => settings[key] === 'true').length}</strong><small>enabled</small></article><article><span>APPLICATIONS</span><strong>${positions.filter(position => position.open).length}</strong><small>positions open</small></article></div>
    <div class="tabs"><button class="active" data-tab="overview">Overview</button><button data-tab="channels">Channels</button><button data-tab="roles">Roles</button><button data-tab="modules">Modules</button><button data-tab="applications">Applications</button><button data-tab="text">Text & brand</button></div>
    <section class="panel active" data-panel="overview"><div class="welcome"><div><p class="eyebrow">READY TO CONFIGURE</p><h2>Everything in one place.</h2><p>Changes are stored instantly for this server. Discord Administrator permission is verified before every save.</p></div><div class="orb">🍄</div></div></section>
    <section class="panel" data-panel="channels"><div class="section-head"><h2>Channels</h2><p>Choose where each bot feature should post.</p></div>${channelForms}</section>
    <section class="panel" data-panel="roles"><div class="section-head"><h2>Roles</h2><p>Assign access, support, and automatic roles.</p></div>${roleForms}</section>
    <section class="panel" data-panel="modules"><div class="section-head"><h2>Modules</h2><p>Enable only the systems your community uses.</p></div>${optionForms}</section>
    <section class="panel" data-panel="applications"><div class="section-head"><h2>Application positions</h2><p>Control what applications are open and where reviews arrive.</p></div><form class="position-create api-form" action="application-positions" method="post"><input name="name" placeholder="Position name" maxlength="80" required><input name="description" placeholder="Short dropdown description" maxlength="100"><select name="review_channel_id" required>${selectOptions(channels, '', 'Review channel')}</select><select name="accepted_role_id">${selectOptions(roles, '', 'No accepted role')}</select><button class="primary" type="submit">Add position</button></form><div class="positions">${positionRows || '<p class="empty">No application positions configured yet.</p>'}</div></section>
    <section class="panel" data-panel="text"><div class="section-head"><h2>Text & brand</h2><p>Customize the messages members see.</p></div>${textForms}</section>`;
}

function validatedSetting(guild, input) {
  const { kind, key } = input;
  const value = String(input.value ?? '').trim();
  if (kind === 'channel' && key in channelSettings) {
    const channel = guild.channels.find(item => item.id === value);
    const valid = key === 'ticket_category' ? channel?.type === ChannelType.GuildCategory : [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel?.type);
    if (!valid) throw new Error('Choose a valid channel.');
  } else if (kind === 'role' && key in roleSettings) {
    const role = guild.roles.find(item => item.id === value);
    if (!role || role.id === guild.id || role.managed) throw new Error('Choose a normal server role.');
  } else if (kind === 'option' && key in optionSettings) {
    if (!['true', 'false'].includes(value)) throw new Error('Invalid option value.');
  } else if (kind === 'text' && key in textSettings) {
    if (!value || value.length > 1000) throw new Error('Text must contain 1–1000 characters.');
    if (key === 'brand_color' && !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Use a color such as #d93636.');
  } else throw new Error('Unknown setting.');
  return { key, value, label: channelSettings[key] || roleSettings[key] || optionSettings[key] || textSettings[key] };
}

export function createWebPortalApp(config = {}) {
  const clientId = config.clientId || process.env.CLIENT_ID;
  const clientSecret = config.clientSecret || process.env.DISCORD_CLIENT_SECRET;
  const botToken = config.botToken || process.env.DISCORD_TOKEN;
  const sessionSecret = config.sessionSecret || process.env.SESSION_SECRET;
  const renderBaseUrl = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : '';
  const baseUrl = (config.baseUrl || process.env.WEB_BASE_URL || renderBaseUrl).replace(/\/$/, '');
  if (!clientId || !clientSecret || !botToken || !sessionSecret || !baseUrl) throw new Error('Web portal requires CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_TOKEN, SESSION_SECRET, and WEB_BASE_URL.');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');
  const portalConfig = { clientId, clientSecret, botToken, sessionSecret, baseUrl };
  const secureCookies = baseUrl.startsWith('https://');
  const app = express();
  if (process.env.WEB_TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https://cdn.discordapp.com'] } } }));
  app.use(express.json({ limit: '32kb' }));
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(express.static(publicDirectory, { maxAge: '1h', index: false }));

  app.get('/health', (_request, response) => response.json({ ok: true, service: 'red-mushroom-web' }));
  app.get('/', async (request, response) => {
    const sessionToken = parseCookies(request.headers.cookie).rm_session;
    if (sessionToken) return response.redirect('/dashboard');
    return response.send(loginPage(clientId));
  });
  app.get('/auth/discord', (_request, response) => {
    const state = crypto.randomBytes(24).toString('hex');
    setCookie(response, 'rm_oauth', `${state}.${stateSignature(state, sessionSecret)}`, { maxAge: 10 * 60_000, secure: secureCookies });
    const query = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: `${baseUrl}/auth/callback`, scope: 'identify guilds', state });
    response.redirect(`https://discord.com/oauth2/authorize?${query}`);
  });
  app.get('/auth/callback', async (request, response, next) => {
    try {
      const [savedState, signature] = (parseCookies(request.headers.cookie).rm_oauth || '').split('.');
      if (!request.query.code || !request.query.state || request.query.state !== savedState || !safeEqual(signature, stateSignature(savedState, sessionSecret))) return response.status(400).send('Invalid or expired OAuth state.');
      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: String(request.query.code), redirect_uri: `${baseUrl}/auth/callback` }) });
      const token = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(`Discord OAuth failed: ${token.error || tokenResponse.status}`);
      const userResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { authorization: `Bearer ${token.access_token}` } });
      const user = await userResponse.json();
      if (!userResponse.ok) throw new Error('Discord user lookup failed.');
      const sessionToken = crypto.randomBytes(32).toString('base64url');
      const defaultAvatar = user.discriminator === '0' ? Number((BigInt(user.id) >> 22n) % 6n) : Number(user.discriminator) % 5;
      const avatarUrl = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${defaultAvatar}.png`;
      await getCollection('web_sessions').insertOne({ token_hash: tokenHash(sessionToken), user_id: user.id, username: user.global_name || user.username, avatar_url: avatarUrl, csrf: crypto.randomBytes(24).toString('base64url'), oauth_access_token: encryptToken(token.access_token, sessionSecret), oauth_refresh_token: encryptToken(token.refresh_token, sessionSecret), oauth_expires_at: new Date(Date.now() + token.expires_in * 1000), created_at: new Date(), expires_at: new Date(Date.now() + SESSION_TTL_MS) });
      setCookie(response, 'rm_session', sessionToken, { maxAge: SESSION_TTL_MS, secure: secureCookies });
      setCookie(response, 'rm_oauth', '', { clear: true, secure: secureCookies });
      response.redirect('/dashboard');
    } catch (error) { next(error); }
  });

  app.use(async (request, response, next) => {
    if (!request.path.startsWith('/dashboard') && !request.path.startsWith('/api/') && request.path !== '/auth/logout') return next();
    const rawToken = parseCookies(request.headers.cookie).rm_session;
    const session = rawToken ? await getCollection('web_sessions').findOne({ token_hash: tokenHash(rawToken), expires_at: { $gt: new Date() } }) : null;
    if (!session) return request.path.startsWith('/api/') ? response.status(401).json({ error: 'Sign in required.' }) : response.redirect('/');
    request.portalSession = session;
    request.rawSessionToken = rawToken;
    next();
  });
  app.use((request, response, next) => {
    if (!['POST', 'PATCH', 'DELETE'].includes(request.method)) return next();
    const csrf = request.get('x-csrf-token') || request.body?._csrf;
    if (!request.portalSession || !safeEqual(csrf, request.portalSession.csrf)) return response.status(403).json({ error: 'Invalid security token. Reload the page.' });
    next();
  });

  app.post('/auth/logout', async (request, response) => {
    guildCache.delete(String(request.portalSession._id));
    await getCollection('web_sessions').deleteOne({ token_hash: tokenHash(request.rawSessionToken) });
    setCookie(response, 'rm_session', '', { clear: true, secure: secureCookies });
    response.json({ redirect: '/' });
  });
  app.get('/dashboard', async (request, response) => {
    const guilds = await adminGuilds(request.portalSession, portalConfig, { useCache: true });
    if (guilds[0]) return response.redirect(`/dashboard/${guilds[0].id}`);
    response.send(layout({ title: 'Dashboard', session: { username: request.portalSession.username, avatarUrl: request.portalSession.avatar_url }, csrf: request.portalSession.csrf, content: '<section class="empty-state"><div>🔐</div><h2>No manageable servers</h2><p>You need Discord Administrator permission on a server where Red Mushroom Bot is installed.</p></section>' }));
  });
  app.get('/dashboard/:guildId', async (request, response) => {
    const guilds = await adminGuilds(request.portalSession, portalConfig, { useCache: true });
    const guild = await requireGuildAdmin(request.portalSession, request.params.guildId, portalConfig, guilds);
    if (!guild) return response.status(403).send(layout({ title: 'Access denied', session: { username: request.portalSession.username, avatarUrl: request.portalSession.avatar_url }, guilds, csrf: request.portalSession.csrf, content: '<section class="empty-state"><div>⛔</div><h2>Access denied</h2><p>Administrator permission is required.</p></section>' }));
    const positions = await getCollection('application_categories').find({ guild_id: guild.id }).sort({ name: 1 }).toArray();
    response.send(layout({ title: guild.name, session: { username: request.portalSession.username, avatarUrl: request.portalSession.avatar_url }, guilds, currentGuild: guild, csrf: request.portalSession.csrf, content: guildDashboard(guild, getAllSettings(guild.id), positions) }));
  });

  app.use('/api/guilds/:guildId', async (request, response, next) => {
    const guild = await requireGuildAdmin(request.portalSession, request.params.guildId, portalConfig);
    if (!guild) return response.status(403).json({ error: 'Discord Administrator permission is required.' });
    request.portalGuild = guild;
    next();
  });
  app.post('/api/guilds/:guildId/settings', async (request, response) => {
    try {
      const setting = validatedSetting(request.portalGuild, request.body);
      await setSetting(request.portalGuild.id, setting.key, setting.value);
      response.json({ ok: true, message: `${setting.label} saved.` });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });
  app.post('/api/guilds/:guildId/settings/bulk', async (request, response) => {
    try {
      if (!Array.isArray(request.body.settings) || !request.body.settings.length || request.body.settings.length > 50) throw new Error('Submit between 1 and 50 settings.');
      const settings = request.body.settings.map(input => validatedSetting(request.portalGuild, input));
      if (new Set(settings.map(setting => setting.key)).size !== settings.length) throw new Error('A setting can only be submitted once.');
      await Promise.all(settings.map(setting => setSetting(request.portalGuild.id, setting.key, setting.value)));
      response.json({ ok: true, message: `${settings.length} ${settings.length === 1 ? 'setting' : 'settings'} saved.` });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });
  app.post('/api/guilds/:guildId/application-positions', async (request, response) => {
    const collection = getCollection('application_categories');
    const name = String(request.body.name || '').trim().slice(0, 80);
    const key = positionKey(name);
    const description = String(request.body.description || `Apply for ${name}`).trim().slice(0, 100);
    const reviewChannel = request.portalGuild.channels.find(item => item.id === request.body.review_channel_id);
    const acceptedRole = request.body.accepted_role_id ? request.portalGuild.roles.find(item => item.id === request.body.accepted_role_id) : null;
    if (!key || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(reviewChannel?.type)) return response.status(400).json({ error: 'Provide a name and valid review channel.' });
    if (request.body.accepted_role_id && (!acceptedRole || acceptedRole.managed)) return response.status(400).json({ error: 'Choose a valid accepted role.' });
    if (!await collection.findOne({ guild_id: request.portalGuild.id, key }) && await collection.countDocuments({ guild_id: request.portalGuild.id }) >= 25) return response.status(400).json({ error: 'Discord supports up to 25 positions.' });
    await collection.updateOne({ guild_id: request.portalGuild.id, key }, { $set: { guild_id: request.portalGuild.id, key, name, description, review_channel_id: reviewChannel.id, accepted_role_id: acceptedRole?.id || null, open: true, updated_by: request.portalSession.user_id, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } }, { upsert: true });
    response.json({ ok: true, message: `${name} is open for applications.` });
  });
  app.post('/api/guilds/:guildId/application-positions/:key/toggle', async (request, response) => {
    const result = await getCollection('application_categories').updateOne({ guild_id: request.portalGuild.id, key: request.params.key }, { $set: { open: request.body.open === 'true', updated_by: request.portalSession.user_id, updated_at: new Date() } });
    if (!result.matchedCount) return response.status(404).json({ error: 'Position not found.' });
    response.json({ ok: true, message: `Applications ${request.body.open === 'true' ? 'opened' : 'closed'}.` });
  });
  app.delete('/api/guilds/:guildId/application-positions/:key', async (request, response) => {
    await getCollection('application_categories').deleteOne({ guild_id: request.portalGuild.id, key: request.params.key });
    response.json({ ok: true, message: 'Application position removed.' });
  });
  app.use((error, _request, response, _next) => {
    console.error('Web portal error:', error);
    response.status(500).json({ error: 'The portal encountered an error.' });
  });
  return app;
}

export function startWebPortal() {
  const app = createWebPortalApp();
  const port = Number(process.env.PORT || process.env.WEB_PORT) || 3000;
  webServer = app.listen(port, '0.0.0.0', () => console.log(`Web portal listening on port ${port} (${process.env.WEB_BASE_URL}).`));
  return webServer;
}

export async function stopWebPortal() {
  if (!webServer) return;
  await new Promise((resolve, reject) => webServer.close(error => error ? reject(error) : resolve()));
  webServer = null;
}
