'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const { v4: uuidv4 } = require('uuid');

const { requireAuth, requireBotToken, requireGuildOwner, validate } = require('../middleware');
const { customCommandSchema, commandAssistantSchema, commandToggleSchema } = require('../validators/schemas');
const db = require('../database');
const botManager = require('../services/botManager');
const aiService = require('../services/aiService');
const logger = require('../utils/logger').child('CommandsRoutes');

router.use(requireAuth, requireBotToken, requireGuildOwner);

const scheduledCommandSyncs = new Map();

function parseJsonArray(rawValue) {
  try {
    const parsed = JSON.parse(rawValue || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeResponseMode(value, replyInDm) {
  if (value === 'reply' || value === 'dm' || value === 'channel') return value;
  return replyInDm ? 'dm' : 'channel';
}

function normalizeColor(value = '#22d3ee') {
  const raw = String(value || '').trim();
  const hex = raw.startsWith('#') ? raw : `#${raw}`;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : '#22d3ee';
}

function normalizeTrigger(value) {
  return String(value || '').trim();
}

function normalizeCommandType(value) {
  return value === 'slash' ? 'slash' : 'prefix';
}

function normalizeCommandPrefix(value) {
  return String(value || '!').trim().slice(0, 5) || '!';
}

function isFullPrefixCommandInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  if (raw.includes(' ')) return true;
  if (/^[!?.+$#-]/.test(raw)) return raw.length > 1;
  return false;
}

function shouldUseSpaceAfterPrefix(prefix) {
  return /^[a-z0-9]+$/i.test(String(prefix || '').trim());
}

function sanitizeCommandName(value, commandType = 'prefix') {
  const raw = String(value || '').trim().replace(/\s+/g, '-');
  if (!raw) return '';

  if (commandType === 'slash') {
    const cleaned = raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '')
      .slice(0, 32);
    return cleaned || 'commande';
  }

  return raw
    .replace(/[^\w-]/g, '')
    .slice(0, 32);
}

function buildCommandTrigger(commandType, commandPrefix, commandName) {
  if (commandType === 'slash') {
    return `/${commandName}`;
  }

  return shouldUseSpaceAfterPrefix(commandPrefix)
    ? `${commandPrefix} ${commandName}`
    : `${commandPrefix}${commandName}`;
}

function resolveRequestedCommandMeta({ mode, prefix, trigger, command_name }) {
  const commandType = normalizeCommandType(mode);

  if (commandType === 'slash') {
    const requestedName = sanitizeCommandName(command_name || trigger || '', 'slash');
    return {
      command_type: 'slash',
      command_prefix: '/',
      command_name: requestedName,
      trigger: requestedName ? `/${requestedName}` : '',
    };
  }

  const requestedTrigger = String(trigger || '').trim();
  if (isFullPrefixCommandInput(requestedTrigger)) {
    const derived = deriveCommandMeta(requestedTrigger);
    return {
      command_type: 'prefix',
      command_prefix: normalizeCommandPrefix(derived.command_prefix || '!'),
      command_name: sanitizeCommandName(derived.command_name || '', 'prefix'),
      trigger: derived.trigger || requestedTrigger,
    };
  }

  return {
    command_type: 'prefix',
    command_prefix: normalizeCommandPrefix(prefix || '!'),
    command_name: '',
    trigger: '',
  };
}

function deriveCommandMeta(trigger) {
  const raw = normalizeTrigger(trigger);
  if (!raw) {
    return {
      command_type: 'prefix',
      command_prefix: '!',
      command_name: '',
    };
  }

  if (raw.startsWith('/')) {
    return {
      command_type: 'slash',
      command_prefix: '/',
      command_name: sanitizeCommandName(raw.slice(1), 'slash'),
    };
  }

  if (raw.includes(' ')) {
    const [prefix, ...rest] = raw.split(/\s+/);
    return {
      command_type: 'prefix',
      command_prefix: normalizeCommandPrefix(prefix),
      command_name: sanitizeCommandName(rest.join('-'), 'prefix'),
    };
  }

  return {
    command_type: 'prefix',
    command_prefix: raw.slice(0, 1) || '!',
    command_name: sanitizeCommandName(raw.slice(1), 'prefix'),
  };
}

function resolveBooleanFlag(nextValue, currentValue = false) {
  return (nextValue ?? currentValue ?? false) ? 1 : 0;
}

function normalizeAliases(aliases = [], trigger = '', currentTrigger = '') {
  const forbidden = new Set([normalizeTrigger(trigger).toLowerCase(), normalizeTrigger(currentTrigger).toLowerCase()].filter(Boolean));
  const seen = new Set();
  const normalized = [];

  for (const alias of aliases) {
    const next = normalizeTrigger(alias);
    const key = next.toLowerCase();
    if (!next || forbidden.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push(next);
  }

  return normalized;
}

function normalizeIdArray(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter((value) => /^\d+$/.test(value) && !seen.has(value) && seen.add(value));
}

function mapCommandRow(row) {
  const responseMode = normalizeResponseMode(row.response_mode, !!row.reply_in_dm);
  const derived = deriveCommandMeta(row.trigger);
  const commandType = normalizeCommandType(row.command_type || derived.command_type);
  const commandPrefix = commandType === 'slash'
    ? '/'
    : normalizeCommandPrefix(row.command_prefix || derived.command_prefix || '!');
  const commandName = sanitizeCommandName(row.command_name || derived.command_name || '', commandType);

  return {
    ...row,
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    display_trigger: buildCommandTrigger(commandType, commandPrefix, commandName),
    description: row.description || '',
    aliases: parseJsonArray(row.aliases),
    allowed_roles: parseJsonArray(row.allowed_roles),
    allowed_channels: parseJsonArray(row.allowed_channels),
    response_mode: responseMode,
    reply_in_dm: responseMode === 'dm',
    delete_trigger: !!row.delete_trigger,
    cooldown_ms: Number(row.cooldown_ms || 0),
    delete_response_after_ms: Number(row.delete_response_after_ms || 0),
    embed_enabled: !!row.embed_enabled,
    embed_title: row.embed_title || '',
    embed_color: normalizeColor(row.embed_color),
    mention_user: !!row.mention_user,
    require_args: !!row.require_args,
    usage_hint: row.usage_hint || '',
    enabled: !!row.enabled,
    use_count: Number(row.use_count || 0),
  };
}

function normalizePayload(body, currentCommand = null) {
  const derived = deriveCommandMeta(body.trigger ?? currentCommand?.trigger ?? '');
  const commandType = normalizeCommandType(body.command_type ?? currentCommand?.command_type ?? derived.command_type);
  const commandPrefix = commandType === 'slash'
    ? '/'
    : normalizeCommandPrefix(body.command_prefix ?? currentCommand?.command_prefix ?? derived.command_prefix ?? '!');
  const commandName = sanitizeCommandName(
    body.command_name ?? currentCommand?.command_name ?? derived.command_name,
    commandType
  );
  const trigger = normalizeTrigger(body.trigger ?? buildCommandTrigger(commandType, commandPrefix, commandName));
  const responseMode = normalizeResponseMode(body.response_mode ?? currentCommand?.response_mode, body.reply_in_dm ?? currentCommand?.reply_in_dm);

  return {
    trigger: trigger || buildCommandTrigger(commandType, commandPrefix, commandName),
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    enabled: typeof body.enabled === 'boolean'
      ? body.enabled
      : !!(currentCommand?.enabled ?? true),
    description: String(body.description ?? currentCommand?.description ?? '').trim(),
    aliases: normalizeAliases(body.aliases ?? currentCommand?.aliases ?? [], trigger, currentCommand?.trigger),
    response: String(body.response ?? currentCommand?.response ?? '').trim(),
    response_mode: responseMode,
    reply_in_dm: responseMode === 'dm' ? 1 : 0,
    delete_trigger: resolveBooleanFlag(body.delete_trigger, currentCommand?.delete_trigger),
    allowed_roles: normalizeIdArray(body.allowed_roles ?? currentCommand?.allowed_roles ?? []),
    allowed_channels: normalizeIdArray(body.allowed_channels ?? currentCommand?.allowed_channels ?? []),
    cooldown_ms: Number(body.cooldown_ms ?? currentCommand?.cooldown_ms ?? 0),
    delete_response_after_ms: Number(body.delete_response_after_ms ?? currentCommand?.delete_response_after_ms ?? 0),
    embed_enabled: resolveBooleanFlag(body.embed_enabled, currentCommand?.embed_enabled),
    embed_title: String(body.embed_title ?? currentCommand?.embed_title ?? '').trim(),
    embed_color: normalizeColor(body.embed_color ?? currentCommand?.embed_color ?? '#22d3ee'),
    mention_user: resolveBooleanFlag(body.mention_user, currentCommand?.mention_user),
    require_args: resolveBooleanFlag(body.require_args, currentCommand?.require_args),
    usage_hint: String(body.usage_hint ?? currentCommand?.usage_hint ?? '').trim(),
  };
}

function findCommandCollision(guildId, trigger, aliases, ignoreId = null) {
  const taken = new Map();
  const commands = db.raw('SELECT id, trigger, aliases FROM custom_commands WHERE guild_id = ?', [guildId]);

  for (const row of commands) {
    if (ignoreId && row.id === ignoreId) continue;
    const keys = [row.trigger, ...parseJsonArray(row.aliases)];
    for (const key of keys) {
      const normalized = normalizeTrigger(key).toLowerCase();
      if (normalized) taken.set(normalized, row.id);
    }
  }

  for (const key of [trigger, ...aliases]) {
    const normalized = normalizeTrigger(key).toLowerCase();
    if (normalized && taken.has(normalized)) return key;
  }

  return null;
}

function enableCommandsModule(internalGuildId) {
  db.db.prepare(
    `UPDATE modules
     SET enabled = 1, updated_at = ?
     WHERE guild_id = ? AND module_type = 'CUSTOM_COMMANDS'`
  ).run(new Date().toISOString(), internalGuildId);
}

async function syncCommandState(userId, discordGuildId) {
  botManager.invalidateModuleCache(userId, discordGuildId);
  await botManager.syncCommandDefinitions(userId, discordGuildId).catch(() => {});
}

function scheduleCommandSync(userId, discordGuildId) {
  const key = `${userId}:${discordGuildId}`;
  const existing = scheduledCommandSyncs.get(key) || {
    timer: null,
    running: false,
    queued: false,
  };

  if (existing.running) {
    existing.queued = true;
    scheduledCommandSyncs.set(key, existing);
    return;
  }

  if (existing.timer) {
    clearTimeout(existing.timer);
  }

  existing.timer = setTimeout(async () => {
    const state = scheduledCommandSyncs.get(key) || existing;
    state.timer = null;
    if (state.running) {
      state.queued = true;
      scheduledCommandSyncs.set(key, state);
      return;
    }

    state.running = true;
    scheduledCommandSyncs.set(key, state);

    try {
      await syncCommandState(userId, discordGuildId);
    } catch (error) {
      logger.warn('Command sync failed after update', {
        userId,
        discordGuildId,
        error: error?.message || 'Unknown error',
      });
    } finally {
      const latest = scheduledCommandSyncs.get(key) || state;
      latest.running = false;

      if (latest.queued) {
        latest.queued = false;
        scheduledCommandSyncs.set(key, latest);
        scheduleCommandSync(userId, discordGuildId);
      } else if (!latest.timer) {
        scheduledCommandSyncs.delete(key);
      } else {
        scheduledCommandSyncs.set(key, latest);
      }
    }
  }, 350);

  scheduledCommandSyncs.set(key, existing);
}

function extractCommandDraft(text) {
  const match = String(text || '').match(/```command\s*([\s\S]*?)```/i);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function buildAssistantSystemPrompt({ guildName, mode, prefix, requestedTrigger, requestedCommandName, existingCommand }) {
  const existingBlock = existingCommand
    ? `
Current command being edited:
- Trigger: ${existingCommand.display_trigger}
- Description: ${existingCommand.description || '(none)'}
- Response: ${existingCommand.response}
- Mode: ${existingCommand.response_mode}
- Embed: ${existingCommand.embed_enabled ? 'yes' : 'no'}`
    : '';
  const requestedBlock = mode === 'slash'
    ? (requestedCommandName ? `\nExact slash command requested: /${requestedCommandName}` : '')
    : (requestedTrigger
      ? `\nExact text trigger requested: ${requestedTrigger}`
      : (prefix ? `\nPrefix requested: ${prefix}` : ''));

  return `You are DiscordForger Command Builder.
You create simple custom Discord commands that work immediately in this product.

Server: ${guildName}
Command mode requested: ${mode}
${mode === 'slash' ? 'Prefix requested: / (real Discord slash command)' : ''}
${requestedBlock}
${existingBlock}

SUPPORTED OUTPUT ONLY:
- command_name
- description
- response
- response_mode ("channel" | "reply" | "dm")
- embed_enabled (true | false)
- embed_title
- mention_user (true | false)

STRICT RULES:
1. Return a short friendly explanation in the user's language.
2. Then return exactly one \`\`\`command block with valid JSON.
3. command_name must be short and usable immediately.
4. For slash mode, command_name must be lowercase and Discord-safe.
5. Do not output code, JavaScript, aliases, buttons, webhooks, APIs, role restrictions, or unsupported logic.
6. This system only supports text or embed responses with placeholders.
7. Supported placeholders are: {mention} {username} {server} {channel} {memberCount} {args} {arg1} {arg2}.
8. If the user asks for impossible advanced behavior, convert it into the closest working command in this system.
9. Keep the command clear and production-ready.
10. If an exact trigger or command name is requested above, you must respect it.

JSON shape:
\`\`\`command
{
  "command_name": "bonjour",
  "description": "Salue un membre",
  "response": "Bonjour {mention} !",
  "response_mode": "reply",
  "embed_enabled": false,
  "embed_title": "",
  "mention_user": false
}
\`\`\``;
}

function normalizeAssistantDraft(draft, mode, prefix, currentCommand = null, requested = {}) {
  const commandType = normalizeCommandType(mode);
  const requestedMeta = resolveRequestedCommandMeta({
    mode,
    prefix,
    trigger: requested.trigger,
    command_name: requested.command_name,
  });
  const commandPrefix = commandType === 'slash'
    ? '/'
    : (requestedMeta.command_prefix || normalizeCommandPrefix(prefix || currentCommand?.command_prefix || '!'));
  const commandName = requestedMeta.command_name || sanitizeCommandName(
    draft?.command_name || currentCommand?.command_name || 'commande',
    commandType
  );
  const trigger = requestedMeta.trigger || buildCommandTrigger(commandType, commandPrefix, commandName);

  return normalizePayload({
    command_type: commandType,
    command_prefix: commandPrefix,
    command_name: commandName,
    trigger,
    description: String(draft?.description || currentCommand?.description || '').trim().slice(0, 100),
    response: String(draft?.response || currentCommand?.response || '').trim().slice(0, 2000),
    response_mode: ['channel', 'reply', 'dm'].includes(draft?.response_mode) ? draft.response_mode : (currentCommand?.response_mode || 'reply'),
    embed_enabled: draft?.embed_enabled ?? currentCommand?.embed_enabled ?? false,
    embed_title: String(draft?.embed_title || currentCommand?.embed_title || '').trim().slice(0, 256),
    mention_user: draft?.mention_user ?? currentCommand?.mention_user ?? false,
    delete_trigger: currentCommand?.delete_trigger || false,
    allowed_roles: [],
    allowed_channels: [],
    aliases: [],
    cooldown_ms: 0,
    delete_response_after_ms: 0,
    require_args: false,
    usage_hint: '',
  }, currentCommand);
}

function saveCommand(guildId, payload, currentId = null) {
  const now = new Date().toISOString();

  if (currentId) {
    const updates = {
      trigger: payload.trigger,
      command_type: payload.command_type,
      command_prefix: payload.command_prefix,
      command_name: payload.command_name,
      enabled: payload.enabled ? 1 : 0,
      description: payload.description,
      response: payload.response,
      reply_in_dm: payload.reply_in_dm,
      response_mode: payload.response_mode,
      delete_trigger: payload.delete_trigger,
      allowed_roles: JSON.stringify(payload.allowed_roles),
      allowed_channels: JSON.stringify(payload.allowed_channels),
      aliases: JSON.stringify(payload.aliases),
      cooldown_ms: payload.cooldown_ms,
      delete_response_after_ms: payload.delete_response_after_ms,
      embed_enabled: payload.embed_enabled,
      embed_title: payload.embed_title,
      embed_color: payload.embed_color,
      mention_user: payload.mention_user,
      require_args: payload.require_args,
      usage_hint: payload.usage_hint,
      updated_at: now,
    };

    const keys = Object.keys(updates);
    db.db.prepare(
      `UPDATE custom_commands SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`
    ).run(...Object.values(updates), currentId);

    return currentId;
  }

  const id = uuidv4();
  db.insert('custom_commands', {
    id,
    guild_id: guildId,
    trigger: payload.trigger,
    command_type: payload.command_type,
    command_prefix: payload.command_prefix,
    command_name: payload.command_name,
    enabled: payload.enabled ? 1 : 0,
    description: payload.description,
    response: payload.response,
    reply_in_dm: payload.reply_in_dm,
    response_mode: payload.response_mode,
    delete_trigger: payload.delete_trigger,
    allowed_roles: JSON.stringify(payload.allowed_roles),
    allowed_channels: JSON.stringify(payload.allowed_channels),
    aliases: JSON.stringify(payload.aliases),
    cooldown_ms: payload.cooldown_ms,
    delete_response_after_ms: payload.delete_response_after_ms,
    embed_enabled: payload.embed_enabled,
    embed_title: payload.embed_title,
    embed_color: payload.embed_color,
    mention_user: payload.mention_user,
    require_args: payload.require_args,
    usage_hint: payload.usage_hint,
    created_at: now,
    updated_at: now,
  });

  return id;
}

router.get('/', (req, res) => {
  const commands = db.raw(
    'SELECT * FROM custom_commands WHERE guild_id = ? ORDER BY command_type ASC, trigger ASC',
    [req.guild.id]
  );

  res.json({ commands: commands.map(mapCommandRow) });
});

router.post('/assistant', validate(commandAssistantSchema), async (req, res, next) => {
  try {
    const currentRow = req.body.command_id
      ? db.raw('SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?', [req.body.command_id, req.guild.id])[0]
      : null;
    const currentCommand = currentRow ? mapCommandRow(currentRow) : null;
    const mode = normalizeCommandType(req.body.mode);
    const requestedMeta = resolveRequestedCommandMeta({
      mode,
      prefix: req.body.prefix || currentCommand?.command_prefix || '!',
      trigger: req.body.trigger,
      command_name: req.body.command_name,
    });
    const prefix = mode === 'slash' ? '/' : (requestedMeta.command_prefix || normalizeCommandPrefix(req.body.prefix || currentCommand?.command_prefix || '!'));
    const systemPrompt = buildAssistantSystemPrompt({
      guildName: req.guild.name,
      mode,
      prefix,
      requestedTrigger: mode === 'prefix' ? requestedMeta.trigger : '',
      requestedCommandName: mode === 'slash' ? requestedMeta.command_name : '',
      existingCommand: currentCommand,
    });
    const messages = [
      ...req.body.conversation_history.slice(-8),
      { role: 'user', content: req.body.prompt },
    ];
    const completion = await aiService.completeConversation(req.user.id, { systemPrompt, messages });
    const draft = extractCommandDraft(completion.text);

    if (!draft) {
      return res.status(502).json({ error: 'Assistant command draft invalid' });
    }

    const payload = normalizeAssistantDraft(draft, mode, prefix, currentCommand, {
      trigger: req.body.trigger,
      command_name: req.body.command_name,
    });
    const collision = findCommandCollision(req.guild.id, payload.trigger, payload.aliases, currentCommand?.id);
    if (collision) {
      return res.status(409).json({ error: `Le declencheur "${collision}" existe deja` });
    }

    enableCommandsModule(req.guild.id);
    const savedId = saveCommand(req.guild.id, payload, currentCommand?.id || null);
    const saved = db.raw('SELECT * FROM custom_commands WHERE id = ?', [savedId])[0];
    scheduleCommandSync(req.user.id, req.guild.guild_id);

    res.json({
      assistant_message: String(completion.text || '').replace(/```command[\s\S]*?```/gi, '').trim(),
      command: mapCommandRow(saved),
      quota: completion.quota,
      usage: completion.usage,
      updated: !!currentCommand,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', validate(customCommandSchema), async (req, res) => {
  const payload = normalizePayload(req.body);
  const collision = findCommandCollision(req.guild.id, payload.trigger, payload.aliases);

  if (collision) {
    return res.status(409).json({ error: `Le declencheur ou alias "${collision}" existe deja` });
  }

  enableCommandsModule(req.guild.id);
  const id = saveCommand(req.guild.id, payload);
  const created = db.raw('SELECT * FROM custom_commands WHERE id = ?', [id])[0];
  scheduleCommandSync(req.user.id, req.guild.guild_id);

  res.status(201).json({ message: 'Command created', command: mapCommandRow(created) });
});

router.patch('/:id', validate(customCommandSchema.partial()), async (req, res) => {
  const row = db.raw(
    'SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];

  if (!row) return res.status(404).json({ error: 'Command not found' });

  const current = mapCommandRow(row);
  const payload = normalizePayload(req.body, current);
  const collision = findCommandCollision(req.guild.id, payload.trigger, payload.aliases, row.id);

  if (collision) {
    return res.status(409).json({ error: `Le declencheur ou alias "${collision}" existe deja` });
  }

  saveCommand(req.guild.id, payload, row.id);
  const updated = db.raw('SELECT * FROM custom_commands WHERE id = ?', [row.id])[0];
  scheduleCommandSync(req.user.id, req.guild.guild_id);

  res.json({ message: 'Command updated', command: mapCommandRow(updated) });
});

router.delete('/:id', async (req, res) => {
  const deleted = db.db.prepare(
    'DELETE FROM custom_commands WHERE id = ? AND guild_id = ?'
  ).run(req.params.id, req.guild.id).changes;

  if (!deleted) return res.status(404).json({ error: 'Command not found' });

  scheduleCommandSync(req.user.id, req.guild.guild_id);
  res.json({ message: 'Command deleted' });
});

router.patch('/:id/toggle', validate(commandToggleSchema), async (req, res) => {
  const cmd = db.raw(
    'SELECT * FROM custom_commands WHERE id = ? AND guild_id = ?',
    [req.params.id, req.guild.id]
  )[0];

  if (!cmd) return res.status(404).json({ error: 'Command not found' });

  const requestedEnabled = typeof req.body.enabled === 'boolean'
    ? req.body.enabled
    : !cmd.enabled;
  const newState = requestedEnabled ? 1 : 0;

  if (newState) {
    enableCommandsModule(req.guild.id);
  }

  db.db.prepare('UPDATE custom_commands SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(newState, new Date().toISOString(), cmd.id);

  scheduleCommandSync(req.user.id, req.guild.guild_id);
  const updated = db.raw('SELECT * FROM custom_commands WHERE id = ?', [cmd.id])[0];
  res.json({ enabled: !!newState, command: mapCommandRow(updated) });
});

module.exports = router;
