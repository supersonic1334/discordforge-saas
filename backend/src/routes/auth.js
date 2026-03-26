'use strict';

const express = require('express');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');

const config = require('../config');
const authService = require('../services/authService');
const { recordUserAccess, findMatchingBlock, syncDeviceCookie } = require('../services/accessControlService');
const discordService = require('../services/discordService');
const botManager = require('../services/botManager');
const { encrypt, hash } = require('../services/encryptionService');
const wsServer = require('../websocket');
const { requireAuth, validate } = require('../middleware');
const {
  registerSchema,
  loginSchema,
  changePasswordSchema,
  changeUsernameSchema,
  avatarUpdateSchema,
  preferencesSchema,
  botTokenSchema,
} = require('../validators/schemas');
const db = require('../database');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger').child('AuthRoutes');

const router = express.Router();
const discordOauthEnabled = !!(config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET && config.DISCORD_CALLBACK_URL);
const googleOauthEnabled = !!(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_CALLBACK_URL);

router.get('/access-status', (req, res) => {
  syncDeviceCookie(req, res);
  const block = findMatchingBlock(req);
  res.json({
    blocked: !!block,
    code: block ? 'ACCESS_BLOCKED' : null,
  });
});

// ── Passport OAuth Strategies ─────────────────────────────────────────────────
if (discordOauthEnabled) {
  passport.use(new DiscordStrategy(
    {
      clientID: config.DISCORD_CLIENT_ID,
      clientSecret: config.DISCORD_CLIENT_SECRET,
      callbackURL: config.DISCORD_CALLBACK_URL,
      scope: ['identify', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const result = await authService.upsertOAuthUser({
          provider: 'discord',
          providerId: profile.id,
          email: profile.email,
          username: profile.username,
          avatarUrl: profile.avatar
            ? discordService.getAvatarUrl(profile.id, profile.avatar)
            : null,
          accessToken,
        });
        done(null, result);
      } catch (err) {
        done(err);
      }
    }
  ));
}

if (googleOauthEnabled) {
  passport.use(new GoogleStrategy(
    {
      clientID: config.GOOGLE_CLIENT_ID,
      clientSecret: config.GOOGLE_CLIENT_SECRET,
      callbackURL: config.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const result = await authService.upsertOAuthUser({
          provider: 'google',
          providerId: profile.id,
          email: profile.emails?.[0]?.value,
          username: profile.displayName,
          avatarUrl: profile.photos?.[0]?.value,
        });
        done(null, result);
      } catch (err) {
        done(err);
      }
    }
  ));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ── Helper: send JWT to frontend via redirect ─────────────────────────────────
function redirectWithToken(res, token, error = null) {
  const base = config.FRONTEND_URL;
  if (error) return res.redirect(`${base}/auth/callback?error=${encodeURIComponent(error)}`);
  return res.redirect(`${base}/auth/callback?token=${token}`);
}

router.get('/providers', (req, res) => {
  res.json({
    discord: discordOauthEnabled,
    google: googleOauthEnabled,
  });
});

// ── POST /register ────────────────────────────────────────────────────────────
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const result = await authService.register(req.body);
    recordUserAccess(result.user.id, req);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body);
    recordUserAccess(result.user.id, req);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  // Attach bot token info
  const tokenRow = db.findOne('bot_tokens', { user_id: req.user.id });
  const accessibleGuildCounts = db.db.prepare(`
    SELECT
      COUNT(DISTINCT g.id) AS total_count,
      COUNT(DISTINCT CASE WHEN g.user_id != ? THEN g.id END) AS shared_count
    FROM guilds g
    LEFT JOIN guild_access_members gam
      ON gam.guild_id = g.id
      AND gam.user_id = ?
    WHERE g.is_active = 1
      AND (g.user_id = ? OR gam.user_id IS NOT NULL)
  `).get(req.user.id, req.user.id, req.user.id);
  const totalAccessibleGuilds = Number(accessibleGuildCounts?.total_count || 0);
  const sharedGuildCount = Number(accessibleGuildCounts?.shared_count || 0);
  const botOwnerUserId = tokenRow ? req.user.id : (
    db.db.prepare(`
      SELECT g.user_id
      FROM guild_access_members gam
      JOIN guilds g ON g.id = gam.guild_id
      JOIN bot_tokens bt ON bt.user_id = g.user_id AND bt.is_valid = 1
      WHERE gam.user_id = ?
        AND g.is_active = 1
      ORDER BY lower(g.name) ASC
      LIMIT 1
    `).get(req.user.id)?.user_id || req.user.id
  );
  const botStatus = botManager.getBotStatus(botOwnerUserId);
  res.json({
    user: authService.safeUser(req.user),
    hasBotToken: !!tokenRow || totalAccessibleGuilds > 0,
    hasOwnBotToken: !!tokenRow,
    accessibleGuildCount: totalAccessibleGuilds,
    sharedGuildCount,
    botStatus: botStatus ?? null,
  });
});

router.get('/me/private-email', requireAuth, (req, res) => {
  if (!authService.isPrimaryFounderEmail(req.user.email)) {
    return res.status(403).json({ error: 'Primary founder access required' });
  }

  res.json({
    email: String(req.user.email || '').trim().toLowerCase(),
  });
});

router.post('/ws-ticket', requireAuth, (req, res) => {
  res.json(wsServer.issueAuthTicket(req.user.id));
});

// ── Discord OAuth ─────────────────────────────────────────────────────────────
if (discordOauthEnabled) {
  router.get('/discord', passport.authenticate('discord'));

  router.get('/discord/callback',
    passport.authenticate('discord', { session: false, failureRedirect: `${config.FRONTEND_URL}/auth?error=discord_failed` }),
    (req, res) => {
      recordUserAccess(req.user.user.id, req);
      return redirectWithToken(res, req.user.token);
    }
  );
} else {
  router.get('/discord', (req, res) => {
    res.status(503).json({ error: 'Discord OAuth not configured' });
  });

  router.get('/discord/callback', (req, res) => {
    return redirectWithToken(res, null, 'discord_not_configured');
  });
}

// ── Google OAuth ──────────────────────────────────────────────────────────────
if (googleOauthEnabled) {
  router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

  router.get('/google/callback',
    passport.authenticate('google', { session: false, failureRedirect: `${config.FRONTEND_URL}/auth?error=google_failed` }),
    (req, res) => {
      recordUserAccess(req.user.user.id, req);
      return redirectWithToken(res, req.user.token);
    }
  );
} else {
  router.get('/google', (req, res) => {
    res.status(503).json({ error: 'Google OAuth not configured' });
  });

  router.get('/google/callback', (req, res) => {
    return redirectWithToken(res, null, 'google_not_configured');
  });
}

// ── POST /bot-token — validate and store Discord bot token ────────────────────
router.post('/bot-token', requireAuth, validate(botTokenSchema), async (req, res, next) => {
  try {
    const { token } = req.body;

    // Validate with Discord API
    let botInfo;
    try {
      botInfo = await discordService.validateToken(token);
    } catch (err) {
      return res.status(422).json({ error: 'Invalid Discord bot token', detail: err.message });
    }

    const encryptedToken = encrypt(token);
    const tokenHash = hash(token);
    const now = new Date().toISOString();

    const existing = db.findOne('bot_tokens', { user_id: req.user.id });
    if (existing) {
      db.update('bot_tokens', {
        encrypted_token: encryptedToken,
        token_hash: tokenHash,
        bot_id: botInfo.id,
        bot_username: botInfo.username,
        bot_discriminator: botInfo.discriminator ?? '0',
        bot_avatar: botInfo.avatar,
        is_valid: 1,
        last_validated_at: now,
      }, { user_id: req.user.id });

      // Restart bot with new token
      try {
        await botManager.updateTokenAndRestart(req.user.id, encryptedToken);
      } catch (e) {
        logger.warn(`Bot restart after token update failed: ${e.message}`);
      }
    } else {
      db.insert('bot_tokens', {
        id: uuidv4(),
        user_id: req.user.id,
        encrypted_token: encryptedToken,
        token_hash: tokenHash,
        bot_id: botInfo.id,
        bot_username: botInfo.username,
        bot_discriminator: botInfo.discriminator ?? '0',
        bot_avatar: botInfo.avatar,
        is_valid: 1,
        last_validated_at: now,
        created_at: now,
        updated_at: now,
      });

      // Start the bot
      try {
        await botManager.startBot(req.user.id);
      } catch (e) {
        logger.warn(`Bot start after token set failed: ${e.message}`);
      }
    }

    res.json({
      message: 'Bot token saved and validated',
      bot: {
        id: botInfo.id,
        username: botInfo.username,
        discriminator: botInfo.discriminator ?? '0',
        avatar: botInfo.avatar,
        avatarUrl: discordService.getAvatarUrl(botInfo.id, botInfo.avatar),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /me/username ────────────────────────────────────────────────────────
router.patch('/me/username', requireAuth, validate(changeUsernameSchema), (req, res, next) => {
  try {
    authService.changeUsername(req.user.id, req.body.username);
    res.json({ message: 'Username updated' });
  } catch (err) {
    next(err);
  }
});

router.patch('/me/avatar', requireAuth, validate(avatarUpdateSchema), (req, res, next) => {
  try {
    const avatarUrl = req.body.avatar_url?.trim() || null;
    authService.updateAvatar(req.user.id, avatarUrl);
    const updatedUser = db.findOne('users', { id: req.user.id });
    res.json({ message: 'Avatar updated', user: authService.safeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /me/password ────────────────────────────────────────────────────────
router.patch('/me/password', requireAuth, validate(changePasswordSchema), async (req, res, next) => {
  try {
    await authService.changePassword(req.user.id, req.body);
    res.json({ message: 'Password updated' });
  } catch (err) {
    next(err);
  }
});

// PATCH /me/preferences
router.patch('/me/preferences', requireAuth, validate(preferencesSchema), (req, res, next) => {
  try {
    const updates = {
      site_language: req.body.site_language,
      ai_language: req.body.ai_language,
    };

    if (req.body.analytics_layout !== undefined) {
      updates.analytics_layout = JSON.stringify(req.body.analytics_layout || null);
    }

    db.update('users', updates, { id: req.user.id });

    const updatedUser = db.findOne('users', { id: req.user.id });
    res.json({ message: 'Preferences updated', user: authService.safeUser(updatedUser) });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /me — deactivate account ──────────────────────────────────────────
router.delete('/me', requireAuth, async (req, res, next) => {
  try {
    await botManager.stopBot(req.user.id);
    db.update('users', { is_active: 0 }, { id: req.user.id });
    res.json({ message: 'Account deactivated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
