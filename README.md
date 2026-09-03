# Red Mushroom Staff Bot

A single configurable Discord bot for staff applications, moderation, XP levels, giveaways, tickets, sticky messages, reaction roles, native AutoMod, starboard, welcome/autoroles, safe server backups, staff movements, announcements, utilities, and audit logging.

## Requirements

- Node.js 20.19 or newer
- A MongoDB Atlas cluster and connection string
- A Discord application and bot token
- Bot permissions: View Channels, Send Messages, Embed Links, Attach Files, Add Reactions, Read Message History, Manage Messages, Manage Channels, Manage Roles, Moderate Members, Kick Members, and Ban Members
- The bot's role must sit above every role it needs to add or remove

## Install and run

1. In the Discord Developer Portal, create an application and add a bot.
2. Enable the **Server Members Intent** on the Bot page.
3. Invite it with the `bot` and `applications.commands` scopes.
4. Copy `.env.example` to `.env` and enter the token, application ID, and MongoDB Atlas connection string.
5. For development, set `GUILD_ID` so slash commands appear immediately in that server. Without it, commands are registered globally and can take time to propagate.
6. Run:

```sh
npm install
npm start
```

## Separate web portal on Render

The dashboard is a separate service, so the Discord bot and website can run on different servers. It uses the same MongoDB database. A user only sees servers where the bot is installed and their current Discord account has the **Administrator** permission. That permission is checked again through Discord before every saved change.

1. In Render, choose **New → Blueprint**, connect this GitHub repository, and let Render read `render.yaml`.
2. Enter the requested secret values: `CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_TOKEN`, and `MONGODB_URI`.
3. Render generates `SESSION_SECRET` automatically and derives the website URL from its hostname. If you later use a custom domain, set `WEB_BASE_URL` manually to that domain without a trailing slash.
4. Copy the public Render URL. In Discord Developer Portal → OAuth2 → Redirects, add that exact URL followed by `/auth/callback`, for example `https://red-mushroom-web.onrender.com/auth/callback`.
5. Make sure MongoDB Atlas allows connections from the Render service, then deploy again after changing any environment variable.

Render supplies its `PORT` automatically. The included `/health` endpoint is configured as the service health check, and pushes to the connected branch deploy automatically.

The bot remains a separate process (`npm start` or its existing PM2 service). Never put the Discord client secret, bot token, MongoDB URI, or session secret in browser code or commit them to Git.

## First-time server setup

All configuration is done through Discord slash commands and stored separately per server.

`/config` requires the local Discord permission **Manage Server**. Global bot-management commands such as `/maintenance` instead require membership in control server `1399834742802747452` and role `1544634974404214824` there. The control IDs can be overridden with `CONTROL_GUILD_ID` and `GLOBAL_CONFIG_ROLE_ID`.

1. Use `/config set-channel` to set application reviews, staff movements, audit logs, and announcements.
2. Use `/config set-role` to choose managers, application reviewers, and the role granted to accepted applicants.
3. Use `/config set-text` to customize branding, questions, and message templates.
4. Use `/config set-option` to enable or disable decision DMs and individual modules.
5. Add open positions with `/application position-add`, then use `/application panel` wherever applicants should see the position dropdown.
6. Use `/config view` at any time to inspect the effective setup.

Until `/config setup` reports that setup is complete, normal commands remain locked. Required settings cover applications, staff movements, logging, announcements, manager/reviewer access, and the enabled ticket, starboard, or welcome modules. `/config`, `/help`, and centrally authorized `/maintenance` remain available in setup mode.

Questions 2–5 can be disabled by setting their value to `off`. Question 1 is always required. Application decisions are atomic, so two reviewers cannot process the same application twice.

Each application position has its own name, open/closed state, review channel, short dropdown description, and optional accepted role. New panels show only open positions (up to Discord's 25-option dropdown limit). Post a new panel after changing which positions are open.

## Commands

- `/config view|set-channel|set-role|set-text|set-option|reset`
- `/application panel|stats|position-add|position-toggle|position-remove|positions`
- `/staff` with hire, promote, demote, transfer, leave, return, resign, and terminate actions
- `/staff-roles add|remove|list` to trigger movements automatically when watched roles change
- `/announce`
- `/maintenance enable|disable|status` to restrict commands and post `@everyone` updates in the configured announcement channel
- `/help`
- `/moderation ban|kick|timeout|warn|warnings|clear-warnings|purge|lock|unlock|slowmode`
- `/clear amount [user]` to quickly delete recent messages
- `/level rank|leaderboard|manage`
- `/giveaway start|end|reroll|list`
- `/ticket panel|close|claim|add|remove|rename|transcript` with a category dropdown panel
- `/backup create|list|restore|delete`
- `/utility ping|avatar|userinfo|serverinfo|poll|remind|afk|custom-add|custom-run|custom-list|custom-delete`
- `/sticky set|stop|start|remove|list`
- `/reaction-role add|remove|list`
- `/automod keyword-add|keyword-remove|spam|mentions|status|violations`
- `/community starboard|welcome-test|embed|logs`

The `/staff` command can add and remove roles in the same action. Its announcement template supports `{user}`, `{actor}`, `{action}`, `{position}`, `{reason}`, and `{server}`. Decision DM templates support `{server}` and `{reason}`.

Add every staff rank with `/staff-roles add`. When a member's highest watched staff role changes, the bot automatically posts a hire, promotion, demotion, transfer, or removal in the configured staff movement channel. Discord's role order determines which rank is higher.

Configure `ticket_category`, `transcript_channel`, and `support_role` with `/config set-channel` and `/config set-role` before posting a ticket panel. Server backup restore is additive: it creates missing roles/channels and never deletes existing server structures. Type `RESTORE` explicitly when invoking it.

### Sticky messages, roles, and community automation

- Use `/sticky set` in a channel to create a persistent message. It reposts after activity while deleting its previous copy.
- Use `/reaction-role add` with an existing message ID, channel, emoji, and role. The bot role must be above every self-assignable role.
- Use `/automod` to manage Discord-native keyword, spam, and mention-spam rules. This works without the privileged Message Content intent.
- Configure the autorole with `/config set-role`; it is assigned on join independently of welcome messages. Use `/community autorole-test` to verify permissions and role hierarchy. Configure the welcome channel with `/config set-channel`, customize the messages, then enable welcome messages with `/config set-option`.
- Use `/community starboard` to select its channel, emoji, and reaction threshold.
- Configure `log_channel` and enable event logging to record joins, leaves, deleted/edited messages, role/channel changes, bans, and AutoMod actions.

Welcome templates support `{user}`, `{username}`, `{server}`, and `{member_count}`. Custom responses support `{user}` and `{server}`.

## MongoDB Atlas

Configuration and applications are stored in the database selected by `MONGODB_DATABASE` (default: `red_mushroom_bot`) using `settings` and `applications` collections. The bot creates its required indexes at startup.

Use a dedicated Atlas database user with `readWrite` access only to this database. Put its encoded connection string in `MONGODB_URI`; never commit your `.env` file. Add the outbound IP of every machine that runs the bot to the Atlas project access list.

To run the live database integration test, temporarily provide the same URI as `MONGODB_TEST_URI` and run `npm test`. Test records are uniquely named and removed afterward.
