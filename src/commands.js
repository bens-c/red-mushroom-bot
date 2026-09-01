import {
  ApplicationCommandOptionType,
  ChannelType
} from 'discord.js';
import { extraCommands } from './extra-commands.js';

export const commands = [
  {
    name: 'config',
    description: 'Configure this bot for your server',
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'view',
        description: 'View all current bot settings'
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'set-channel',
        description: 'Set a channel used by the bot',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'purpose',
            description: 'What the channel is used for',
            required: true,
            choices: [
              { name: 'Application reviews', value: 'application_channel' },
              { name: 'Staff movements', value: 'movement_channel' },
              { name: 'Audit log', value: 'log_channel' },
              { name: 'General announcements', value: 'announcement_channel' },
              { name: 'Ticket category', value: 'ticket_category' },
              { name: 'Ticket transcripts', value: 'transcript_channel' }
            ]
          },
          {
            type: ApplicationCommandOptionType.Channel,
            name: 'channel',
            description: 'The destination channel',
            required: true,
            channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory]
          }
        ]
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'set-role',
        description: 'Set a role used by the bot',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'purpose',
            description: 'What the role is used for',
            required: true,
            choices: [
              { name: 'Bot managers', value: 'manager_role' },
              { name: 'Application reviewers', value: 'reviewer_role' },
              { name: 'Accepted applicants', value: 'accepted_role' },
              { name: 'Ticket support staff', value: 'support_role' }
            ]
          },
          { type: ApplicationCommandOptionType.Role, name: 'role', description: 'The role', required: true }
        ]
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'set-text',
        description: 'Set branding, an application question, or a message template',
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: 'key',
            description: 'The text setting to update',
            required: true,
            choices: [
              { name: 'Brand name', value: 'brand_name' },
              { name: 'Brand color (#RRGGBB)', value: 'brand_color' },
              { name: 'Application title', value: 'application_title' },
              { name: 'Application description', value: 'application_description' },
              { name: 'Application question 1', value: 'application_question_1' },
              { name: 'Application question 2', value: 'application_question_2' },
              { name: 'Application question 3', value: 'application_question_3' },
              { name: 'Application question 4', value: 'application_question_4' },
              { name: 'Application question 5', value: 'application_question_5' },
              { name: 'Movement template', value: 'movement_template' },
              { name: 'Accepted DM template', value: 'application_accepted_template' },
              { name: 'Rejected DM template', value: 'application_rejected_template' }
            ]
          },
          { type: ApplicationCommandOptionType.String, name: 'value', description: 'New text (use "off" to disable questions 2-5)', required: true, max_length: 1000 }
        ]
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'set-option',
        description: 'Set a yes/no option',
        options: [
          { type: ApplicationCommandOptionType.String, name: 'key', description: 'Option', required: true, choices: [
            { name: 'DM application decisions', value: 'dm_on_decision' },
            { name: 'Moderation module', value: 'moderation_enabled' },
            { name: 'XP and levels module', value: 'levels_enabled' },
            { name: 'Giveaway module', value: 'giveaways_enabled' },
            { name: 'Ticket module', value: 'tickets_enabled' },
            { name: 'Backup module', value: 'backups_enabled' }
          ] },
          { type: ApplicationCommandOptionType.Boolean, name: 'enabled', description: 'Whether the option is enabled', required: true }
        ]
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'reset',
        description: 'Reset one setting to its default/unset value',
        options: [{ type: ApplicationCommandOptionType.String, name: 'key', description: 'Exact setting key shown by /config view', required: true }]
      }
    ]
  },
  {
    name: 'application',
    description: 'Application system commands',
    dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.Subcommand, name: 'panel', description: 'Post the application panel (Manage Server required)' },
      { type: ApplicationCommandOptionType.Subcommand, name: 'stats', description: 'View application statistics (staff only)' }
    ]
  },
  {
    name: 'staff',
    description: 'Record and announce a staff movement',
    dm_permission: false,
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: 'action',
        description: 'Movement type',
        required: true,
        choices: [
          { name: 'Hire', value: 'hired' }, { name: 'Promote', value: 'promoted' },
          { name: 'Demote', value: 'demoted' }, { name: 'Transfer', value: 'transferred' },
          { name: 'Place on leave', value: 'placed on leave' }, { name: 'Return from leave', value: 'returned from leave' },
          { name: 'Resign', value: 'marked as resigned' }, { name: 'Terminate', value: 'terminated' }
        ]
      },
      { type: ApplicationCommandOptionType.User, name: 'member', description: 'Staff member', required: true },
      { type: ApplicationCommandOptionType.String, name: 'position', description: 'New rank, department, or status', required: true, max_length: 100 },
      { type: ApplicationCommandOptionType.String, name: 'reason', description: 'Reason for this movement', required: true, max_length: 500 },
      { type: ApplicationCommandOptionType.Role, name: 'add-role', description: 'Optional role to add' },
      { type: ApplicationCommandOptionType.Role, name: 'remove-role', description: 'Optional role to remove' }
    ]
  },
  {
    name: 'announce',
    description: 'Send a branded announcement',
    dm_permission: false,
    options: [
      { type: ApplicationCommandOptionType.String, name: 'title', description: 'Announcement title', required: true, max_length: 256 },
      { type: ApplicationCommandOptionType.String, name: 'message', description: 'Announcement body', required: true, max_length: 2000 },
      { type: ApplicationCommandOptionType.Channel, name: 'channel', description: 'Override the configured announcement channel', channel_types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
      { type: ApplicationCommandOptionType.String, name: 'mention', description: 'Optional safe mention', choices: [{ name: '@everyone', value: 'everyone' }, { name: '@here', value: 'here' }] }
    ]
  },
  { name: 'help', description: 'Show the bot command guide', dm_permission: false },
  ...extraCommands
];
