import {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleTriggerType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { getCollection, getSetting, setSetting } from './database.js';

const ruleNames = {
  keywords: 'Red Mushroom • Blocked Keywords',
  spam: 'Red Mushroom • Spam',
  mentions: 'Red Mushroom • Mention Spam'
};

function emojiKey(input) {
  return String(input).match(/^<a?:\w+:(\d+)>$/)?.[1] || String(input);
}

function render(template, values) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

async function requireManager(interaction, helpers, permission = PermissionFlagsBits.ManageGuild) {
  if (interaction.memberPermissions.has(permission) || helpers.isManager(interaction)) return true;
  await helpers.replyError(interaction, 'You do not have permission to use this command.');
  return false;
}

async function eventLog(guild, title, description) {
  if (getSetting(guild.id, 'event_logs_enabled') !== 'true') return;
  const channelId = getSetting(guild.id, 'log_channel');
  const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(title).setDescription(description.slice(0, 4096)).setTimestamp()] }).catch(() => {});
}

export async function handleCommunityCommand(interaction, helpers) {
  if (interaction.commandName === 'sticky') return handleSticky(interaction, helpers);
  if (interaction.commandName === 'reaction-role') return handleReactionRoleCommand(interaction, helpers);
  if (interaction.commandName === 'automod') return handleAutomod(interaction, helpers);
  if (interaction.commandName === 'community') return handleCommunity(interaction, helpers);
  return false;
}

async function sendSticky(channel, sticky) {
  if (sticky.last_message_id) {
    const previous = await channel.messages.fetch(sticky.last_message_id).catch(() => null);
    await previous?.delete().catch(() => {});
  }
  const message = await channel.send({ content: sticky.content, allowedMentions: { parse: [] } });
  await getCollection('stickies').updateOne(
    { guild_id: channel.guild.id, channel_id: channel.id },
    { $set: { last_message_id: message.id, last_sent_at: new Date(), message_count: 0 } }
  );
  return message;
}

async function handleSticky(interaction, helpers) {
  if (getSetting(interaction.guildId, 'sticky_enabled') !== 'true') return helpers.replyError(interaction, 'The sticky module is disabled.');
  if (!await requireManager(interaction, helpers, PermissionFlagsBits.ManageMessages)) return;
  const sub = interaction.options.getSubcommand();
  const stickies = getCollection('stickies');
  if (sub === 'list') {
    const rows = await stickies.find({ guild_id: interaction.guildId }).sort({ channel_id: 1 }).toArray();
    const text = rows.length ? rows.map(row => `• <#${row.channel_id}> — ${row.active ? 'active' : 'paused'} — ${row.content.slice(0, 80)}`).join('\n') : 'No sticky messages configured.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('Sticky messages').setDescription(text.slice(0, 4096))], flags: MessageFlags.Ephemeral });
  }
  const sticky = await stickies.findOne({ guild_id: interaction.guildId, channel_id: interaction.channelId });
  if (sub === 'remove') {
    if (sticky?.last_message_id) await interaction.channel.messages.delete(sticky.last_message_id).catch(() => {});
    await stickies.deleteOne({ guild_id: interaction.guildId, channel_id: interaction.channelId });
    return interaction.reply({ content: '✅ Sticky removed.', flags: MessageFlags.Ephemeral });
  }
  if (sub === 'stop') {
    if (!sticky) return helpers.replyError(interaction, 'This channel has no sticky message.');
    await stickies.updateOne({ _id: sticky._id }, { $set: { active: false } });
    return interaction.reply({ content: '✅ Sticky paused.', flags: MessageFlags.Ephemeral });
  }
  if (sub === 'start') {
    if (!sticky) return helpers.replyError(interaction, 'This channel has no saved sticky message.');
    await stickies.updateOne({ _id: sticky._id }, { $set: { active: true } });
    await sendSticky(interaction.channel, { ...sticky, active: true });
    return interaction.reply({ content: '✅ Sticky resumed.', flags: MessageFlags.Ephemeral });
  }
  const content = interaction.options.getString('message', true);
  await stickies.updateOne(
    { guild_id: interaction.guildId, channel_id: interaction.channelId },
    { $set: { content, active: true, updated_by: interaction.user.id, updated_at: new Date() }, $setOnInsert: { created_at: new Date(), last_message_id: null, message_count: 0 } },
    { upsert: true }
  );
  const saved = await stickies.findOne({ guild_id: interaction.guildId, channel_id: interaction.channelId });
  await sendSticky(interaction.channel, saved);
  return interaction.reply({ content: '✅ Sticky message saved.', flags: MessageFlags.Ephemeral });
}

async function handleReactionRoleCommand(interaction, helpers) {
  if (getSetting(interaction.guildId, 'reaction_roles_enabled') !== 'true') return helpers.replyError(interaction, 'The reaction-role module is disabled.');
  if (!await requireManager(interaction, helpers)) return;
  const sub = interaction.options.getSubcommand();
  const mappings = getCollection('reaction_roles');
  if (sub === 'list') {
    const rows = await mappings.find({ guild_id: interaction.guildId }).limit(50).toArray();
    const text = rows.length ? rows.map(row => `• [message](https://discord.com/channels/${interaction.guildId}/${row.channel_id}/${row.message_id}) ${row.emoji_display} → <@&${row.role_id}> (${row.mode})`).join('\n') : 'No reaction roles configured.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('Reaction roles').setDescription(text.slice(0, 4096))], flags: MessageFlags.Ephemeral });
  }
  const messageId = interaction.options.getString('message-id', true);
  const emoji = interaction.options.getString('emoji', true);
  const key = emojiKey(emoji);
  if (sub === 'remove') {
    const result = await mappings.deleteOne({ guild_id: interaction.guildId, message_id: messageId, emoji_key: key });
    return interaction.reply({ content: result.deletedCount ? '✅ Reaction-role mapping removed.' : '❌ Mapping not found.', flags: MessageFlags.Ephemeral });
  }
  const channel = interaction.options.getChannel('channel', true);
  const role = interaction.options.getRole('role', true);
  if (!role.editable || role.id === interaction.guildId) return helpers.replyError(interaction, 'I cannot manage that role. Move my bot role above it.');
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return helpers.replyError(interaction, 'Message not found in that channel.');
  await message.react(emoji).catch(() => null);
  const reaction = message.reactions.cache.find(item => (item.emoji.id || item.emoji.name) === key);
  if (!reaction) return helpers.replyError(interaction, 'I could not use that emoji. Use a Unicode emoji or an emoji from this server.');
  await mappings.updateOne(
    { guild_id: interaction.guildId, message_id: messageId, emoji_key: key },
    { $set: { channel_id: channel.id, role_id: role.id, emoji_display: emoji, mode: interaction.options.getString('mode') || 'normal', updated_by: interaction.user.id, updated_at: new Date() } },
    { upsert: true }
  );
  return interaction.reply({ content: `✅ ${emoji} now controls ${role}.`, flags: MessageFlags.Ephemeral });
}

async function managedRule(guild, name) {
  const rules = await guild.autoModerationRules.fetch();
  return rules.find(rule => rule.name === name) || null;
}

export async function setManagedAutomodState(guild, enabled) {
  const rules = await guild.autoModerationRules.fetch();
  const managed = rules.filter(rule => Object.values(ruleNames).includes(rule.name));
  await Promise.all(managed.map(rule => rule.edit({ enabled, reason: 'Red Mushroom module setting changed' })));
}

function blockAction(label) {
  return [{ type: AutoModerationActionType.BlockMessage, metadata: { customMessage: `Blocked by ${label}.` } }];
}

async function upsertRule(guild, name, data) {
  const rules = await guild.autoModerationRules.fetch();
  const current = rules.find(rule => rule.name === name) || null;
  if (current) {
    const { triggerType: _unchangedTriggerType, ...editableData } = data;
    return current.edit(editableData);
  }
  const hasSingleRuleLimit = [AutoModerationRuleTriggerType.Spam, AutoModerationRuleTriggerType.MentionSpam].includes(data.triggerType);
  const conflictingRule = hasSingleRuleLimit ? rules.find(rule => rule.triggerType === data.triggerType) : null;
  if (conflictingRule) {
    const error = new Error(`Discord already has the rule “${conflictingRule.name}” for this trigger type.`);
    error.code = 'AUTOMOD_TRIGGER_TYPE_EXISTS';
    throw error;
  }
  return guild.autoModerationRules.create({ name, eventType: AutoModerationRuleEventType.MessageSend, ...data });
}

async function handleAutomod(interaction, helpers) {
  if (getSetting(interaction.guildId, 'automod_enabled') !== 'true') return helpers.replyError(interaction, 'The AutoMod module is disabled.');
  if (!await requireManager(interaction, helpers)) return;
  const sub = interaction.options.getSubcommand();
  if (sub === 'status') {
    const rules = await interaction.guild.autoModerationRules.fetch();
    const managed = rules.filter(rule => Object.values(ruleNames).includes(rule.name));
    const text = managed.size ? managed.map(rule => `• **${rule.name}** — ${rule.enabled ? 'enabled' : 'disabled'} — ${AutoModerationRuleTriggerType[rule.triggerType]}`).join('\n') : 'No managed AutoMod rules yet.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('Native AutoMod status').setDescription(text)], flags: MessageFlags.Ephemeral });
  }
  if (sub === 'violations') {
    const user = interaction.options.getUser('user');
    const query = { guild_id: interaction.guildId, ...(user ? { user_id: user.id } : {}) };
    const rows = await getCollection('automod_violations').find(query).sort({ created_at: -1 }).limit(20).toArray();
    const text = rows.length ? rows.map(row => `• <@${row.user_id}> — **${row.rule_name}** in <#${row.channel_id}> <t:${Math.floor(row.created_at.getTime() / 1000)}:R>`).join('\n') : 'No recorded violations.';
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('AutoMod violations').setDescription(text.slice(0, 4096))], flags: MessageFlags.Ephemeral });
  }
  if (sub === 'keyword-add' || sub === 'keyword-remove') {
    const keyword = interaction.options.getString('keyword', true).trim();
    const current = await managedRule(interaction.guild, ruleNames.keywords);
    const keywords = current?.triggerMetadata.keywordFilter || [];
    const updated = sub === 'keyword-add' ? [...new Set([...keywords, keyword])] : keywords.filter(item => item !== keyword);
    if (updated.length > 1000) return helpers.replyError(interaction, 'Discord allows at most 1,000 keyword entries.');
    await upsertRule(interaction.guild, ruleNames.keywords, { triggerType: AutoModerationRuleTriggerType.Keyword, triggerMetadata: { keywordFilter: updated }, actions: blockAction('the keyword filter'), enabled: true, reason: `Changed by ${interaction.user.tag}` });
    return interaction.reply({ content: `✅ Keyword filter updated (${updated.length} entries).`, flags: MessageFlags.Ephemeral });
  }
  const enabled = interaction.options.getBoolean('enabled', true);
  try {
    if (sub === 'spam') {
      await upsertRule(interaction.guild, ruleNames.spam, { triggerType: AutoModerationRuleTriggerType.Spam, actions: blockAction('spam detection'), enabled, reason: `Changed by ${interaction.user.tag}` });
    } else {
      const limit = interaction.options.getInteger('limit') || 5;
      await upsertRule(interaction.guild, ruleNames.mentions, { triggerType: AutoModerationRuleTriggerType.MentionSpam, triggerMetadata: { mentionTotalLimit: limit, mentionRaidProtectionEnabled: true }, actions: blockAction('mention-spam detection'), enabled, reason: `Changed by ${interaction.user.tag}` });
    }
  } catch (error) {
    if (error.code === 'AUTOMOD_TRIGGER_TYPE_EXISTS') {
      return helpers.replyError(interaction, `${error.message} Discord permits only one rule of this type. Delete or disable the existing rule in **Server Settings → AutoMod**, or use \`/automod keyword-add\` to activate this bot's AutoMod integration.`);
    }
    throw error;
  }
  return interaction.reply({ content: `✅ ${sub} AutoMod rule ${enabled ? 'enabled' : 'disabled'}.`, flags: MessageFlags.Ephemeral });
}

async function handleCommunity(interaction, helpers) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'logs') {
    if (!await requireManager(interaction, helpers, PermissionFlagsBits.ModerateMembers)) return;
    const user = interaction.options.getUser('user');
    const query = { guild_id: interaction.guildId, ...(user ? { user_id: user.id } : {}) };
    const [cases, violations] = await Promise.all([
      getCollection('moderation_cases').find(query).sort({ created_at: -1 }).limit(10).toArray(),
      getCollection('automod_violations').find(query).sort({ created_at: -1 }).limit(10).toArray()
    ]);
    const lines = [
      ...cases.map(row => `• **${row.type}** <@${row.user_id}> — ${row.reason}`),
      ...violations.map(row => `• **AutoMod** <@${row.user_id}> — ${row.rule_name}`)
    ].slice(0, 20);
    return interaction.reply({ embeds: [(await helpers.brandEmbed(interaction.guildId)).setTitle('Community logs').setDescription(lines.join('\n').slice(0, 4096) || 'No records found.')], flags: MessageFlags.Ephemeral });
  }
  if (!await requireManager(interaction, helpers)) return;
  if (sub === 'starboard') {
    const channel = interaction.options.getChannel('channel', true);
    const threshold = interaction.options.getInteger('threshold', true);
    const emoji = interaction.options.getString('emoji') || '⭐';
    await Promise.all([
      setSetting(interaction.guildId, 'starboard_channel', channel.id),
      setSetting(interaction.guildId, 'starboard_threshold', threshold),
      setSetting(interaction.guildId, 'starboard_emoji', emoji),
      setSetting(interaction.guildId, 'starboard_enabled', 'true')
    ]);
    return interaction.reply({ content: `✅ Starboard configured in ${channel}: ${emoji} × ${threshold}.`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'welcome-test') {
    const channelId = getSetting(interaction.guildId, 'welcome_channel');
    const channel = channelId ? await interaction.guild.channels.fetch(channelId).catch(() => null) : interaction.channel;
    if (!channel?.isTextBased()) return helpers.replyError(interaction, 'Configure a welcome text channel first.');
    const content = render(getSetting(interaction.guildId, 'welcome_message'), { user: interaction.user, username: interaction.user.username, server: interaction.guild.name, member_count: interaction.guild.memberCount });
    await channel.send({ content, allowedMentions: { users: [interaction.user.id] } });
    return interaction.reply({ content: `✅ Welcome preview sent to ${channel}.`, flags: MessageFlags.Ephemeral });
  }
  if (sub === 'autorole-test') {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return helpers.replyError(interaction, 'That user is not currently in this server.');
    const result = await assignAutorole(member);
    if (result.status === 'not-configured') return helpers.replyError(interaction, 'Configure **Automatic member role** with `/config set-role` first.');
    if (result.status === 'missing-role') return helpers.replyError(interaction, 'The configured autorole no longer exists. Configure it again with `/config set-role`.');
    if (result.status === 'not-editable') return helpers.replyError(interaction, `I cannot assign ${result.role}. Give me **Manage Roles** and move my bot role above it.`);
    if (result.status === 'already-has') return interaction.reply({ content: `ℹ️ ${member} already has ${result.role}. Autorole configuration is working.`, flags: MessageFlags.Ephemeral });
    return interaction.reply({ content: `✅ Autorole test successful: assigned ${result.role} to ${member}.`, flags: MessageFlags.Ephemeral });
  }
  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description', true).replaceAll('\\n', '\n');
  const channel = interaction.options.getChannel('channel') || interaction.channel;
  const inputColor = interaction.options.getString('color');
  if (inputColor && !/^#[0-9a-f]{6}$/i.test(inputColor)) return helpers.replyError(interaction, 'Color must use `#RRGGBB` format.');
  const embed = (await helpers.brandEmbed(interaction.guildId)).setTitle(title).setDescription(description);
  if (inputColor) embed.setColor(Number.parseInt(inputColor.slice(1), 16));
  await channel.send({ embeds: [embed] });
  return interaction.reply({ content: `✅ Embed sent to ${channel}.`, flags: MessageFlags.Ephemeral });
}

export async function handleStickyActivity(message) {
  if (!message.guild || message.author.bot || getSetting(message.guild.id, 'sticky_enabled') !== 'true') return;
  const stickies = getCollection('stickies');
  const sticky = await stickies.findOne({ guild_id: message.guild.id, channel_id: message.channel.id, active: true });
  if (!sticky || message.id === sticky.last_message_id) return;
  const messageCount = (sticky.message_count || 0) + 1;
  const elapsed = Date.now() - (sticky.last_sent_at?.getTime() || 0);
  if (messageCount < 5 && elapsed < 15_000) {
    await stickies.updateOne({ _id: sticky._id }, { $set: { message_count: messageCount } });
    return;
  }
  await sendSticky(message.channel, sticky);
}

export async function handleReactionRole(reaction, user, added) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  if (reaction.message.partial) await reaction.message.fetch().catch(() => null);
  const guild = reaction.message.guild;
  if (!guild) return;
  const key = reaction.emoji.id || reaction.emoji.name;
  if (getSetting(guild.id, 'reaction_roles_enabled') === 'true') {
    const mapping = await getCollection('reaction_roles').findOne({ guild_id: guild.id, message_id: reaction.message.id, emoji_key: key });
    if (mapping) {
      const member = await guild.members.fetch(user.id).catch(() => null);
      const role = await guild.roles.fetch(mapping.role_id).catch(() => null);
      if (member && role?.editable) {
        if (added && mapping.mode !== 'drop') await member.roles.add(role, 'Reaction role selected').catch(() => {});
        if (added && mapping.mode === 'drop') await member.roles.remove(role, 'Drop reaction role selected').catch(() => {});
        if (!added && mapping.mode === 'normal') await member.roles.remove(role, 'Reaction role removed').catch(() => {});
      }
    }
  }
  await updateStarboard(reaction).catch(console.error);
}

async function updateStarboard(reaction) {
  const guild = reaction.message.guild;
  if (!guild || getSetting(guild.id, 'starboard_enabled') !== 'true') return;
  const configuredEmoji = emojiKey(getSetting(guild.id, 'starboard_emoji'));
  if ((reaction.emoji.id || reaction.emoji.name) !== configuredEmoji) return;
  const channelId = getSetting(guild.id, 'starboard_channel');
  if (!channelId || reaction.message.channelId === channelId) return;
  const threshold = Number(getSetting(guild.id, 'starboard_threshold')) || 3;
  const reactionCount = Math.max(0, reaction.count - (reaction.me ? 1 : 0));
  const entries = getCollection('starboard_entries');
  const existing = await entries.findOne({ guild_id: guild.id, source_message_id: reaction.message.id });
  const starboard = await guild.channels.fetch(channelId).catch(() => null);
  if (!starboard?.isTextBased()) return;
  if (reactionCount < threshold) {
    if (existing) {
      await starboard.messages.delete(existing.starboard_message_id).catch(() => {});
      await entries.deleteOne({ _id: existing._id });
    }
    return;
  }
  const source = await reaction.message.fetch();
  const attachment = source.attachments.find(item => item.contentType?.startsWith('image/'));
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setAuthor({ name: source.author.tag, iconURL: source.author.displayAvatarURL() })
    .setDescription(`${source.content || '*No text content*'}\n\n[Jump to message](${source.url})`.slice(0, 4096))
    .setFooter({ text: `${getSetting(guild.id, 'starboard_emoji')} ${reactionCount} • #${source.channel.name}` })
    .setTimestamp(source.createdAt);
  if (attachment) embed.setImage(attachment.url);
  if (existing) {
    const target = await starboard.messages.fetch(existing.starboard_message_id).catch(() => null);
    if (target) return target.edit({ embeds: [embed] });
  }
  const posted = await starboard.send({ embeds: [embed] });
  await entries.updateOne({ guild_id: guild.id, source_message_id: source.id }, { $set: { source_channel_id: source.channelId, starboard_channel_id: channelId, starboard_message_id: posted.id, updated_at: new Date() } }, { upsert: true });
}

export async function assignAutorole(member) {
  const roleId = getSetting(member.guild.id, 'autorole_role');
  if (!roleId) return { status: 'not-configured', role: null };
  const role = await member.guild.roles.fetch(roleId).catch(() => null);
  if (!role) return { status: 'missing-role', role: null };
  if (member.roles.cache.has(role.id)) return { status: 'already-has', role };
  if (!role.editable) return { status: 'not-editable', role };
  await member.roles.add(role, 'Configured autorole');
  return { status: 'assigned', role };
}

export async function handleMemberJoin(member) {
  const autorole = await assignAutorole(member).catch(error => {
    console.error(`Autorole failed for ${member.user.tag} in ${member.guild.name}:`, error);
    return null;
  });
  if (autorole && !['assigned', 'already-has', 'not-configured'].includes(autorole.status)) {
    console.warn(`Autorole not assigned in ${member.guild.name}: ${autorole.status}.`);
  }
  if (getSetting(member.guild.id, 'welcome_enabled') === 'true') {
    const channelId = getSetting(member.guild.id, 'welcome_channel');
    const channel = channelId ? await member.guild.channels.fetch(channelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      const content = render(getSetting(member.guild.id, 'welcome_message'), { user: member, username: member.user.username, server: member.guild.name, member_count: member.guild.memberCount });
      await channel.send({ content, allowedMentions: { users: [member.id] } }).catch(() => {});
    }
  }
  await eventLog(member.guild, 'Member joined', `${member.user} (\`${member.id}\`) joined. Account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`);
}

export async function handleMemberLeave(member) {
  if (getSetting(member.guild.id, 'welcome_enabled') === 'true') {
    const channelId = getSetting(member.guild.id, 'welcome_channel');
    const channel = channelId ? await member.guild.channels.fetch(channelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      const content = render(getSetting(member.guild.id, 'leave_message'), { user: member.user, username: member.user.username, server: member.guild.name, member_count: member.guild.memberCount });
      await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => {});
    }
  }
  await eventLog(member.guild, 'Member left', `**${member.user.tag}** (\`${member.id}\`) left the server.`);
}

export async function handleAutoModerationExecution(execution) {
  await getCollection('automod_violations').insertOne({ guild_id: execution.guild.id, user_id: execution.userId, channel_id: execution.channelId, rule_id: execution.ruleId, rule_name: execution.autoModerationRule?.name || 'AutoMod rule', action_type: execution.action.type, created_at: new Date() });
  await eventLog(execution.guild, 'AutoMod action', `<@${execution.userId}> triggered **${execution.autoModerationRule?.name || 'an AutoMod rule'}** in <#${execution.channelId}>.`);
}

export async function handleDiscordEvent(type, item, oldItem = null) {
  if ((type === 'messageDelete' || type === 'messageUpdate') && (item.author?.bot || oldItem?.author?.bot)) return;
  const guild = item.guild || oldItem?.guild;
  if (!guild) return;
  const descriptions = {
    messageDelete: () => `A message by ${item.author || 'an unknown user'} was deleted in ${item.channel}.`,
    messageUpdate: () => `A message by ${item.author || oldItem?.author || 'an unknown user'} was edited in ${item.channel}. [Jump](${item.url})`,
    channelCreate: () => `${item} was created.`,
    channelDelete: () => `**#${item.name}** was deleted.`,
    roleCreate: () => `${item} was created.`,
    roleDelete: () => `**@${item.name}** was deleted.`,
    banAdd: () => `**${item.user.tag}** (\`${item.user.id}\`) was banned.`
  };
  if (descriptions[type]) await eventLog(guild, type.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase()), descriptions[type]());
}
