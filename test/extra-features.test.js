import assert from 'node:assert/strict';
import test from 'node:test';
import { commands } from '../src/commands.js';
import { parseDuration } from '../src/extra-features.js';

test('parses human-friendly durations', () => {
  assert.equal(parseDuration('10m'), 600000);
  assert.equal(parseDuration('2h'), 7200000);
  assert.equal(parseDuration('3d'), 259200000);
  assert.equal(parseDuration('off'), null);
});

test('registers unique, Discord-sized top-level commands', () => {
  const names = commands.map(command => command.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(commands.length <= 100);
  for (const command of commands) {
    assert.match(command.name, /^[a-z0-9_-]{1,32}$/);
    assert.ok(command.description.length >= 1 && command.description.length <= 100);
    assert.ok((command.options?.length || 0) <= 25);
    assert.ok(JSON.stringify(command).length < 8000, `${command.name} exceeds Discord's command size limit`);
  }
});

test('includes every all-in-one module command group', () => {
  const names = new Set(commands.map(command => command.name));
  for (const expected of ['application', 'staff-roles', 'moderation', 'level', 'giveaway', 'ticket', 'backup', 'sticky', 'reaction-role', 'automod', 'community']) {
    assert.ok(names.has(expected), `missing ${expected}`);
  }
});
