import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { commands } from './commands.js';
import { handleExtraButton, handleExtraCommand, handleMessage, startBackgroundJobs } from './extra-features.js';
import {
  closeDatabase,
  createApplication,
  getAllSettings,
  getApplication,
  getApplicationStats,
  getPendingApplication,
  getSetting,
  initializeDatabase,
  resetSetting,
  reviewApplication,
  setApplicationMessage,
  setSetting,
  settingKeys
} from './database.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const channelKeys = ['application_channel', 'movement_channel', 'log_channel', 'announcement_channel', 'ticket_category', 'transcript_channel'];
const roleKeys = ['manager_role', 'reviewer_role', 'accepted_role', 'support_role'];
const allKeys = [...settingKeys, ...channelKeys, ...roleKeys];
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages] });

function color(guildId) {
  const value = getSetting(guildId, 'brand_color');
  return /^#[0-9a-f]{6}$/i.test(value) ? Number.parseInt(value.slice(1), 16) : 0xd93636;
}

function brandEmbed(guildId, data = {}) {
  return new EmbedBuilder()
    .setColor(color(guildId))
    .setAuthor({ name: getSetting(guildId, 'brand_name') })
    .setTimestamp()
    .setFooter({ text: data.footer || 'Red Mushroom Bot' });
}

function replaceTemplate(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value ?? 'Not specified')),
    template
  );
}

function hasConfiguredRole(member, guildId, key) {
  const id = getSetting(guildId, key);
  return Boolean(id && member.roles.cache.has(id));
}

function isManager(interaction) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
    || hasConfiguredRole(interaction.member, interaction.guildId, 'manager_role');
}

function isReviewer(interaction) {
  return isManager(interaction)
    || hasConfiguredRole(interaction.member, interaction.guildId, 'reviewer_role');
}

function isStaff(interaction) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageRoles) || isManager(interaction);
}

async function getTextChannel(guild, key) {
  const id = getSetting(guild.id, key);
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() ? channel : null;
}

async function logEvent(guild, title, description) {
  const channel = await getTextChannel(guild, 'log_channel');
  if (!channel) return;
  await channel.send({ embeds: [brandEmbed(guild.id).setTitle(title).setDescription(description).setColor(0x5865f2)] }).catch(console.error);
}

async function replyError(interaction, message) {
  const payload = { content: `❌ ${message}`, ephemeral: true };
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(token);
  const route = process.env.GUILD_ID
    ? Routes.applicationGuildCommands(clientId, process.env.GUILD_ID)
    : Routes.applicationCommands(clientId);
  await rest.put(route, { body: commands });
  console.log(`Registered ${commands.length} ${process.env.GUILD_ID ? 'guild' : 'global'} commands.`);
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Online as ${readyClient.user.tag} in ${readyClient.guilds.cache.size} server(s).`);
  await registerCommands().catch(error => console.error('Command registration failed:', error));
  readyClient.user.setActivity('/help • Staff management');
  startBackgroundJobs(readyClient);
});

client.on(Events.MessageCreate, message => handleMessage(message).catch(console.error));

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) await handleCommand(interaction);
    else if (interaction.isButton()) await handleButton(interaction);
    else if (interaction.isModalSubmit()) await handleModal(interaction);
  } catch (error) {
    console.error(error);
    await replyError(interaction, 'Something went wrong. Check the bot logs and permissions.').catch(() => {});
  }
});

async function handleCommand(interaction) {
  if (interaction.commandName === 'config') return handleConfig(interaction);
  if (interaction.commandName === 'application') return handleApplicationCommand(interaction);
  if (interaction.commandName === 'staff') return handleStaff(interaction);
  if (interaction.commandName === 'announce') return handleAnnouncement(interaction);
  if (interaction.commandName === 'help') return handleHelp(interaction);
  if (await handleExtraCommand(interaction, { brandEmbed, replyError, logEvent, getTextChannel, isManager, isReviewer })) return;
}

async function handleConfig(interaction) {
  if (!isManager(interaction)) return replyError(interaction, 'You need Manage Server or the configured manager role.');
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'view') {
    const settings = getAllSettings(interaction.guildId);
    const format = ([key, value]) => {
      if (channelKeys.includes(key)) return `**${key}:** ${value ? `<#${value}>` : '`not set`'}`;
      if (roleKeys.includes(key)) return `**${key}:** ${value ? `<@&${value}>` : '`not set`'}`;
      const shown = value.length > 140 ? `${value.slice(0, 137)}...` : value;
      return `**${key}:** ${shown || '`disabled`'}`;
    };
    const entries = allKeys.map(key => [key, settings[key] ?? '']);
    const chunks = [];
    for (let i = 0; i < entries.length; i += 8) chunks.push(entries.slice(i, i + 8).map(format).join('\n'));
    return interaction.reply({ embeds: chunks.map((text, i) => brandEmbed(interaction.guildId).setTitle(i ? 'Configuration (continued)' : 'Server configuration').setDescription(text)), ephemeral: true });
  }

  if (subcommand === 'set-channel') {
    const key = interaction.options.getString('purpose', true);
    const channel = interaction.options.getChannel('channel', true);
    if (key === 'ticket_category' && channel.type !== ChannelType.GuildCategory) return replyError(interaction, 'Ticket category must be a category channel.');
    if (key !== 'ticket_category' && !channel.isTextBased()) return replyError(interaction, 'This setting requires a text or announcement channel.');
    await setSetting(interaction.guildId, key, channel.id);
    await interaction.reply({ content: `✅ **${key}** is now ${channel}.`, ephemeral: true });
    return logEvent(interaction.guild, 'Configuration changed', `${interaction.user} set **${key}** to ${channel}.`);
  }

  if (subcommand === 'set-role') {
    const key = interaction.options.getString('purpose', true);
    const role = interaction.options.getRole('role', true);
    if (role.id === interaction.guildId) return replyError(interaction, 'The @everyone role cannot be used here.');
    await setSetting(interaction.guildId, key, role.id);
    await interaction.reply({ content: `✅ **${key}** is now ${role}.`, ephemeral: true });
    return logEvent(interaction.guild, 'Configuration changed', `${interaction.user} set **${key}** to ${role}.`);
  }

  if (subcommand === 'set-text') {
    const key = interaction.options.getString('key', true);
    let value = interaction.options.getString('value', true).trim();
    if (key.startsWith('application_question_') && key !== 'application_question_1' && value.toLowerCase() === 'off') value = '';
    if (!value && !key.match(/^application_question_[2-5]$/)) return replyError(interaction, 'This setting cannot be empty.');
    if (key === 'brand_color' && !/^#[0-9a-f]{6}$/i.test(value)) return replyError(interaction, 'Use a hex color such as `#d93636`.');
    if (key === 'brand_name' && value.length > 256) return replyError(interaction, 'Brand name must be 256 characters or fewer.');
    if (key === 'application_title' && value.length > 256) return replyError(interaction, 'Application title must be 256 characters or fewer.');
    await setSetting(interaction.guildId, key, value);
    await interaction.reply({ content: `✅ **${key}** was updated.`, ephemeral: true });
    return logEvent(interaction.guild, 'Configuration changed', `${interaction.user} updated **${key}**.`);
  }

  if (subcommand === 'set-option') {
    const key = interaction.options.getString('key', true);
    const enabled = interaction.options.getBoolean('enabled', true);
    await setSetting(interaction.guildId, key, String(enabled));
    return interaction.reply({ content: `✅ **${key}** is now **${enabled ? 'enabled' : 'disabled'}**.`, ephemeral: true });
  }

  if (subcommand === 'reset') {
    const key = interaction.options.getString('key', true);
    if (!allKeys.includes(key)) return replyError(interaction, `Unknown key. Use one shown in \`/config view\`.`);
    await resetSetting(interaction.guildId, key);
    return interaction.reply({ content: `✅ **${key}** was reset.`, ephemeral: true });
  }
}

async function handleApplicationCommand(interaction) {
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'panel') {
    if (!isManager(interaction)) return replyError(interaction, 'You need Manage Server or the configured manager role.');
    const embed = brandEmbed(interaction.guildId)
      .setTitle(getSetting(interaction.guildId, 'application_title'))
      .setDescription(getSetting(interaction.guildId, 'application_description'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('application:start').setLabel('Apply now').setEmoji('📝').setStyle(ButtonStyle.Primary)
    );
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: '✅ Application panel posted.', ephemeral: true });
  }
  if (!isReviewer(interaction)) return replyError(interaction, 'You need the reviewer or manager role.');
  const stats = await getApplicationStats(interaction.guildId);
  return interaction.reply({
    embeds: [brandEmbed(interaction.guildId).setTitle('Application statistics').addFields(
      { name: 'Pending', value: String(stats.pending || 0), inline: true },
      { name: 'Accepted', value: String(stats.accepted || 0), inline: true },
      { name: 'Rejected', value: String(stats.rejected || 0), inline: true },
      { name: 'Total', value: String(stats.total || 0), inline: true }
    )],
    ephemeral: true
  });
}

async function handleButton(interaction) {
  if (interaction.customId.startsWith('ticket:') || interaction.customId.startsWith('giveaway:')) {
    return handleExtraButton(interaction, { brandEmbed, replyError, logEvent, getTextChannel, isManager, isReviewer });
  }
  if (interaction.customId === 'application:start') {
    if (await getPendingApplication(interaction.guildId, interaction.user.id)) return replyError(interaction, 'You already have a pending application.');
    const modal = new ModalBuilder().setCustomId('application:submit').setTitle(getSetting(interaction.guildId, 'application_title').slice(0, 45));
    const rows = [];
    for (let i = 1; i <= 5; i += 1) {
      const question = getSetting(interaction.guildId, `application_question_${i}`);
      if (!question) continue;
      const input = new TextInputBuilder()
        .setCustomId(`question_${i}`)
        .setLabel(question.slice(0, 45))
        .setPlaceholder(question.slice(0, 100))
        .setStyle(i <= 2 ? TextInputStyle.Paragraph : TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(i <= 2 ? 1000 : 300);
      rows.push(new ActionRowBuilder().addComponents(input));
    }
    modal.addComponents(...rows);
    return interaction.showModal(modal);
  }

  const match = interaction.customId.match(/^application:(accept|reject):([a-f0-9]{24})$/i);
  if (!match) return;
  if (!isReviewer(interaction)) return replyError(interaction, 'You need the reviewer or manager role.');
  const application = await getApplication(match[2], interaction.guildId);
  if (!application || application.status !== 'pending') return replyError(interaction, 'This application has already been reviewed or no longer exists.');
  const modal = new ModalBuilder()
    .setCustomId(`application:decision:${match[1]}:${match[2]}`)
    .setTitle(`${match[1] === 'accept' ? 'Accept' : 'Reject'} application #${match[2]}`);
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('reason').setLabel('Review note / reason').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)
  ));
  return interaction.showModal(modal);
}

async function handleModal(interaction) {
  if (interaction.customId === 'application:submit') return submitApplication(interaction);
  const match = interaction.customId.match(/^application:decision:(accept|reject):([a-f0-9]{24})$/i);
  if (match) return decideApplication(interaction, match[1], match[2]);
}

async function submitApplication(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (await getPendingApplication(interaction.guildId, interaction.user.id)) return replyError(interaction, 'You already have a pending application.');
  const answers = [];
  for (let i = 1; i <= 5; i += 1) {
    const question = getSetting(interaction.guildId, `application_question_${i}`);
    if (!question) continue;
    answers.push({ question, answer: interaction.fields.getTextInputValue(`question_${i}`) });
  }
  const reviewChannel = await getTextChannel(interaction.guild, 'application_channel');
  if (!reviewChannel) return replyError(interaction, 'Applications are not configured yet. Please contact a server administrator.');
  const id = await createApplication(interaction.guildId, interaction.user.id, answers);
  const embed = brandEmbed(interaction.guildId, { footer: `Application #${id}` })
    .setTitle(`New application • ${interaction.user.username}`)
    .setThumbnail(interaction.user.displayAvatarURL())
    .setDescription(`Applicant: ${interaction.user} (\`${interaction.user.id}\`)`)
    .addFields(answers.map(({ question, answer }) => ({ name: question.slice(0, 256), value: answer.slice(0, 1024) })));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`application:accept:${id}`).setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application:reject:${id}`).setLabel('Reject').setEmoji('❌').setStyle(ButtonStyle.Danger)
  );
  const reviewerRole = getSetting(interaction.guildId, 'reviewer_role');
  const message = await reviewChannel.send({ content: reviewerRole ? `<@&${reviewerRole}>` : undefined, embeds: [embed], components: [row], allowedMentions: { roles: reviewerRole ? [reviewerRole] : [] } });
  await setApplicationMessage(id, message.id);
  await interaction.editReply(`✅ Your application **#${id}** was submitted. You will be notified when it is reviewed.`);
  return logEvent(interaction.guild, 'Application submitted', `${interaction.user} submitted application **#${id}**.`);
}

async function decideApplication(interaction, decision, id) {
  if (!isReviewer(interaction)) return replyError(interaction, 'You need the reviewer or manager role.');
  await interaction.deferReply({ ephemeral: true });
  const status = decision === 'accept' ? 'accepted' : 'rejected';
  const reason = interaction.fields.getTextInputValue('reason').trim();
  if (!await reviewApplication(id, interaction.guildId, status, interaction.user.id, reason)) return replyError(interaction, 'This application has already been reviewed.');
  const application = await getApplication(id, interaction.guildId);
  const member = await interaction.guild.members.fetch(application.user_id).catch(() => null);
  const acceptedRoleId = getSetting(interaction.guildId, 'accepted_role');
  let roleNote = '';
  if (status === 'accepted' && member && acceptedRoleId) {
    const added = await member.roles.add(acceptedRoleId, `Application #${id} accepted by ${interaction.user.tag}`).then(() => true).catch(() => false);
    if (!added) roleNote = ' I could not add the accepted role; check my role hierarchy.';
  }
  const reviewChannel = await getTextChannel(interaction.guild, 'application_channel');
  const reviewMessage = reviewChannel && application.review_message_id
    ? await reviewChannel.messages.fetch(application.review_message_id).catch(() => null)
    : null;
  if (reviewMessage) {
    const oldEmbed = EmbedBuilder.from(reviewMessage.embeds[0]);
    oldEmbed.setColor(status === 'accepted' ? 0x57f287 : 0xed4245).addFields({ name: 'Decision', value: `**${status.toUpperCase()}** by ${interaction.user}${reason ? `\n${reason}` : ''}` });
    await reviewMessage.edit({ embeds: [oldEmbed], components: [] });
  }
  if (getSetting(interaction.guildId, 'dm_on_decision') === 'true') {
    const templateKey = status === 'accepted' ? 'application_accepted_template' : 'application_rejected_template';
    const message = replaceTemplate(getSetting(interaction.guildId, templateKey), { server: interaction.guild.name, reason: reason || 'No reason provided' });
    await interaction.client.users.send(application.user_id, `${message}${reason ? `\n**Review note:** ${reason}` : ''}`).catch(() => {});
  }
  await interaction.editReply(`✅ Application **#${id}** was ${status}.${roleNote}`);
  return logEvent(interaction.guild, `Application ${status}`, `Application **#${id}** from <@${application.user_id}> was ${status} by ${interaction.user}.${reason ? `\n**Note:** ${reason}` : ''}`);
}

async function handleStaff(interaction) {
  if (!isStaff(interaction)) return replyError(interaction, 'You need Manage Roles or the configured manager role.');
  const targetUser = interaction.options.getUser('member', true);
  const target = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!target) return replyError(interaction, 'That user is not currently in this server.');
  const action = interaction.options.getString('action', true);
  const position = interaction.options.getString('position', true);
  const reason = interaction.options.getString('reason', true);
  const addRole = interaction.options.getRole('add-role');
  const removeRole = interaction.options.getRole('remove-role');
  await interaction.deferReply({ ephemeral: true });
  const destination = await getTextChannel(interaction.guild, 'movement_channel');
  if (!destination) return replyError(interaction, 'Set a staff movement channel with `/config set-channel` first.');
  if (addRole && !addRole.editable) return replyError(interaction, `I cannot add **${addRole.name}**. Move my bot role above it.`);
  if (removeRole && !removeRole.editable) return replyError(interaction, `I cannot remove **${removeRole.name}**. Move my bot role above it.`);
  const changes = [];
  if (removeRole) {
    await target.roles.remove(removeRole, `${action} by ${interaction.user.tag}: ${reason}`);
    changes.push(`removed ${removeRole.name}`);
  }
  if (addRole) {
    await target.roles.add(addRole, `${action} by ${interaction.user.tag}: ${reason}`);
    changes.push(`added ${addRole.name}`);
  }
  const description = replaceTemplate(getSetting(interaction.guildId, 'movement_template'), {
    user: targetUser,
    actor: interaction.user,
    action,
    position,
    reason,
    server: interaction.guild.name
  });
  const embed = brandEmbed(interaction.guildId)
    .setTitle(`Staff update • ${action[0].toUpperCase()}${action.slice(1)}`)
    .setDescription(description)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(changes.length ? [{ name: 'Role changes', value: changes.join(', ') }] : []);
  await destination.send({ embeds: [embed] });
  await interaction.editReply(`✅ Staff movement posted in ${destination}.`);
  return logEvent(interaction.guild, 'Staff movement recorded', `${targetUser} was **${action}** by ${interaction.user}. Position: **${position}**. Reason: ${reason}`);
}

async function handleAnnouncement(interaction) {
  if (!isManager(interaction)) return replyError(interaction, 'You need Manage Server or the configured manager role.');
  const channel = interaction.options.getChannel('channel') || await getTextChannel(interaction.guild, 'announcement_channel');
  if (!channel?.isTextBased()) return replyError(interaction, 'Choose a channel or configure the announcement channel first.');
  const title = interaction.options.getString('title', true);
  const message = interaction.options.getString('message', true).replaceAll('\\n', '\n');
  const mention = interaction.options.getString('mention');
  const mentionText = mention === 'everyone' ? '@everyone' : mention === 'here' ? '@here' : undefined;
  await channel.send({
    content: mentionText,
    embeds: [brandEmbed(interaction.guildId).setTitle(title).setDescription(message)],
    allowedMentions: { parse: mention ? ['everyone'] : [] }
  });
  await interaction.reply({ content: `✅ Announcement sent to ${channel}.`, ephemeral: true });
  return logEvent(interaction.guild, 'Announcement sent', `${interaction.user} sent **${title}** in ${channel}.`);
}

async function handleHelp(interaction) {
  const embed = brandEmbed(interaction.guildId)
    .setTitle('Command guide')
    .setDescription('One bot for your application and staff-management workflow.')
    .addFields(
      { name: 'Setup', value: '`/config view` — inspect settings\n`/config set-channel` — set destinations\n`/config set-role` — set access and accepted roles\n`/config set-text` — edit branding, questions, and templates\n`/config set-option` — toggle options' },
      { name: 'Applications', value: '`/application panel` — post the Apply button\n`/application stats` — review totals\nReviewers accept/reject with buttons in the configured review channel.' },
      { name: 'Staff & communication', value: '`/staff` — hire, promote, demote, transfer, leave, resign, or terminate\n`/announce` — post a branded announcement' },
      { name: 'Community management', value: '`/moderation` — bans, kicks, timeouts, warnings, purge, locks, and slowmode\n`/level` — XP ranks, leaderboard, and XP management\n`/giveaway` — start, end, reroll, and list giveaways' },
      { name: 'Support & safety', value: '`/ticket` — panels, private tickets, claims, members, transcripts, and closing\n`/backup` — create, list, safely restore, and delete server backups\n`/utility` — info, polls, reminders, AFK, and custom responses' },
      { name: 'Template placeholders', value: 'Movement: `{user}` `{actor}` `{action}` `{position}` `{reason}` `{server}`\nDecision DMs: `{server}` `{reason}`' }
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

process.on('SIGINT', async () => {
  await closeDatabase();
  client.destroy();
  process.exit(0);
});

try {
  await initializeDatabase();
  console.log(`Connected to MongoDB database ${process.env.MONGODB_DATABASE || 'red_mushroom_bot'}.`);
  await client.login(token);
} catch (error) {
  console.error('Startup failed:', error.message);
  await closeDatabase();
  process.exit(1);
}
