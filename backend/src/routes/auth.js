'use strict';

const express = require('express');
const passport = require('passport');
const { Strategy: DiscordStrategy } = require('passport-discord');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const jwt = require('jsonwebtoken');

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
  discordLinkSchema,
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
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const oauthProfile = {
          provider: 'discord',
          providerId: profile.id,
          email: profile.email,
          username: profile.username,
          globalName: profile.global_name || profile.displayName || null,
          avatarUrl: profile.avatar
            ? discordService.getAvatarUrl(profile.id, profile.avatar)
            : null,
          accessToken,
        };
        const linkState = decodeDiscordLinkState(req?.query?.state, { throwOnInvalid: true });

        if (linkState) {
          return done(null, { linkState, oauthProfile });
        }

        const result = await authService.upsertOAuthUser({
          ...oauthProfile,
        });
        done(null, { ...result, oauthProfile });
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

function sanitizeFrontendReturnPath(value) {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard/search';
  return raw;
}

function normalizeDiscordLinkMode(value) {
  return String(value || '').trim().toLowerCase() === 'redirect' ? 'redirect' : 'popup';
}

function buildFrontendRedirect(pathname, params = {}) {
  const url = new URL(sanitizeFrontendReturnPath(pathname), config.FRONTEND_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && typeof value !== 'undefined' && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function signDiscordLinkState(userId, returnTo, mode = 'popup') {
  return jwt.sign(
    {
      type: 'discord-link',
      userId,
      returnTo: sanitizeFrontendReturnPath(returnTo),
      mode: normalizeDiscordLinkMode(mode),
    },
    config.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

function decodeDiscordLinkState(rawState, { throwOnInvalid = false } = {}) {
  if (!rawState) return null;

  try {
    const payload = jwt.verify(String(rawState), config.JWT_SECRET);
    if (payload?.type !== 'discord-link' || !payload?.userId) {
      throw new Error('Invalid Discord link state');
    }

    return {
      userId: payload.userId,
      returnTo: sanitizeFrontendReturnPath(payload.returnTo),
      mode: normalizeDiscordLinkMode(payload.mode),
    };
  } catch (error) {
    if (throwOnInvalid) throw error;
    return null;
  }
}

function renderDiscordLinkPopup(res, linkState, { success, error = '', linkedUser = null, oauthProfile = null } = {}) {
  const returnTo = sanitizeFrontendReturnPath(linkState?.returnTo);
  const fallbackUrl = buildFrontendRedirect(returnTo, success
    ? { discord_linked: '1' }
    : { discord_link_error: error || 'discord_link_failed' });
  const targetOrigin = new URL(config.FRONTEND_URL).origin;
  const payload = {
    source: 'discord-link',
    status: success ? 'success' : 'error',
    error: success ? '' : String(error || 'discord_link_failed'),
    returnTo,
    linkedDiscordId: success ? String(linkedUser?.discord_id || oauthProfile?.providerId || '') : '',
    linkedDiscordUsername: success ? String(oauthProfile?.username || '') : '',
    linkedDiscordGlobalName: success ? String(linkedUser?.discord_global_name || oauthProfile?.globalName || '') : '',
    linkedDiscordAvatarUrl: success ? String(linkedUser?.discord_avatar_url || oauthProfile?.avatarUrl || '') : '',
  };

  return res
    .status(success ? 200 : 400)
    .set('Content-Type', 'text/html; charset=utf-8')
    .send(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Discord link</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #05070d;
        color: #f3f7fb;
        font: 14px/1.5 "DM Sans", system-ui, sans-serif;
      }
      .card {
        width: min(92vw, 420px);
        padding: 24px;
        border-radius: 24px;
        border: 1px solid rgba(255,255,255,0.08);
        background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03));
        box-shadow: 0 24px 60px rgba(0,0,0,0.42);
        text-align: center;
      }
      p { margin: 0; color: rgba(243,247,251,0.76); }
    </style>
  </head>
  <body>
    <div class="card">
      <p>${success ? 'Compte Discord relie. Fermeture...' : 'Liaison Discord en erreur. Fermeture...'}</p>
    </div>
    <script>
      (function () {
        var payload = ${JSON.stringify(payload)};
        var targetOrigin = ${JSON.stringify(targetOrigin)};
        var fallbackUrl = ${JSON.stringify(fallbackUrl)};

        try {
          if (window.opener && !window.opener.closed) {
            window.opener.postMessage(payload, targetOrigin);
            window.setTimeout(function () {
              try {
                window.close();
              } catch (error) {
                // ignore
              }
            }, 180);
            window.setTimeout(function () {
              if (!window.closed) {
                window.location.replace(fallbackUrl);
              }
            }, 900);
            return;
          }
        } catch (error) {
          // ignore and fallback
        }

        window.location.replace(fallbackUrl);
      })();
    </script>
  </body>
</html>`);
}

router.get('/providers', (req, res) => {
  res.json({
    discord: discordOauthEnabled,
    google: googleOauthEnabled,
  });
});

router.post('/discord/link', requireAuth, validate(discordLinkSchema), (req, res) => {
  if (!discordOauthEnabled) {
    return res.status(503).json({ error: 'Discord OAuth not configured' });
  }

  const returnTo = sanitizeFrontendReturnPath(req.body.return_to);
  const mode = normalizeDiscordLinkMode(req.body.mode);
  const state = signDiscordLinkState(req.user.id, returnTo, mode);
  res.json({
    url: `${config.API_PREFIX}/auth/discord?state=${encodeURIComponent(state)}`,
    return_to: returnTo,
    mode,
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
      AND (g.user_id = ? OR (gam.user_id IS NOT NULL AND gam.is_suspended = 0))
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
  router.get('/discord', (req, res, next) => {
    const state = String(req.query.state || '').trim();
    return passport.authenticate('discord', state ? { state } : undefined)(req, res, next);
  });

  router.get('/discord/callback', (req, res, next) => {
    passport.authenticate('discord', { session: false }, async (error, authResult) => {
      if (error || !authResult) {
        const linkState = decodeDiscordLinkState(req.query.state);
        if (linkState) {
          if (linkState.mode === 'popup') {
            return renderDiscordLinkPopup(res, linkState, {
              success: false,
              error: error?.message || 'discord_failed',
            });
          }
          return res.redirect(buildFrontendRedirect(linkState.returnTo, {
            discord_link_error: error?.message || 'discord_failed',
          }));
        }
        return res.redirect(`${config.FRONTEND_URL}/auth?error=discord_failed`);
      }

      if (authResult.linkState) {
        try {
          const linkedUser = await authService.linkDiscordAccount(authResult.linkState.userId, authResult.oauthProfile);
          wsServer.broadcastToUser(String(authResult.linkState.userId), {
            event: 'account:profileUpdated',
            data: { reason: 'discord_linked' },
          });
          if (authResult.linkState.mode === 'popup') {
            return renderDiscordLinkPopup(res, authResult.linkState, {
              success: true,
              linkedUser,
              oauthProfile: authResult.oauthProfile,
            });
          }
          return res.redirect(buildFrontendRedirect(authResult.linkState.returnTo, { discord_linked: '1' }));
        } catch (linkError) {
          logger.warn('Discord account link failed', {
            userId: authResult.linkState.userId,
            error: linkError.message,
          });
          if (authResult.linkState.mode === 'popup') {
            return renderDiscordLinkPopup(res, authResult.linkState, {
              success: false,
              error: linkError.message || 'discord_link_failed',
            });
          }
          return res.redirect(buildFrontendRedirect(authResult.linkState.returnTo, {
            discord_link_error: linkError.message || 'discord_link_failed',
          }));
        }
      }

      recordUserAccess(authResult.user.id, req);
      return redirectWithToken(res, authResult.token);
    })(req, res, next);
  });
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
