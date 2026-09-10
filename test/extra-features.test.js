import assert from 'node:assert/strict';
import test from 'node:test';
import { commands } from '../src/commands.js';
import { parseArcaneCsv, parseDuration } from '../src/extra-features.js';

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
  for (const expected of ['application', 'staff-roles', 'maintenance', 'clear', 'moderation', 'level', 'giveaway', 'ticket', 'backup', 'sticky', 'reaction-role', 'automod', 'community']) {
    assert.ok(names.has(expected), `missing ${expected}`);
  }
});

test('offers a level announcement channel and no starboard configuration', () => {
  const serialized = JSON.stringify(commands);
  assert.match(serialized, /level_channel/);
  assert.doesNotMatch(serialized, /starboard/i);
});

test('includes configurable level reward role commands', () => {
  const level = commands.find(command => command.name === 'level');
  const subcommands = new Set(level.options.map(option => option.name));
  for (const expected of ['role-add', 'role-remove', 'roles', 'role-sync', 'import-arcane']) assert.ok(subcommands.has(expected), `missing /level ${expected}`);
});

test('includes an interactive giveaway control panel', () => {
  const giveaway = commands.find(command => command.name === 'giveaway');
  assert.ok(giveaway.options.some(option => option.name === 'panel'));
});

test('parses Arcane CSV level migrations safely', () => {
  const parsed = parseArcaneCsv('user_id,username,level\n123456789012345678,"Example, User",12\n234567890123456789,Broken,nope\n123456789012345678,Duplicate,10');
  assert.deepEqual(parsed.members, [{ userId: '123456789012345678', level: 12 }]);
  assert.equal(parsed.skipped, 1);
  assert.throws(() => parseArcaneCsv('username,level\nExample,5'), /user_id/);
});
