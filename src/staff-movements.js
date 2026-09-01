import {
  ApplicationCommandOptionType,
  AuditLogEvent,
  MessageFlags,
  PermissionFlagsBits
} from 'discord.js';
import { getCollection, getSetting } from './database.js';

const pendingUpdates = new Map();
const suppressedUpdates = new Map();
const DEBOUNCE_MS = 1_500;

export const staffRolesCommand = {
  name: 'staff-roles',
  description: 'Configure roles that trigger automatic staff movement messages',
  dm_permission: false,
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'add',
      description: 'Watch a staff role for promotions and demotions',
      options: [{ type: ApplicationCommandOptionType.Role, name: 'role', description: 'Staff role to watch', required: true }]
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'remove',
      description: 'Stop watching a staff role',
      options: [{ type: ApplicationCommandOptionType.Role, name: 'role', description: 'Staff role to stop watching', required: true }]
    },
    { type: ApplicationCommandOptionType.Subcommand, name: 'list', description: 'Show watched staff roles in rank order' }
  ]
};

function updateKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

export function suppressAutomaticStaffMovement(guildId, userId, durationMs = 5_000) {
  const key = updateKey(guildId, userId);
  suppressedUpdates.set(key, Date.now() + durationMs);
  setTimeout(() => {
    if ((suppressedUpdates.get(key) || 0) <= Date.now()) suppressedUpdates.delete(key);
  }, durationMs + 100).unref();
}

function highestWatchedRole(guild, memberRoleIds, watchedRoleIds) {
  return [...memberRoleIds]
    .filter(id => watchedRoleIds.has(id))
    .map(id => guild.roles.cache.get(id))
    .filter(Boolean)
    .sort((a, b) => b.position - a.position)[0] || null;
}

async function findRoleChangeActor(guild, userId) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return { actor: 'a server administrator', reason: 'Staff role changed' };
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 6 }).catch(() => null);
  const entry = logs?.entries.find(item => item.target?.id === userId && Date.now() - item.createdTimestamp < 15_000);
  return {
    actor: entry?.executor || 'a server administrator',
    reason: entry?.reason || 'Staff role changed'
  };
}

function movementDetails(previousRole, currentRole) {
  if (!previousRole && currentRole) return { action: 'hired', title: 'Hired', position: currentRole.name };
  if (previousRole && !currentRole) return { action: 'removed from staff', title: 'Removed from staff', position: 'No staff role' };
  if (currentRole.position > previousRole.position) return { action: 'promoted', title: 'Promoted', position: currentRole.name };
  if (currentRole.position < previousRole.position) return { action: 'demoted', title: 'Demoted', position: currentRole.name };
  return { action: 'transferred', title: 'Transferred', position: currentRole.name };
}

function applyTemplate(template, values) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template
  );
}

async function publishAutomaticMovement(update, helpers) {
  const { guild, member, beforeRoleIds, afterRoleIds } = update;
  const key = updateKey(guild.id, member.id);
  if ((suppressedUpdates.get(key) || 0) > Date.now()) return;
  suppressedUpdates.delete(key);

  const watched = await getCollection('staff_roles').find({ guild_id: guild.id }).toArray();
  if (!watched.length) return;
  const watchedIds = new Set(watched.map(document => document.role_id));
  const previousRole = highestWatchedRole(guild, beforeRoleIds, watchedIds);
  const currentRole = highestWatchedRole(guild, afterRoleIds, watchedIds);
  if (previousRole?.id === currentRole?.id) return;

  const destination = await helpers.getTextChannel(guild, 'movement_channel');
  if (!destination) return;
  const { actor, reason } = await findRoleChangeActor(guild, member.id);
  const movement = movementDetails(previousRole, currentRole);
  const description = applyTemplate(getSetting(guild.id, 'movement_template'), {
    user: member,
    actor,
    action: movement.action,
    position: movement.position,
    reason,
    server: guild.name
  });
  const fields = [];
  if (previousRole) fields.push({ name: 'Previous role', value: `${previousRole}`, inline: true });
  if (currentRole) fields.push({ name: 'New role', value: `${currentRole}`, inline: true });
  const embed = helpers.brandEmbed(guild.id)
    .setTitle(`Staff update • ${movement.title}`)
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL())
    .addFields(fields);
  await destination.send({ embeds: [embed] });
  await getCollection('staff_movements').insertOne({
    guild_id: guild.id,
    user_id: member.id,
    actor_id: typeof actor === 'string' ? null : actor.id,
    action: movement.action,
    position: movement.position,
    reason,
    previous_role_id: previousRole?.id || null,
    current_role_id: currentRole?.id || null,
    automatic: true,
    created_at: new Date()
  });
  await helpers.logEvent(guild, 'Automatic staff movement', `${member} was **${movement.action}**${currentRole ? ` to ${currentRole}` : ''}.`);
}

export function handleAutomaticStaffMovement(oldMember, newMember, helpers) {
  const before = new Set(oldMember.roles.cache.keys());
  const after = new Set(newMember.roles.cache.keys());
  if (before.size === after.size && [...before].every(id => after.has(id))) return;
  const key = updateKey(newMember.guild.id, newMember.id);
  const existing = pendingUpdates.get(key);
  if (existing) clearTimeout(existing.timer);
  const update = existing || {
    guild: newMember.guild,
    member: newMember,
    beforeRoleIds: before,
    afterRoleIds: after
  };
  update.member = newMember;
  update.afterRoleIds = after;
  update.timer = setTimeout(() => {
    pendingUpdates.delete(key);
    publishAutomaticMovement(update, helpers).catch(console.error);
  }, DEBOUNCE_MS);
  update.timer.unref();
  pendingUpdates.set(key, update);
}

export async function handleStaffRolesCommand(interaction, helpers) {
  if (interaction.commandName !== 'staff-roles') return false;
  if (!helpers.isManager(interaction)) {
    await helpers.replyError(interaction, 'You need Manage Server or the configured manager role.');
    return true;
  }
  const subcommand = interaction.options.getSubcommand();
  const collection = getCollection('staff_roles');

  if (subcommand === 'list') {
    const documents = await collection.find({ guild_id: interaction.guildId }).toArray();
    const roles = documents
      .map(document => interaction.guild.roles.cache.get(document.role_id))
      .filter(Boolean)
      .sort((a, b) => b.position - a.position);
    const description = roles.length
      ? roles.map((role, index) => `**${index + 1}.** ${role}`).join('\n')
      : 'No staff roles are being watched.';
    await interaction.reply({ embeds: [helpers.brandEmbed(interaction.guildId).setTitle('Watched staff roles').setDescription(description)], flags: MessageFlags.Ephemeral });
    return true;
  }

  const role = interaction.options.getRole('role', true);
  if (role.id === interaction.guildId) {
    await helpers.replyError(interaction, 'The @everyone role cannot be watched.');
    return true;
  }
  if (subcommand === 'add') {
    await collection.updateOne(
      { guild_id: interaction.guildId, role_id: role.id },
      { $setOnInsert: { guild_id: interaction.guildId, role_id: role.id, created_by: interaction.user.id, created_at: new Date() } },
      { upsert: true }
    );
    await interaction.reply({ content: `✅ ${role} is now watched for automatic staff movements.`, flags: MessageFlags.Ephemeral });
    return true;
  }
  const result = await collection.deleteOne({ guild_id: interaction.guildId, role_id: role.id });
  await interaction.reply({ content: result.deletedCount ? `✅ ${role} is no longer watched.` : `ℹ️ ${role} was not being watched.`, flags: MessageFlags.Ephemeral });
  return true;
}
