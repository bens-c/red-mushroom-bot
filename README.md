# Red Mushroom Staff Bot

A single configurable Discord bot for staff applications, application reviews, promotions, demotions, transfers, leave, resignations, terminations, announcements, role changes, and audit logging.

## Requirements

- Node.js 20 or newer
- A Discord application and bot token
- Bot permissions: View Channels, Send Messages, Embed Links, Read Message History, and Manage Roles
- The bot's role must sit above every role it needs to add or remove

## Install and run

1. In the Discord Developer Portal, create an application and add a bot.
2. Enable the **Server Members Intent** on the Bot page.
3. Invite it with the `bot` and `applications.commands` scopes.
4. Copy `.env.example` to `.env` and enter the token and application ID.
5. For development, set `GUILD_ID` so slash commands appear immediately in that server. Without it, commands are registered globally and can take time to propagate.
6. Run:

```sh
npm install
npm start
```

## First-time server setup

All configuration is done through Discord slash commands and stored separately per server.

1. Use `/config set-channel` to set application reviews, staff movements, audit logs, and announcements.
2. Use `/config set-role` to choose managers, application reviewers, and the role granted to accepted applicants.
3. Use `/config set-text` to customize branding, questions, and message templates.
4. Use `/config set-option` to enable or disable decision DMs.
5. Use `/application panel` wherever applicants should see the Apply button.
6. Use `/config view` at any time to inspect the effective setup.

Questions 2–5 can be disabled by setting their value to `off`. Question 1 is always required. Application decisions are atomic, so two reviewers cannot process the same application twice.

## Commands

- `/config view|set-channel|set-role|set-text|set-option|reset`
- `/application panel|stats`
- `/staff` with hire, promote, demote, transfer, leave, return, resign, and terminate actions
- `/announce`
- `/help`

The `/staff` command can add and remove roles in the same action. Its announcement template supports `{user}`, `{actor}`, `{action}`, `{position}`, `{reason}`, and `{server}`. Decision DM templates support `{server}` and `{reason}`.

## Data and backups

Configuration and applications are stored in `data/bot.sqlite` by default. Back up that file while the bot is stopped, or override its location with `DATABASE_PATH`.
