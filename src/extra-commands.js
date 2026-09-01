import { ApplicationCommandOptionType, ChannelType } from 'discord.js';

const textChannel = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const user = (required = true) => ({ type: ApplicationCommandOptionType.User, name: 'user', description: 'Target member', required });
const reason = { type: ApplicationCommandOptionType.String, name: 'reason', description: 'Reason for this action', max_length: 500 };

export const extraCommands = [
  {
    name: 'clear', description: 'Delete recent messages from the current channel', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Integer, name: 'amount', description: 'Number of messages to delete (1-100)', required: true, min_value: 1, max_value: 100 },
      user(false)
    ]
  },
  {
    name: 'moderation', description: 'Moderation, warnings, and message management', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'ban', description: 'Ban a member', options: [user(), reason, { type: ApplicationCommandOptionType.Integer, name: 'delete-days', description: 'Delete recent message history (0-7)', min_value: 0, max_value: 7 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'kick', description: 'Kick a member', options: [user(), reason] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'timeout', description: 'Timeout a member', options: [user(), { type: ApplicationCommandOptionType.String, name: 'duration', description: 'Examples: 10m, 2h, 7d; use off to remove', required: true }, reason] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'warn', description: 'Warn a member', options: [user(), { ...reason, required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'warnings', description: 'List warnings for a member', options: [user()] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'clear-warnings', description: 'Clear warnings for a member', options: [user(), reason] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'purge', description: 'Delete recent messages', options: [{ type: ApplicationCommandOptionType.Integer, name: 'amount', description: 'Number to delete', required: true, min_value: 1, max_value: 100 }, user(false)] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'lock', description: 'Lock the current channel', options: [reason] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'unlock', description: 'Unlock the current channel' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'slowmode', description: 'Set channel slowmode', options: [{ type: ApplicationCommandOptionType.Integer, name: 'seconds', description: '0 disables it', required: true, min_value: 0, max_value: 21600 }] }
    ]
  },
  {
    name: 'level', description: 'XP levels and leaderboards', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'rank', description: 'Show a member rank', options: [user(false)] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'leaderboard', description: 'Show the server XP leaderboard' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'manage', description: 'Manage a member XP', options: [user(), { type: ApplicationCommandOptionType.String, name: 'action', description: 'XP operation', required: true, choices: [{ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }, { name: 'Set', value: 'set' }] }, { type: ApplicationCommandOptionType.Integer, name: 'amount', description: 'XP amount', required: true, min_value: 0, max_value: 10000000 }] }
    ]
  },
  {
    name: 'giveaway', description: 'Create and manage button giveaways', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'start', description: 'Start a giveaway', options: [{ type: ApplicationCommandOptionType.String, name: 'duration', description: 'Examples: 10m, 2h, 3d', required: true }, { type: ApplicationCommandOptionType.Integer, name: 'winners', description: 'Number of winners', required: true, min_value: 1, max_value: 20 }, { type: ApplicationCommandOptionType.String, name: 'prize', description: 'Prize', required: true, max_length: 256 }, { type: ApplicationCommandOptionType.Channel, name: 'channel', description: 'Giveaway channel', channel_types: textChannel }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'end', description: 'End a giveaway now', options: [{ type: ApplicationCommandOptionType.String, name: 'id', description: 'Giveaway ID or message ID', required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'reroll', description: 'Reroll an ended giveaway', options: [{ type: ApplicationCommandOptionType.String, name: 'id', description: 'Giveaway ID or message ID', required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'list', description: 'List active giveaways' }
    ]
  },
  {
    name: 'ticket', description: 'Ticket panels and staff actions', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'panel', description: 'Post a ticket creation panel', options: [{ type: ApplicationCommandOptionType.String, name: 'title', description: 'Panel title', max_length: 100 }, { type: ApplicationCommandOptionType.String, name: 'description', description: 'Panel text', max_length: 1000 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'close', description: 'Close the current ticket', options: [reason] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'claim', description: 'Claim the current ticket' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'add', description: 'Add a member to this ticket', options: [user()] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'remove', description: 'Remove a member from this ticket', options: [user()] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'rename', description: 'Rename this ticket', options: [{ type: ApplicationCommandOptionType.String, name: 'name', description: 'New channel name', required: true, min_length: 1, max_length: 80 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'transcript', description: 'Export the latest ticket messages' }
    ]
  },
  {
    name: 'backup', description: 'Safe server structure backups', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'create', description: 'Back up roles and channels', options: [{ type: ApplicationCommandOptionType.String, name: 'name', description: 'Backup name', required: true, max_length: 80 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'list', description: 'List server backups' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'restore', description: 'Restore missing roles and channels without deleting existing ones', options: [{ type: ApplicationCommandOptionType.String, name: 'id', description: 'Backup ID', required: true }, { type: ApplicationCommandOptionType.String, name: 'confirmation', description: 'Type RESTORE to confirm', required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'delete', description: 'Delete a stored backup', options: [{ type: ApplicationCommandOptionType.String, name: 'id', description: 'Backup ID', required: true }] }
    ]
  },
  {
    name: 'utility', description: 'Information, polls, reminders, AFK, and custom responses', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'ping', description: 'Show bot latency and uptime' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'avatar', description: 'Show a user avatar', options: [user(false)] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'userinfo', description: 'Show information about a member', options: [user(false)] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'serverinfo', description: 'Show information about this server' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'poll', description: 'Create a reaction poll', options: [{ type: ApplicationCommandOptionType.String, name: 'question', description: 'Poll question', required: true, max_length: 500 }, { type: ApplicationCommandOptionType.String, name: 'options', description: 'Choices separated with | (2-10)', required: true, max_length: 1000 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'remind', description: 'Create a reminder', options: [{ type: ApplicationCommandOptionType.String, name: 'duration', description: 'Examples: 10m, 2h, 3d', required: true }, { type: ApplicationCommandOptionType.String, name: 'message', description: 'Reminder text', required: true, max_length: 1000 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'afk', description: 'Set or clear AFK status', options: [{ type: ApplicationCommandOptionType.String, name: 'status', description: 'AFK message; use off to clear', required: true, max_length: 200 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'custom-add', description: 'Create a custom response', options: [{ type: ApplicationCommandOptionType.String, name: 'name', description: 'Response name', required: true, max_length: 32 }, { type: ApplicationCommandOptionType.String, name: 'response', description: 'Response text', required: true, max_length: 1800 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'custom-run', description: 'Run a custom response', options: [{ type: ApplicationCommandOptionType.String, name: 'name', description: 'Response name', required: true, max_length: 32 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'custom-list', description: 'List custom responses' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'custom-delete', description: 'Delete a custom response', options: [{ type: ApplicationCommandOptionType.String, name: 'name', description: 'Response name', required: true, max_length: 32 }] }
    ]
  },
  {
    name: 'sticky', description: 'Manage persistent sticky messages in channels', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'set', description: 'Set or update this channel sticky', options: [{ type: ApplicationCommandOptionType.String, name: 'message', description: 'Sticky message', required: true, max_length: 1900 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'stop', description: 'Pause this channel sticky' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'start', description: 'Resume this channel sticky' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'remove', description: 'Remove this channel sticky configuration' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'list', description: 'List server sticky messages' }
    ]
  },
  {
    name: 'reaction-role', description: 'Configure reaction-based self roles', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'add', description: 'Connect an emoji on a message to a role', options: [{ type: ApplicationCommandOptionType.String, name: 'message-id', description: 'Message ID', required: true }, { type: ApplicationCommandOptionType.Channel, name: 'channel', description: 'Channel containing the message', required: true, channel_types: textChannel }, { type: ApplicationCommandOptionType.String, name: 'emoji', description: 'Unicode or custom server emoji', required: true, max_length: 100 }, { type: ApplicationCommandOptionType.Role, name: 'role', description: 'Role to assign', required: true }, { type: ApplicationCommandOptionType.String, name: 'mode', description: 'How reactions behave', choices: [{ name: 'Normal: add/remove', value: 'normal' }, { name: 'Verify: add only', value: 'verify' }, { name: 'Drop: remove only', value: 'drop' }] }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'remove', description: 'Remove one reaction-role mapping', options: [{ type: ApplicationCommandOptionType.String, name: 'message-id', description: 'Message ID', required: true }, { type: ApplicationCommandOptionType.String, name: 'emoji', description: 'Configured emoji', required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'list', description: 'List configured reaction roles' }
    ]
  },
  {
    name: 'automod', description: 'Configure Discord native AutoMod rules', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'keyword-add', description: 'Block a keyword or phrase', options: [{ type: ApplicationCommandOptionType.String, name: 'keyword', description: 'Keyword, wildcard, or phrase', required: true, max_length: 60 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'keyword-remove', description: 'Remove a blocked keyword', options: [{ type: ApplicationCommandOptionType.String, name: 'keyword', description: 'Exact configured keyword', required: true, max_length: 60 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'spam', description: 'Enable or disable Discord spam detection', options: [{ type: ApplicationCommandOptionType.Boolean, name: 'enabled', description: 'Rule status', required: true }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'mentions', description: 'Configure mention-spam blocking', options: [{ type: ApplicationCommandOptionType.Boolean, name: 'enabled', description: 'Rule status', required: true }, { type: ApplicationCommandOptionType.Integer, name: 'limit', description: 'Maximum mentions per message', min_value: 3, max_value: 50 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'status', description: 'List managed AutoMod rules' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'violations', description: 'Show recent AutoMod actions', options: [user(false)] }
    ]
  },
  {
    name: 'community', description: 'Starboard, welcome, autorole, and managed embeds', dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'starboard', description: 'Configure the starboard', options: [{ type: ApplicationCommandOptionType.Channel, name: 'channel', description: 'Starboard channel', required: true, channel_types: textChannel }, { type: ApplicationCommandOptionType.Integer, name: 'threshold', description: 'Reactions required', required: true, min_value: 2, max_value: 50 }, { type: ApplicationCommandOptionType.String, name: 'emoji', description: 'Starboard emoji', max_length: 100 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'welcome-test', description: 'Preview the configured welcome message' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'autorole-test', description: 'Test the configured automatic member role', options: [user(false)] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'embed', description: 'Send a managed embed', options: [{ type: ApplicationCommandOptionType.String, name: 'title', description: 'Embed title', required: true, max_length: 256 }, { type: ApplicationCommandOptionType.String, name: 'description', description: 'Embed content; use \\n for new lines', required: true, max_length: 4000 }, { type: ApplicationCommandOptionType.Channel, name: 'channel', description: 'Destination channel', channel_types: textChannel }, { type: ApplicationCommandOptionType.String, name: 'color', description: 'Optional #RRGGBB color', max_length: 7 }] },
      { type: ApplicationCommandOptionType.Subcommand, name: 'logs', description: 'Show recent AutoMod violations and moderation events', options: [user(false)] }
    ]
  }
];
