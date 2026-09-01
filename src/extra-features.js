import crypto from 'node:crypto';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder
} from 'discord.js';
import { ObjectId } from 'mongodb';
import { getCollection, getSetting } from './database.js';
import { handleCommunityCommand } from './community-features.js';

const numberEmoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const xpCooldowns = new Map();
const ticketTypes = {
  general: { label: 'General Support', emoji: '🎫', description: 'Questions, help, or general support', channel: 'support' },
  report: { label: 'Member Report', emoji: '🚨', description: 'Privately report a member or incident', channel: 'report' },
  appeal: { label: 'Punishment Appeal', emoji: '🛡️', description: 'Appeal a warning, timeout, kick, or ban', channel: 'appeal' },
  partnership: { label: 'Partnership', emoji: '🤝', description: 'Discuss a partnership or collaboration', channel: 'partner' },
  other: { label: 'Other', emoji: '❓', description: 'Anything that does not fit another category', channel: 'other' }
};

export function parseDuration(input) {
  const match = String(input).trim().toLowerCase().match(/^(\d+)(s|m|h|d|w)$/);
  if (!match) return null;
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  return Number(match[1]) * units[match[2]];
}

function hasPermission(interaction, permission) {
  return interaction.memberPermissions?.has(permission);
}

async function requirePermission(interaction, permission, helpers) {
  if (hasPermission(interaction, permission) || helpers.isManager(interaction)) return true;
  await helpers.replyError(interaction, 'You do not have permission to use this command.');
  return false;
}

async function addCase(interaction, type, userId, reason, metadata = {}) {
  await getCollection('moderation_cases').insertOne({
    guild_id: interaction.guildId,
    user_id: userId,
    moderator_id: interaction.user.id,
    type,
    reason: reason || 'No reason provided',
    metadata,
    created_at: new Date()
  });
}

export async function handleExtraCommand(interaction, helpers) {
  const handlers = {
    clear: handleClear,
    moderation: handleModeration,
    level: handleLevel,
    giveaway: handleGiveaway,
    ticket: handleTicket,
    backup: handleBackup,
    utility: handleUtility,
    sticky: handleCommunityCommand,
    'reaction-role': handleCommunityCommand,
    automod: handleCommunityCommand,
    community: handleCommunityCommand
  };
  const handler = handlers[interaction.commandName];
  if (!handler) return false;
  const settingKey = {
    clear: 'moderation_enabled', moderation: 'moderation_enabled', level: 'levels_enabled', giveaway: 'giveaways_enabled',
    ticket: 'tickets_enabled', backup: 'backups_enabled', sticky: 'sticky_enabled',
    'reaction-role': 'reaction_roles_enabled', automod: 'automod_enabled'
  }[interaction.commandName];
  if (settingKey && getSetting(interaction.guildId, settingKey) !== 'true') {
    await helpers.replyError(interaction, `This module is disabled. A manager can enable it with \`/config set-option\`.`);
    return true;
  }
  await handler(interaction, helpers);
  return true;
}

async function handleClear(interaction, helpers) {
  if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return helpers.replyError(interaction, 'You need Manage Messages to use `/clear`.');
  const botMember = interaction.guild.members.me;
  if (!interaction.channel?.isTextBased() || !interaction.channel.messages) return helpers.replyError(interaction, 'Use `/clear` in a text channel.');
  if (!interaction.channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageMessages)) return helpers.replyError(interaction, 'My bot role needs **Manage Messages** in this channel.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const amount = interaction.options.getInteger('amount', true);
  const targetUser = interaction.options.getUser('user');
  const messages = await interaction.channel.messages.fetch({ limit: 100 });
  const selected = targetUser
    ? messages.filter(message => message.author.id === targetUser.id).first(amount)
    : messages.first(amount);
  if (!selected.length) return interaction.editReply(targetUser ? `ℹ️ No recent messages from ${targetUser} were found.` : 'ℹ️ No recent messages were found.');
  const deleted = await interaction.channel.bulkDelete(selected, true);
  const filterText = targetUser ? ` from ${targetUser}` : '';
  return interaction.editReply(`🧹 Deleted **${deleted.size}** message(s)${filterText}. Messages older than 14 days cannot be bulk deleted.`);
}

async function handleModeration(interaction, helpers) {
  if (!await requirePermission(interaction, PermissionFlagsBits.ModerateMembers, helpers)) return;
  const sub = interaction.options.getSubcommand();
  const targetUser = interaction.options.getUser('user');
  const reason = interaction.options.getString('reason') || 'No reason provided';
  const botMember = interaction.guild.members.me;

  if (sub === 'warnings') {
    const warnings = await getCollection('moderation_cases').find({ guild_id: interaction.guildId, user_id: targetUser.id, type: 'warn' }).sort({ created_at: -1 }).limit(15).toArray();
    const text = warnings.length ? warnings.map((item, i) => `**${i + 1}.** ${item.reason} — <@${item.moderator_id}> <t:${Math.floor(item.created_at.getTime() / 1000)}:R>`).join('\n') : 'No warnings found.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(`Warnings • ${targetUser.username}`).setDescription(text)], flags: MessageFlags.Ephemeral });
  }

  if (sub === 'purge') {
    if (!hasPermission(interaction, PermissionFlagsBits.ManageMessages)) return helpers.replyError(interaction, 'You need Manage Messages.');
    if (!interaction.channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageMessages)) return helpers.replyError(interaction, 'My bot role needs **Manage Messages** in this channel.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const amount = interaction.options.getInteger('amount', true);
    const messages = await interaction.channel.messages.fetch({ limit: 100 });
    const selected = targetUser ? messages.filter(message => message.author.id === targetUser.id).first(amount) : messages.first(amount);
    const deleted = await interaction.channel.bulkDelete(selected, true);
    return interaction.editReply(`✅ Deleted ${deleted.size} messages.`);
  }

  if (sub === 'lock' || sub === 'unlock') {
    if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return helpers.replyError(interaction, 'You need Manage Channels.');
    if (!interaction.channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageChannels)) return helpers.replyError(interaction, 'My bot role needs **Manage Channels** here.');
    await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: sub === 'lock' ? false : null }, { reason });
    await addCase(interaction, sub, interaction.guildId, reason, { channel_id: interaction.channelId });
    return interaction.reply({ content: `✅ Channel ${sub === 'lock' ? 'locked' : 'unlocked'}.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'slowmode') {
    if (!hasPermission(interaction, PermissionFlagsBits.ManageChannels)) return helpers.replyError(interaction, 'You need Manage Channels.');
    if (!interaction.channel.permissionsFor(botMember).has(PermissionFlagsBits.ManageChannels)) return helpers.replyError(interaction, 'My bot role needs **Manage Channels** here.');
    const seconds = interaction.options.getInteger('seconds', true);
    await interaction.channel.setRateLimitPerUser(seconds, `Changed by ${interaction.user.tag}`);
    return interaction.reply({ content: `✅ Slowmode set to ${seconds} seconds.`, flags: MessageFlags.Ephemeral });
  }

  if (sub === 'clear-warnings') {
    const result = await getCollection('moderation_cases').deleteMany({ guild_id: interaction.guildId, user_id: targetUser.id, type: 'warn' });
    await addCase(interaction, 'clear-warnings', targetUser.id, reason, { cleared: result.deletedCount });
    return interaction.reply({ content: `✅ Cleared ${result.deletedCount} warnings for ${targetUser}.`, flags: MessageFlags.Ephemeral });
  }

  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
  if (!member && ['kick', 'timeout'].includes(sub)) return helpers.replyError(interaction, 'That user is not currently in this server.');
  if (member?.id === interaction.guild.ownerId) return helpers.replyError(interaction, 'The server owner cannot be moderated.');
  if (member && interaction.user.id !== interaction.guild.ownerId && interaction.member.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return helpers.replyError(interaction, 'You cannot moderate a member whose highest role is equal to or above yours.');
  }
  if (sub === 'ban') {
    if (!hasPermission(interaction, PermissionFlagsBits.BanMembers)) return helpers.replyError(interaction, 'You need Ban Members.');
    if (!botMember.permissions.has(PermissionFlagsBits.BanMembers)) return helpers.replyError(interaction, 'My bot role needs the **Ban Members** permission.');
    if (member && !member.bannable) return helpers.replyError(interaction, 'I cannot ban that member. Move my bot role above their highest role.');
    const deleteDays = interaction.options.getInteger('delete-days') || 0;
    await interaction.guild.members.ban(targetUser.id, { deleteMessageSeconds: deleteDays * 86400, reason });
  } else if (sub === 'kick') {
    if (!hasPermission(interaction, PermissionFlagsBits.KickMembers)) return helpers.replyError(interaction, 'You need Kick Members.');
    if (!botMember.permissions.has(PermissionFlagsBits.KickMembers)) return helpers.replyError(interaction, 'My bot role needs the **Kick Members** permission.');
    if (!member.kickable) return helpers.replyError(interaction, 'I cannot kick that member. Move my bot role above their highest role.');
    await member.kick(reason);
  } else if (sub === 'timeout') {
    if (!botMember.permissions.has(PermissionFlagsBits.ModerateMembers)) return helpers.replyError(interaction, 'My bot role needs the **Timeout Members** permission.');
    if (!member.moderatable) return helpers.replyError(interaction, 'I cannot timeout that member. Move my bot role above their highest role.');
    const input = interaction.options.getString('duration', true);
    const duration = input.toLowerCase() === 'off' ? null : parseDuration(input);
    if (duration === null && input.toLowerCase() !== 'off') return helpers.replyError(interaction, 'Invalid duration. Use values such as `10m`, `2h`, or `7d`.');
    if (duration && duration > 28 * 86400000) return helpers.replyError(interaction, 'Discord timeouts cannot exceed 28 days.');
    await member.timeout(duration, reason);
  } else if (sub === 'warn') {
    await targetUser.send(`You were warned in **${interaction.guild.name}**.\n**Reason:** ${reason}`).catch(() => {});
  }
  await addCase(interaction, sub, targetUser.id, reason);
  await helpers.logEvent(interaction.guild, `Moderation • ${sub}`, `${targetUser} was **${sub}** by ${interaction.user}.\n**Reason:** ${reason}`);
  const completedAction = { ban: 'banned', kick: 'kicked', timeout: 'timed out/updated', warn: 'warned' }[sub];
  return interaction.reply({ content: `✅ ${targetUser} was ${completedAction}.`, flags: MessageFlags.Ephemeral });
}

function levelFromXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100));
}

async function handleLevel(interaction, helpers) {
  const sub = interaction.options.getSubcommand();
  const levels = getCollection('levels');
  if (sub === 'rank') {
    const user = interaction.options.getUser('user') || interaction.user;
    const row = await levels.findOne({ guild_id: interaction.guildId, user_id: user.id });
    const xp = row?.xp || 0;
    const rank = await levels.countDocuments({ guild_id: interaction.guildId, xp: { $gt: xp } }) + 1;
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(`Rank • ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields({ name: 'Level', value: String(levelFromXp(xp)), inline: true }, { name: 'XP', value: String(xp), inline: true }, { name: 'Rank', value: `#${rank}`, inline: true })] });
  }
  if (sub === 'leaderboard') {
    const rows = await levels.find({ guild_id: interaction.guildId }).sort({ xp: -1 }).limit(10).toArray();
    const text = rows.length ? rows.map((row, i) => `**${i + 1}.** <@${row.user_id}> — Level ${levelFromXp(row.xp)} (${row.xp} XP)`).join('\n') : 'No XP has been earned yet.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('XP leaderboard').setDescription(text)] });
  }
  if (!await requirePermission(interaction, PermissionFlagsBits.ManageGuild, helpers)) return;
  const user = interaction.options.getUser('user', true);
  const action = interaction.options.getString('action', true);
  const amount = interaction.options.getInteger('amount', true);
  const update = action === 'set' ? { $set: { xp: amount } } : { $inc: { xp: action === 'add' ? amount : -amount } };
  await levels.updateOne({ guild_id: interaction.guildId, user_id: user.id }, { ...update, $setOnInsert: { guild_id: interaction.guildId, user_id: user.id } }, { upsert: true });
  await levels.updateOne({ guild_id: interaction.guildId, user_id: user.id, xp: { $lt: 0 } }, { $set: { xp: 0 } });
  return interaction.reply({ content: `✅ XP ${action} operation completed for ${user}.`, flags: MessageFlags.Ephemeral });
}

async function findGiveaway(guildId, identifier) {
  const query = { guild_id: guildId, $or: [{ message_id: identifier }] };
  if (/^[a-f0-9]{24}$/i.test(identifier)) query.$or.push({ _id: new ObjectId(identifier) });
  return getCollection('giveaways').findOne(query);
}

function pickWinners(entries, count) {
  const pool = [...new Set(entries)];
  const winners = [];
  while (pool.length && winners.length < count) winners.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
  return winners;
}

async function finishGiveaway(client, giveaway, reroll = false) {
  const eligibleEntries = reroll
    ? (giveaway.entries || []).filter(id => !(giveaway.winners || []).includes(id))
    : (giveaway.entries || []);
  const winners = pickWinners(eligibleEntries.length ? eligibleEntries : (giveaway.entries || []), giveaway.winner_count);
  const guild = await client.guilds.fetch(giveaway.guild_id).catch(() => null);
  const channel = guild ? await guild.channels.fetch(giveaway.channel_id).catch(() => null) : null;
  const message = channel?.isTextBased() ? await channel.messages.fetch(giveaway.message_id).catch(() => null) : null;
  const winnerText = winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'No valid entries';
  if (reroll) {
    await channel?.send(`🎉 Rerolled **${giveaway.prize}**: ${winnerText}`);
  } else {
    if (message) {
      const embed = EmbedBuilder.from(message.embeds[0]).setColor(0x95a5a6).setDescription(`Ended • Winners: ${winnerText}`);
      const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:ended:${giveaway._id}`).setLabel(`${giveaway.entries?.length || 0} entries`).setStyle(ButtonStyle.Secondary).setDisabled(true));
      await message.edit({ embeds: [embed], components: [row] });
    }
    await channel?.send(`🎉 **${giveaway.prize}** ended! Winner${winners.length === 1 ? '' : 's'}: ${winnerText}`);
    await getCollection('giveaways').updateOne({ _id: giveaway._id, status: 'active' }, { $set: { status: 'ended', ended_at: new Date(), winners } });
  }
  return winners;
}

async function handleGiveaway(interaction, helpers) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'list') {
    const rows = await getCollection('giveaways').find({ guild_id: interaction.guildId, status: 'active' }).sort({ ends_at: 1 }).limit(20).toArray();
    const text = rows.length ? rows.map(row => `• **${row.prize}** — \`${row._id}\` — <t:${Math.floor(row.ends_at.getTime() / 1000)}:R>`).join('\n') : 'No active giveaways.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('Active giveaways').setDescription(text)], flags: MessageFlags.Ephemeral });
  }
  if (!await requirePermission(interaction, PermissionFlagsBits.ManageEvents, helpers)) return;
  if (sub === 'start') {
    const duration = parseDuration(interaction.options.getString('duration', true));
    if (!duration || duration < 10_000 || duration > 30 * 86400000) return helpers.replyError(interaction, 'Duration must be between 10 seconds and 30 days.');
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    const prize = interaction.options.getString('prize', true);
    const winnerCount = interaction.options.getInteger('winners', true);
    const result = await getCollection('giveaways').insertOne({ guild_id: interaction.guildId, channel_id: channel.id, host_id: interaction.user.id, prize, winner_count: winnerCount, entries: [], status: 'active', ends_at: new Date(Date.now() + duration), created_at: new Date(), message_id: null });
    const embed = (await helpers.brandEmbed(interaction.guildId, { footer: `Giveaway ${result.insertedId}` })).setTitle(`🎉 ${prize}`).setDescription(`Click **Enter giveaway** below.\nWinners: **${winnerCount}**\nEnds: <t:${Math.floor((Date.now() + duration) / 1000)}:R>\nHosted by ${interaction.user}`);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`giveaway:enter:${result.insertedId}`).setLabel('Enter giveaway').setEmoji('🎉').setStyle(ButtonStyle.Success));
    const message = await channel.send({ embeds: [embed], components: [row] });
    await getCollection('giveaways').updateOne({ _id: result.insertedId }, { $set: { message_id: message.id } });
    return interaction.reply({ content: `✅ Giveaway started in ${channel}. ID: \`${result.insertedId}\``, flags: MessageFlags.Ephemeral });
  }
  const giveaway = await findGiveaway(interaction.guildId, interaction.options.getString('id', true));
  if (!giveaway) return helpers.replyError(interaction, 'Giveaway not found.');
  if (sub === 'end') {
    if (giveaway.status !== 'active') return helpers.replyError(interaction, 'That giveaway has already ended.');
    await finishGiveaway(interaction.client, giveaway);
  } else {
    if (giveaway.status !== 'ended') return helpers.replyError(interaction, 'Only ended giveaways can be rerolled.');
    await finishGiveaway(interaction.client, giveaway, true);
  }
  return interaction.reply({ content: `✅ Giveaway ${sub === 'end' ? 'ended' : 'rerolled'}.`, flags: MessageFlags.Ephemeral });
}

async function currentTicket(interaction) {
  return getCollection('tickets').findOne({ guild_id: interaction.guildId, channel_id: interaction.channelId, status: 'open' });
}

async function createTranscript(channel) {
  const messages = await channel.messages.fetch({ limit: 100 });
  const text = [...messages.values()].reverse().map(message => `[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.cleanContent}${message.attachments.size ? ` ${message.attachments.map(a => a.url).join(' ')}` : ''}`).join('\n');
  return new AttachmentBuilder(Buffer.from(text || 'No messages.'), { name: `transcript-${channel.name}.txt` });
}

async function handleTicket(interaction, helpers) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'panel') {
    if (!await requirePermission(interaction, PermissionFlagsBits.ManageGuild, helpers)) return;
    const title = interaction.options.getString('title') || 'Support tickets';
    const description = interaction.options.getString('description') || 'Choose a category below to open a private ticket.';
    const menu = new StringSelectMenuBuilder()
      .setCustomId('ticket:create')
      .setPlaceholder('Choose a ticket category...')
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(Object.entries(ticketTypes).map(([value, type]) => ({
        label: type.label,
        value,
        description: type.description,
        emoji: type.emoji
      })));
    const row = new ActionRowBuilder().addComponents(menu);
    await interaction.channel.send({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(title).setDescription(description)], components: [row] });
    return interaction.reply({ content: '✅ Ticket panel posted.', flags: MessageFlags.Ephemeral });
  }
  const ticket = await currentTicket(interaction);
  if (!ticket) return helpers.replyError(interaction, 'This command must be used inside an open ticket.');
  const isOwner = ticket.user_id === interaction.user.id;
  const supportRole = getSetting(interaction.guildId, 'support_role');
  const isSupport = helpers.isReviewer(interaction) || Boolean(supportRole && interaction.member.roles.cache.has(supportRole));
  if (!isOwner && !isSupport) return helpers.replyError(interaction, 'Only the ticket owner or support staff can do that.');
  if (sub === 'transcript') return interaction.reply({ files: [await createTranscript(interaction.channel)], flags: MessageFlags.Ephemeral });
  if (sub === 'add' || sub === 'remove') {
    if (!isSupport) return helpers.replyError(interaction, 'Only support staff can manage ticket members.');
    const user = interaction.options.getUser('user', true);
    await interaction.channel.permissionOverwrites.edit(user.id, { ViewChannel: sub === 'add' ? true : null, SendMessages: sub === 'add' ? true : null });
    return interaction.reply({ content: `✅ ${user} was ${sub === 'add' ? 'added to' : 'removed from'} the ticket.`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'claim') {
    if (!isSupport) return helpers.replyError(interaction, 'Only support staff can claim tickets.');
    await getCollection('tickets').updateOne({ _id: ticket._id }, { $set: { claimed_by: interaction.user.id } });
    return interaction.reply(`🔒 Ticket claimed by ${interaction.user}.`);
  }
  if (sub === 'rename') {
    if (!isSupport) return helpers.replyError(interaction, 'Only support staff can rename tickets.');
    await interaction.channel.setName(interaction.options.getString('name', true));
    return interaction.reply({ content: '✅ Ticket renamed.', flags: MessageFlags.Ephemeral });
  }
  const transcript = await createTranscript(interaction.channel);
  const transcriptChannelId = getSetting(interaction.guildId, 'transcript_channel');
  const transcriptChannel = transcriptChannelId ? await interaction.guild.channels.fetch(transcriptChannelId).catch(() => null) : null;
  if (transcriptChannel?.isTextBased()) await transcriptChannel.send({ content: `Ticket ${interaction.channel.name} closed by ${interaction.user}.`, files: [transcript] });
  await getCollection('tickets').updateOne({ _id: ticket._id }, { $set: { status: 'closed', closed_at: new Date(), closed_by: interaction.user.id } });
  await interaction.reply('🔒 Ticket closing in 5 seconds.');
  setTimeout(() => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(() => {}), 5000);
}

async function handleBackup(interaction, helpers) {
  if (!await requirePermission(interaction, PermissionFlagsBits.Administrator, helpers)) return;
  const sub = interaction.options.getSubcommand();
  const backups = getCollection('backups');
  if (sub === 'create') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const roles = interaction.guild.roles.cache.filter(role => role.id !== interaction.guildId && !role.managed).map(role => ({ name: role.name, color: role.hexColor, hoist: role.hoist, mentionable: role.mentionable, permissions: role.permissions.bitfield.toString(), position: role.position }));
    const channels = interaction.guild.channels.cache.map(channel => ({ name: channel.name, type: channel.type, parent_name: channel.parent?.name || null, position: channel.position, topic: 'topic' in channel ? channel.topic : null, nsfw: 'nsfw' in channel ? channel.nsfw : false, rate_limit: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0 }));
    const result = await backups.insertOne({ guild_id: interaction.guildId, name: interaction.options.getString('name', true), created_by: interaction.user.id, created_at: new Date(), roles, channels });
    return interaction.editReply(`✅ Backup created: \`${result.insertedId}\` (${roles.length} roles, ${channels.length} channels).`);
  }
  if (sub === 'list') {
    const rows = await backups.find({ guild_id: interaction.guildId }).sort({ created_at: -1 }).limit(20).toArray();
    const text = rows.length ? rows.map(row => `• **${row.name}** — \`${row._id}\` — <t:${Math.floor(row.created_at.getTime() / 1000)}:R>`).join('\n') : 'No backups stored.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('Server backups').setDescription(text)], flags: MessageFlags.Ephemeral });
  }
  const id = interaction.options.getString('id', true);
  if (!/^[a-f0-9]{24}$/i.test(id)) return helpers.replyError(interaction, 'Invalid backup ID.');
  const backup = await backups.findOne({ _id: new ObjectId(id), guild_id: interaction.guildId });
  if (!backup) return helpers.replyError(interaction, 'Backup not found.');
  if (sub === 'delete') {
    await backups.deleteOne({ _id: backup._id });
    return interaction.reply({ content: '✅ Backup deleted.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.options.getString('confirmation', true) !== 'RESTORE') return helpers.replyError(interaction, 'Type `RESTORE` exactly to confirm.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let roleCount = 0;
  for (const role of [...backup.roles].sort((a, b) => a.position - b.position)) {
    if (interaction.guild.roles.cache.some(existing => existing.name === role.name)) continue;
    await interaction.guild.roles.create({ name: role.name, color: role.color, hoist: role.hoist, mentionable: role.mentionable, permissions: BigInt(role.permissions), reason: `Backup ${backup._id} restored by ${interaction.user.tag}` });
    roleCount += 1;
  }
  const categoryMap = new Map();
  for (const channel of backup.channels.filter(item => item.type === ChannelType.GuildCategory)) {
    let existing = interaction.guild.channels.cache.find(item => item.type === ChannelType.GuildCategory && item.name === channel.name);
    if (!existing) existing = await interaction.guild.channels.create({ name: channel.name, type: ChannelType.GuildCategory, position: channel.position });
    categoryMap.set(channel.name, existing.id);
  }
  let channelCount = 0;
  const supported = [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice];
  for (const channel of backup.channels.filter(item => supported.includes(item.type))) {
    if (interaction.guild.channels.cache.some(existing => existing.type === channel.type && existing.name === channel.name)) continue;
    await interaction.guild.channels.create({ name: channel.name, type: channel.type, parent: categoryMap.get(channel.parent_name), position: channel.position, topic: channel.topic || undefined, nsfw: channel.nsfw || false, rateLimitPerUser: channel.rate_limit || 0 });
    channelCount += 1;
  }
  await interaction.editReply(`✅ Safe restore complete: created ${roleCount} roles and ${channelCount} channels. Existing structures were not deleted.`);
}

async function handleUtility(interaction, helpers) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'ping') return interaction.reply({ content: `🏓 Gateway: ${interaction.client.ws.ping}ms • Uptime: ${Math.floor(process.uptime())}s`, flags: MessageFlags.Ephemeral });
  if (sub === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(`${user.username}'s avatar`).setImage(user.displayAvatarURL({ size: 4096 }))] });
  }
  if (sub === 'userinfo') {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(`User info • ${user.username}`).setThumbnail(user.displayAvatarURL()).addFields({ name: 'User ID', value: user.id, inline: true }, { name: 'Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>`, inline: true }, { name: 'Joined', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Not in server', inline: true }, { name: 'Roles', value: member ? member.roles.cache.filter(role => role.id !== interaction.guildId).map(String).join(' ').slice(0, 1024) || 'None' : 'None' })] });
  }
  if (sub === 'serverinfo') return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(interaction.guild.name).setThumbnail(interaction.guild.iconURL()).addFields({ name: 'Members', value: String(interaction.guild.memberCount), inline: true }, { name: 'Channels', value: String(interaction.guild.channels.cache.size), inline: true }, { name: 'Roles', value: String(interaction.guild.roles.cache.size), inline: true }, { name: 'Created', value: `<t:${Math.floor(interaction.guild.createdTimestamp / 1000)}:F>` })] });
  if (sub === 'poll') {
    const choices = interaction.options.getString('options', true).split('|').map(item => item.trim()).filter(Boolean);
    if (choices.length < 2 || choices.length > 10) return helpers.replyError(interaction, 'Provide 2–10 choices separated by `|`.');
    const description = choices.map((choice, i) => `${numberEmoji[i]} ${choice}`).join('\n');
    const question = interaction.options.getString('question', true);
    const message = await interaction.channel.send({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle(question.slice(0, 256)).setDescription(`${question.length > 256 ? `${question}\n\n` : ''}${description}`).setFooter({ text: `Poll by ${interaction.user.tag}` })] });
    for (let i = 0; i < choices.length; i += 1) await message.react(numberEmoji[i]);
    return interaction.reply({ content: `✅ Poll posted: ${message.url}`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'remind') {
    const duration = parseDuration(interaction.options.getString('duration', true));
    if (!duration || duration < 10_000 || duration > 365 * 86400000) return helpers.replyError(interaction, 'Duration must be between 10 seconds and 365 days.');
    await getCollection('reminders').insertOne({ user_id: interaction.user.id, guild_id: interaction.guildId, channel_id: interaction.channelId, message: interaction.options.getString('message', true), due_at: new Date(Date.now() + duration), delivered: false, created_at: new Date() });
    return interaction.reply({ content: `✅ I will remind you <t:${Math.floor((Date.now() + duration) / 1000)}:R>.`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'afk') {
    const status = interaction.options.getString('status', true);
    if (status.toLowerCase() === 'off') await getCollection('afk').deleteOne({ guild_id: interaction.guildId, user_id: interaction.user.id });
    else await getCollection('afk').updateOne({ guild_id: interaction.guildId, user_id: interaction.user.id }, { $set: { status, since: new Date() } }, { upsert: true });
    return interaction.reply({ content: `✅ AFK ${status.toLowerCase() === 'off' ? 'cleared' : 'set'}.`, flags: MessageFlags.Ephemeral });
  }
  const commands = getCollection('custom_commands');
  const name = interaction.options.getString('name')?.toLowerCase();
  if (sub === 'custom-run') {
    const row = await commands.findOne({ guild_id: interaction.guildId, name });
    if (!row) return helpers.replyError(interaction, 'Custom response not found.');
    return interaction.reply({ content: row.response.replaceAll('{user}', String(interaction.user)).replaceAll('{server}', interaction.guild.name), allowedMentions: { parse: [], users: [interaction.user.id] } });
  }
  if (sub === 'custom-list') {
    const rows = await commands.find({ guild_id: interaction.guildId }).sort({ name: 1 }).limit(50).toArray();
    return interaction.reply({ content: rows.length ? rows.map(row => `\`${row.name}\``).join(', ') : 'No custom responses.', flags: MessageFlags.Ephemeral });
  }
  if (!await requirePermission(interaction, PermissionFlagsBits.ManageGuild, helpers)) return;
  if (!/^[a-z0-9_-]{1,32}$/.test(name)) return helpers.replyError(interaction, 'Names may only contain lowercase letters, numbers, `_`, and `-`.');
  if (sub === 'custom-add') {
    await commands.updateOne({ guild_id: interaction.guildId, name }, { $set: { response: interaction.options.getString('response', true), updated_by: interaction.user.id, updated_at: new Date() } }, { upsert: true });
    return interaction.reply({ content: `✅ Custom response \`${name}\` saved.`, flags: MessageFlags.Ephemeral });
  }
  await commands.deleteOne({ guild_id: interaction.guildId, name });
  return interaction.reply({ content: `✅ Custom response \`${name}\` deleted.`, flags: MessageFlags.Ephemeral });
}

async function createTicket(interaction, helpers, selectedType = 'general') {
  if (getSetting(interaction.guildId, 'tickets_enabled') !== 'true') return helpers.replyError(interaction, 'The ticket module is disabled.');
  const existing = await getCollection('tickets').findOne({ guild_id: interaction.guildId, user_id: interaction.user.id, status: 'open' });
  if (existing) return helpers.replyError(interaction, `You already have an open ticket: <#${existing.channel_id}>`);
  const type = ticketTypes[selectedType] || ticketTypes.general;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const supportRole = getSetting(interaction.guildId, 'support_role');
  const category = getSetting(interaction.guildId, 'ticket_category');
  const overwrites = [
    { id: interaction.guildId, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: interaction.guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
  ];
  if (supportRole) overwrites.push({ id: supportRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const username = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60) || interaction.user.id;
  const channel = await interaction.guild.channels.create({
    name: `${type.channel}-${username}`.slice(0, 80),
    type: ChannelType.GuildText,
    parent: category || undefined,
    permissionOverwrites: overwrites,
    topic: `${type.label} opened by ${interaction.user.tag} (${interaction.user.id})`
  });
  await getCollection('tickets').insertOne({
    guild_id: interaction.guildId,
    channel_id: channel.id,
    user_id: interaction.user.id,
    type: selectedType,
    type_label: type.label,
    status: 'open',
    claimed_by: null,
    created_at: new Date()
  });
  await channel.send({
    content: `${interaction.user}${supportRole ? ` <@&${supportRole}>` : ''}`,
    embeds: [(await helpers.brandEmbed(interaction.guildId))
      .setTitle(`${type.emoji} ${type.label}`)
      .setDescription(`${type.description}\n\nDescribe what you need help with. Staff can manage this ticket with \`/ticket\`.`)],
    allowedMentions: { users: [interaction.user.id], roles: supportRole ? [supportRole] : [] }
  });
  await interaction.editReply(`✅ **${type.label}** ticket created: ${channel}`);
  return true;
}

export async function handleExtraSelect(interaction, helpers) {
  if (interaction.customId !== 'ticket:create') return false;
  return createTicket(interaction, helpers, interaction.values[0]);
}

export async function handleExtraButton(interaction, helpers) {
  if (interaction.customId === 'ticket:create') return createTicket(interaction, helpers);
  const match = interaction.customId.match(/^giveaway:enter:([a-f0-9]{24})$/i);
  if (!match) return false;
  const giveaway = await getCollection('giveaways').findOne({ _id: new ObjectId(match[1]), guild_id: interaction.guildId, status: 'active' });
  if (!giveaway || giveaway.ends_at <= new Date()) return helpers.replyError(interaction, 'This giveaway has ended.');
  const alreadyEntered = giveaway.entries?.includes(interaction.user.id);
  await getCollection('giveaways').updateOne({ _id: giveaway._id }, alreadyEntered ? { $pull: { entries: interaction.user.id } } : { $addToSet: { entries: interaction.user.id } });
  await interaction.reply({ content: alreadyEntered ? 'You left the giveaway.' : '🎉 You entered the giveaway!', flags: MessageFlags.Ephemeral });
  return true;
}

export async function handleMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cooldownKey = `${message.guild.id}:${message.author.id}`;
  if (!xpCooldowns.has(cooldownKey)) {
    xpCooldowns.set(cooldownKey, Date.now());
    setTimeout(() => xpCooldowns.delete(cooldownKey), 60_000).unref();
    if (getSetting(message.guild.id, 'levels_enabled') === 'true') {
      const gained = crypto.randomInt(15, 26);
      const before = await getCollection('levels').findOneAndUpdate(
        { guild_id: message.guild.id, user_id: message.author.id },
        { $inc: { xp: gained }, $setOnInsert: { guild_id: message.guild.id, user_id: message.author.id } },
        { upsert: true, returnDocument: 'before' }
      );
      const oldXp = before?.xp || 0;
      const newXp = oldXp + gained;
      if (levelFromXp(newXp) > levelFromXp(oldXp)) await message.channel.send(`🎉 ${message.author}, you reached **level ${levelFromXp(newXp)}**!`).catch(() => {});
    }
  }
  const ownAfk = await getCollection('afk').findOneAndDelete({ guild_id: message.guild.id, user_id: message.author.id });
  if (ownAfk) await message.reply('Welcome back—your AFK status was cleared.').catch(() => {});
  for (const user of message.mentions.users.values()) {
    const afk = await getCollection('afk').findOne({ guild_id: message.guild.id, user_id: user.id });
    if (afk) await message.reply(`${user.username} is AFK: ${afk.status} • <t:${Math.floor(afk.since.getTime() / 1000)}:R>`).catch(() => {});
  }
}

export function startBackgroundJobs(client) {
  const run = async () => {
    const now = new Date();
    const giveaways = await getCollection('giveaways').find({ status: 'active', ends_at: { $lte: now } }).limit(20).toArray();
    for (const giveaway of giveaways) await finishGiveaway(client, giveaway).catch(console.error);
    const reminders = await getCollection('reminders').find({ delivered: false, due_at: { $lte: now } }).limit(50).toArray();
    for (const reminder of reminders) {
      const claimed = await getCollection('reminders').findOneAndUpdate({ _id: reminder._id, delivered: false }, { $set: { delivered: true, delivered_at: new Date() } }, { returnDocument: 'after' });
      if (!claimed) continue;
      const guild = await client.guilds.fetch(reminder.guild_id).catch(() => null);
      const channel = guild ? await guild.channels.fetch(reminder.channel_id).catch(() => null) : null;
      if (channel?.isTextBased()) await channel.send(`<@${reminder.user_id}> ⏰ ${reminder.message}`).catch(() => {});
    }
  };
  run().catch(console.error);
  const timer = setInterval(() => run().catch(console.error), 15_000);
  timer.unref();
}
