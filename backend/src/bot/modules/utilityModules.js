'use strict';

const logger = require('../../utils/logger').child('UtilityModules');
const discordService = require('../../services/discordService');
const { logBotEvent } = require('../utils/modHelpers');

async function handleWelcomeMessage(member, config, botToken, internalGuildId, userId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { guild, user } = member;

  if (!sc.channel_id && !ac.send_dm) return;

  const message = (sc.message || 'Welcome {user} to **{server}**!')
    .replace(/{user}/g, `<@${user.id}>`)
    .replace(/{username}/g, user.username)
    .replace(/{server}/g, guild.name)
    .replace(/{memberCount}/g, guild.memberCount?.toString() ?? '?');

  const dmMessage = (ac.dm_message || 'Welcome to {server}!')
    .replace(/{user}/g, user.username)
    .replace(/{server}/g, guild.name);

  if (sc.channel_id) {
    try {
      let payload;
      if (ac.embed) {
        payload = {
          embeds: [{
            title: ac.embed_title || `Welcome to ${guild.name}!`,
            description: message,
            color: parseInt((ac.embed_color || '#5865F2').replace('#', ''), 16),
            thumbnail: ac.embed_thumbnail ? { url: guild.iconURL() ?? '' } : undefined,
            timestamp: new Date().toISOString(),
          }],
        };
      } else {
        payload = { content: message };
      }

      const sent = await discordService.sendMessage(botToken, sc.channel_id, payload);

      if (ac.delete_after_ms && ac.delete_after_ms > 0) {
        setTimeout(async () => {
          try {
            await discordService.deleteMessage(botToken, sc.channel_id, sent.id);
          } catch {
            // ignore
          }
        }, ac.delete_after_ms);
      }

      logBotEvent(userId, internalGuildId, 'info', 'welcome', `Welcomed ${user.tag}`, { userId: user.id });
    } catch (err) {
      logger.error(`Failed to send welcome message: ${err.message}`, { guildId: guild.id });
    }
  }

  if (ac.send_dm) {
    try {
      await member.send(dmMessage);
    } catch {
      // DM can be disabled
    }
  }
}

async function handleAutoRole(member, config, botToken, internalGuildId, userId) {
  const { simple_config: sc, advanced_config: ac } = config;
  const { guild, user } = member;
  const roles = sc.roles ?? [];
  if (!roles.length) return;
  if (ac.only_humans && user.bot) return;

  const assign = async () => {
    for (const roleId of roles) {
      try {
        await discordService.addRole(botToken, guild.id, user.id, roleId, 'Auto Role');
        logBotEvent(userId, internalGuildId, 'info', 'autoRole', `Assigned role ${roleId} to ${user.tag}`, { userId: user.id, roleId });
      } catch (err) {
        logger.error(`Failed to assign auto role ${roleId}: ${err.message}`, { guildId: guild.id });
      }
    }
  };

  if (ac.delay_ms && ac.delay_ms > 0) {
    setTimeout(assign, ac.delay_ms);
  } else {
    await assign();
  }
}

async function handleLogging(event, data, config, botToken) {
  const { simple_config: sc, advanced_config: ac } = config;
  if (!sc.channel_id) return;
  if (!sc.events?.includes(event)) return;

  try {
    const embed = buildLogEmbed(event, data, ac);
    if (!embed) return;
    await discordService.sendMessage(botToken, sc.channel_id, { embeds: [embed] });
  } catch (err) {
    logger.debug(`Logging module send failed: ${err.message}`);
  }
}

function buildLogEmbed(event, data, ac) {
  const color = parseInt((ac.embed_color || '#FFA500').replace('#', ''), 16);
  const ts = new Date().toISOString();

  switch (event) {
    case 'message_delete':
      if (ac.ignore_bots && data.author?.bot) return null;
      if (ac.ignore_channels?.includes(data.channel?.id)) return null;
      return {
        title: 'Message Deleted',
        description: `**Author:** <@${data.author?.id}>\n**Channel:** <#${data.channel?.id}>\n**Content:** ${data.content?.slice(0, 1000) ?? '(unknown)'}`,
        color,
        timestamp: ts,
      };

    case 'message_edit':
      if (ac.ignore_bots && data.author?.bot) return null;
      if (!ac.log_edits) return null;
      return {
        title: 'Message Edited',
        description: `**Author:** <@${data.author?.id}>\n**Channel:** <#${data.channel?.id}>\n**Before:** ${data.oldContent?.slice(0, 500) ?? '(unknown)'}\n**After:** ${data.newContent?.slice(0, 500)}`,
        color,
        timestamp: ts,
      };

    case 'member_join':
      return {
        title: 'Member Joined',
        description: `**User:** <@${data.user?.id}> (${data.user?.tag})\n**Account Created:** <t:${Math.floor(data.user?.createdTimestamp / 1000)}:R>`,
        color: 0x00ff00,
        timestamp: ts,
      };

    case 'member_leave':
      return {
        title: 'Member Left',
        description: `**User:** ${data.user?.tag} (${data.user?.id})`,
        color: 0xff0000,
        timestamp: ts,
      };

    case 'ban':
      return {
        title: 'Member Banned',
        description: `**User:** ${data.user?.tag}\n**Reason:** ${data.reason ?? 'No reason'}`,
        color: 0xff0000,
        timestamp: ts,
      };

    case 'kick':
      return {
        title: 'Member Kicked',
        description: `**User:** ${data.user?.tag}\n**Reason:** ${data.reason ?? 'No reason'}`,
        color: 0xff6600,
        timestamp: ts,
      };

    case 'role_update':
      if (!ac.log_roles) return null;
      return {
        title: 'Role Updated',
        description: `**Member:** <@${data.member?.id}>\n**Added:** ${data.added?.join(', ') || 'None'}\n**Removed:** ${data.removed?.join(', ') || 'None'}`,
        color,
        timestamp: ts,
      };

    case 'nickname_change':
      if (!ac.log_nicknames) return null;
      return {
        title: 'Nickname Changed',
        description: `**Member:** <@${data.member?.id}>\n**Before:** ${data.oldNick ?? 'None'}\n**After:** ${data.newNick ?? 'None'}`,
        color,
        timestamp: ts,
      };

    default:
      return null;
  }
}

const commandCooldowns = new Map();
const dynamicBlockHistory = new Map();

function pickDynamicOption(options, historyKey) {
  if (!Array.isArray(options) || !options.length) return '';
  if (options.length === 1) return options[0];

  const previousIndex = dynamicBlockHistory.get(historyKey);
  let nextIndex = Math.floor(Math.random() * options.length);

  if (typeof previousIndex === 'number') {
    let guard = 0;
    while (nextIndex === previousIndex && guard < 12) {
      nextIndex = Math.floor(Math.random() * options.length);
      guard += 1;
    }
  }

  dynamicBlockHistory.set(historyKey, nextIndex);
  return options[nextIndex];
}

function resolveComboBlocks(template, commandKey = '') {
  return String(template || '').replace(/\[\[combo:(.*?)\]\]/gis, (_, rawGroups) => {
    const groups = String(rawGroups || '')
      .split('::')
      .map((group) => group.trim())
      .filter(Boolean);

    if (!groups.length) return '';

    const parts = groups.map((group, index) => {
      const options = group
        .split('||')
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (!options.length) return '';
      return pickDynamicOption(options, `${commandKey}:combo:${index}:${group}`);
    }).filter(Boolean);

    return parts
      .join(' ')
      .replace(/\s+([!?;:,])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
  });
}

function resolveRandomBlocks(template, commandKey = '') {
  const withCombo = resolveComboBlocks(template, commandKey);

  return String(withCombo || '').replace(/\[\[random:(.*?)\]\]/gis, (_, rawOptions) => {
    const options = String(rawOptions || '')
      .split('||')
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (!options.length) return '';
    return pickDynamicOption(options, `${commandKey}:random:${rawOptions}`);
  });
}

function replaceCommandVariables(template, context, commandKey = '') {
  return resolveRandomBlocks(template, commandKey)
    .replace(/{user}/gi, `<@${context.author.id}>`)
    .replace(/{mention}/gi, `<@${context.author.id}>`)
    .replace(/{username}/gi, context.author.username)
    .replace(/{server}/gi, context.guild.name)
    .replace(/{channel}/gi, `<#${context.channel.id}>`)
    .replace(/{membercount}/gi, String(context.guild.memberCount ?? '?'))
    .replace(/{args}/gi, context.argsText || '')
    .replace(/{arg(\d+)}/gi, (_, rawIndex) => context.args[Number(rawIndex) - 1] || '');
}

function parseEmbedColor(rawColor) {
  const value = String(rawColor || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return 0x22d3ee;
  return parseInt(value, 16);
}

function buildCommandContext(source, command, matchedTrigger) {
  const isInteraction = typeof source.isChatInputCommand === 'function';
  const guild = source.guild;
  const author = isInteraction ? source.user : source.author;
  const channel = source.channel;
  const argsText = isInteraction
    ? ''
    : source.content.trim().slice(String(matchedTrigger || command.trigger || '').length).trim();
  const args = argsText ? argsText.split(/\s+/).filter(Boolean) : [];

  return { isInteraction, guild, author, channel, argsText, args };
}

function buildCommandPayload(command, context) {
  const {
    trigger,
    response,
    response_mode,
    reply_in_dm,
    embed_enabled,
    embed_title,
    embed_color,
    mention_user,
  } = command;
  const { guild, author, channel, argsText, args } = context;
  const dynamicKey = String(command?.id || command?.trigger || 'command');
  const text = replaceCommandVariables(response, { guild, author, channel, argsText, args }, dynamicKey);
  const mode = response_mode || (reply_in_dm ? 'dm' : 'channel');
  const content = mention_user && mode !== 'dm'
    ? `<@${author.id}> ${text}`.trim()
    : text;
  const mentionOnlyContent = mention_user && mode === 'channel' ? `<@${author.id}>` : undefined;

  return {
    mode,
    payload: embed_enabled
      ? {
          content: mode === 'channel' ? mentionOnlyContent : undefined,
          embeds: [{
            title: replaceCommandVariables(embed_title || trigger, { guild, author, channel, argsText, args }, `${dynamicKey}:embed`),
            description: text,
            color: parseEmbedColor(embed_color),
          }],
        }
      : { content },
    args,
  };
}

async function handleCustomCommand(source, command, matchedTrigger = null) {
  const context = buildCommandContext(source, command, matchedTrigger);
  const { isInteraction, guild, author, channel, args } = context;
  const {
    id,
    trigger,
    delete_trigger,
    allowed_roles,
    allowed_channels,
    cooldown_ms,
    delete_response_after_ms,
    require_args,
    usage_hint,
    mention_user,
  } = command;

  const cooldownKey = `${guild.id}:${id || trigger}:${author.id}`;
  const lastUsed = commandCooldowns.get(cooldownKey) ?? 0;
  if (Date.now() - lastUsed < (cooldown_ms || 0)) return false;

  if (allowed_roles?.length) {
    const memberRoles = source.member?.roles?.cache?.map((role) => role.id) ?? [];
    if (!allowed_roles.some((roleId) => memberRoles.includes(roleId))) return false;
  }

  if (allowed_channels?.length && channel?.id && !allowed_channels.includes(channel.id)) return false;

  if (require_args && !args.length) {
    const usageMessage = usage_hint || `Utilisation: ${trigger} <argument>`;
    try {
      if (isInteraction) {
        if (source.deferred || source.replied) {
          await source.followUp({ content: usageMessage, ephemeral: true });
        } else {
          await source.reply({ content: usageMessage, ephemeral: true });
        }
      } else {
        await source.reply({ content: usageMessage, allowedMentions: { repliedUser: false } });
      }
    } catch {
      // ignore
    }
    return false;
  }

  const { mode, payload } = buildCommandPayload(command, context);

  try {
    let sentMessage = null;

    if (isInteraction) {
      if (mode === 'dm') {
        await author.send(payload);
        if (source.deferred || source.replied) {
          await source.followUp({ content: 'Commande envoyee en DM.', ephemeral: true });
        } else {
          await source.reply({ content: 'Commande envoyee en DM.', ephemeral: true });
        }
      } else if (source.deferred || source.replied) {
        await source.followUp(payload);
      } else {
        await source.reply(payload);
      }
    } else if (mode === 'dm') {
      sentMessage = await author.send(payload);
    } else if (mode === 'reply') {
      sentMessage = await source.reply({
        ...payload,
        allowedMentions: { repliedUser: !!mention_user },
      });
    } else {
      sentMessage = await channel.send(payload);
    }

    if (!isInteraction && delete_trigger) {
      await source.delete().catch(() => {});
    }

    if (delete_response_after_ms > 0 && sentMessage?.deletable) {
      setTimeout(() => sentMessage.delete().catch(() => {}), delete_response_after_ms);
    }

    commandCooldowns.set(cooldownKey, Date.now());
    return true;
  } catch (err) {
    logger.debug(`Custom command send failed: ${err.message}`);
    return false;
  }
}

module.exports = {
  handleWelcomeMessage,
  handleAutoRole,
  handleLogging,
  handleCustomCommand,
};
