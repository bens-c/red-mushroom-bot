import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebPortalApp } from '../src/web-portal.js';

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
