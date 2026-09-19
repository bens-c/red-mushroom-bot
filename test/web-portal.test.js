import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebPortalApp, guildBotAvatarUrl, validatedAvatarData } from '../src/web-portal.js';

const config = {
  clientId: '1544261311787966484',
  clientSecret: 'test-client-secret',
  botToken: 'test-bot-token',
  sessionSecret: '0123456789abcdef0123456789abcdef',
  baseUrl: 'https://dashboard.example.com'
};

test('serves the standalone portal and builds a safe Discord OAuth request', async context => {
  const server = createWebPortalApp(config).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const { port } = server.address();

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.deepEqual(await health.json(), { ok: true, service: 'red-mushroom-web' });

  const login = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Continue with Discord/);

  const oauth = await fetch(`http://127.0.0.1:${port}/auth/discord`, { redirect: 'manual' });
  const location = new URL(oauth.headers.get('location'));
  assert.equal(location.origin, 'https://discord.com');
  assert.equal(location.searchParams.get('scope'), 'identify guilds');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://dashboard.example.com/auth/callback');
  assert.match(oauth.headers.get('set-cookie'), /rm_oauth=.*HttpOnly.*SameSite=Lax.*Secure/);
});

test('validates server-specific profile images', () => {
  const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;
  assert.equal(validatedAvatarData(png), png);
  assert.equal(validatedAvatarData(null), null);
  assert.throws(() => validatedAvatarData('data:text/plain;base64,SGVsbG8='), /PNG, JPG, or GIF/);
  assert.throws(() => validatedAvatarData('data:image/png;base64,SGVsbG8='), /not a valid image/);
});

test('uses a guild avatar before the global bot avatar', () => {
  const member = { avatar: 'guildhash', user: { id: '1544261311787966484', avatar: 'globalhash', discriminator: '0' } };
  assert.match(guildBotAvatarUrl('1399834742802747452', member), /guilds\/1399834742802747452\/users\/1544261311787966484\/avatars\/guildhash/);
  member.avatar = null;
  assert.match(guildBotAvatarUrl('1399834742802747452', member), /avatars\/1544261311787966484\/globalhash/);
});
