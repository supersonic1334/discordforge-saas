# ⚡ DiscordForge — Backend

> Production-ready Discord Bot Management SaaS — Backend API

---

## Architecture

```
backend/
├── src/
│   ├── app.js                     # Express entry point + bootstrap
│   ├── config/
│   │   └── index.js               # Env validation (Zod) + central config
│   ├── database/
│   │   ├── index.js               # node:sqlite wrapper + CRUD helpers
│   │   └── schema.js              # Full SQL schema (15 tables)
│   ├── middleware/
│   │   └── index.js               # requireAuth, requireFounder, validate, etc.
│   ├── routes/
│   │   ├── auth.js                # Register, login, OAuth, bot token
│   │   ├── bot.js                 # Bot start/stop/restart, guild management
│   │   ├── modules.js             # Per-guild module toggle + config
│   │   ├── moderation.js          # Warnings, mod actions, audit log
│   │   ├── commands.js            # Custom command CRUD
│   │   ├── logs.js                # Bot logs, analytics, log channel config
│   │   └── aiAdmin.js             # AI chat endpoint + admin panel
│   ├── services/
│   │   ├── authService.js         # BCrypt, JWT, OAuth upsert
│   │   ├── discordService.js      # Discord REST + rate-limit retry
│   │   ├── encryptionService.js   # AES-256-CBC + SHA-256
│   │   ├── botManager.js          # Multi-instance bot process manager
│   │   ├── guildSyncService.js    # Guild sync + module initialization
│   │   └── aiService.js           # AI chat + action executor
│   ├── bot/
│   │   ├── BotProcess.js          # Discord.js Client wrapper w/ crash recovery
│   │   ├── modules/
│   │   │   ├── definitions.js     # 12 module definitions + default configs
│   │   │   ├── antiSpam.js        # Sliding-window spam detection
│   │   │   ├── securityModules.js # Anti-link, invite, mass-mention, raid, bot
│   │   │   └── utilityModules.js  # Welcome, auto-role, logging, custom cmds
│   │   └── utils/
│   │       └── modHelpers.js      # Warning DB ops, mod action recording, escalation
│   ├── validators/
│   │   └── schemas.js             # Zod schemas for all endpoints
│   ├── websocket/
│   │   └── index.js               # Per-user WS broadcaster (JWT auth)
│   ├── jobs/
│   │   └── index.js               # Cron: warning expiry, guild sync, log cleanup, watchdog
│   └── utils/
│       └── logger.js              # Winston + daily rotate + category child loggers
├── data/                          # SQLite DB file (auto-created)
├── logs/                          # Rotating log files (auto-created)
├── .env.example                   # Environment template
└── package.json
```

---

## Database Schema (15 tables)

| Table | Purpose |
|---|---|
| `users` | Accounts with OAuth + role system |
| `bot_tokens` | Encrypted Discord bot tokens per user |
| `guilds` | Discord servers the bot is in |
| `modules` | Per-guild module state + JSON config |
| `warnings` | Member warnings with expiry |
| `mod_actions` | Full moderation audit trail |
| `custom_commands` | User-defined text commands |
| `bot_logs` | Bot event logs (per guild) |
| `system_logs` | Platform-level error log |
| `guild_log_channels` | Where to send audit embeds |
| `ai_config` | AI provider settings (encrypted key) |
| `bot_processes` | Runtime status per user |
| `spam_stats` | Daily spam tracking |

---

## Quick Start

### 1. Prerequisites

- **Node.js 22.5+** (required for built-in `node:sqlite`)
- No other native dependencies needed

### 2. Clone and install

```bash
cd backend
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` — the critical fields:

```env
# REQUIRED — generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=<64+ char random string>

# REQUIRED — generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex').slice(0,32))"
ENCRYPTION_KEY=<32 char string>
ENCRYPTION_IV=<16 char string>

# REQUIRED — your frontend URL
FRONTEND_URL=http://localhost:5173

# OPTIONAL — Discord OAuth (leave blank to disable that login method)
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=

# OPTIONAL — Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# OPTIONAL — set your founder credentials
FOUNDER_EMAIL=admin@yourdomain.com
FOUNDER_PASSWORD=YourSecurePassword!
```

### 4. Generate secure keys

```bash
node -e "
const c = require('crypto');
console.log('JWT_SECRET=' + c.randomBytes(64).toString('hex'));
console.log('ENCRYPTION_KEY=' + c.randomBytes(16).toString('hex'));
console.log('ENCRYPTION_IV=' + c.randomBytes(8).toString('hex'));
"
```

### 5. Start the server

```bash
# Development (with auto-reload)
npm run dev

# Production
node src/app.js
```

The server starts on `http://localhost:4000` by default.

---

## API Reference

### Auth — `/api/v1/auth`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/register` | ❌ | Create new account |
| POST | `/login` | ❌ | Login with email/password |
| GET | `/me` | ✅ | Get current user + bot status |
| GET | `/discord` | ❌ | Start Discord OAuth |
| GET | `/google` | ❌ | Start Google OAuth |
| POST | `/bot-token` | ✅ | Validate + save Discord bot token |
| PATCH | `/me/username` | ✅ | Change username |
| PATCH | `/me/password` | ✅ | Change password |
| DELETE | `/me` | ✅ | Deactivate account |

### Bot — `/api/v1/bot`

| Method | Path | Description |
|---|---|---|
| GET | `/status` | Bot runtime status |
| POST | `/start` | Start the bot |
| POST | `/stop` | Stop the bot |
| POST | `/restart` | Restart the bot |
| GET | `/guilds` | List all guilds |
| POST | `/guilds/sync` | Force guild resync from Discord |
| DELETE | `/guilds/:guildId` | Remove bot from server |
| GET | `/guilds/:guildId/channels` | Fetch Discord channels |
| GET | `/guilds/:guildId/roles` | Fetch Discord roles |

### Modules — `/api/v1/bot/guilds/:guildId/modules`

| Method | Path | Description |
|---|---|---|
| GET | `/` | All 12 modules with configs |
| GET | `/:moduleType` | Single module |
| PATCH | `/:moduleType/toggle` | Enable / disable |
| PATCH | `/:moduleType/config` | Update simple + advanced config |
| POST | `/:moduleType/reset` | Reset to defaults |

**Module Types:** `ANTI_SPAM`, `ANTI_LINK`, `ANTI_INVITE`, `ANTI_RAID`, `ANTI_BOT`, `ANTI_MASS_MENTION`, `WARNING_SYSTEM`, `AUTO_MOD`, `WELCOME_MESSAGE`, `AUTO_ROLE`, `LOGGING`, `CUSTOM_COMMANDS`

### Moderation — `/api/v1/bot/guilds/:guildId/moderation`

| Method | Path | Description |
|---|---|---|
| GET | `/warnings` | List active warnings (paginated) |
| GET | `/warnings/user/:discordUserId` | Warnings for one user |
| POST | `/warnings` | Issue a warning + escalation check |
| DELETE | `/warnings/:id` | Remove a warning |
| GET | `/actions` | Audit log (paginated) |
| POST | `/actions` | Execute kick/ban/timeout/unban |

### Logs — `/api/v1/bot/guilds/:guildId/logs`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Bot logs (paginated, filterable) |
| GET | `/analytics` | 30-day stats dashboard |
| GET | `/channel` | Log channel config |
| PUT | `/channel` | Set log channel |

### Custom Commands — `/api/v1/bot/guilds/:guildId/commands`

| Method | Path | Description |
|---|---|---|
| GET | `/` | All commands |
| POST | `/` | Create command |
| PATCH | `/:id` | Update command |
| PATCH | `/:id/toggle` | Enable / disable |
| DELETE | `/:id` | Delete command |

### AI — `/api/v1/ai`

| Method | Path | Description |
|---|---|---|
| POST | `/chat` | Chat with AI agent (executes real actions) |
| GET | `/status` | Whether AI is configured |

### Admin (Founder only) — `/api/v1/admin`

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List all users |
| PATCH | `/users/:id/role` | Change user role |
| PATCH | `/users/:id/status` | Activate / deactivate |
| DELETE | `/users/:id` | Remove user |
| GET | `/ai` | Current AI config |
| PUT | `/ai` | Set AI provider + key + model |
| GET | `/system` | System stats |
| GET | `/bots` | All running bots |
| POST | `/bots/:userId/restart` | Restart a user's bot |

---

## WebSocket

Connect to `ws://localhost:4000/ws?token=<JWT>`

**Server → Client events:**
| Event | Data | Description |
|---|---|---|
| `connected` | `{ userId }` | Authentication confirmed |
| `bot:statusChange` | `{ status, userId }` | Bot process state changed |
| `bot:ready` | `{ botTag, guildCount }` | Bot fully connected to Discord |
| `bot:guildUpdate` | `{ userId }` | Guild list changed |
| `pong` | — | Response to ping |

**Client → Server messages:**
```json
{ "type": "ping" }
```

---

## Security

- **Bot tokens**: AES-256-CBC encrypted at rest, decrypted only in memory
- **Passwords**: bcrypt with 12 rounds
- **API keys** (AI): AES-256-CBC encrypted
- **Auth**: JWT RS256-equivalent, 7-day expiry by default
- **Rate limiting**: Global (100/15min) + Auth-specific (20/15min)
- **Helmet**: Secure HTTP headers
- **Input validation**: Zod on every endpoint body/query
- **Guild ownership**: Every guild-scoped endpoint verifies `user_id` match
- **Role system**: `member` / `founder` with middleware enforcement

---

## Bot Runtime

The `BotManager` singleton manages one `BotProcess` per user:

```
User saves token → BotManager.startBot(userId)
                 → BotProcess.start()
                   → discord.js Client login
                   → Events wired (message, memberAdd, etc.)
                   → Guilds synced to DB
                   → Modules initialized
                   → Heartbeat every 15s
                   → On error: exponential backoff restart
                   → Max 5 restart attempts
```

**Crash recovery**: Exponential backoff (5s → 10s → 20s → 40s → 80s), then gives up and marks `status = error`.

**Watchdog cron**: Runs every 5 minutes, detects bots marked `running` but not in memory, restarts them.

---

## Modules Implemented

| Module | Events handled | Actions available |
|---|---|---|
| Anti-Spam | `messageCreate` | delete, timeout, kick, ban |
| Anti-Link | `messageCreate` | delete, timeout, kick, ban |
| Anti-Invite | `messageCreate` | delete, timeout |
| Anti-Mass-Mention | `messageCreate` | delete, timeout |
| Anti-Raid | `guildMemberAdd` | kick, ban |
| Anti-Bot | `guildMemberAdd` | kick, ban |
| Warning System | API-driven | escalate: timeout → kick → ban |
| Welcome Message | `guildMemberAdd` | channel send, DM, embed |
| Auto Role | `guildMemberAdd` | assign roles (with delay) |
| Logging | All events | embed in log channel |
| Custom Commands | `messageCreate` | text response, DM, auto-delete |

---

## AI Agent

The AI agent receives a system prompt with full platform context and can execute real actions embedded in its response:

```
User: "Enable anti-spam for my main server"
AI:   "I'll enable the Anti-Spam module for 'My Main Server' now."
      ```action
      { "action": "toggle_module", "params": { "guildId": "...", "moduleType": "ANTI_SPAM", "enabled": true } }
      ```
      Done! Anti-Spam is now active. Messages will be monitored for flooding...
```

Supported: `toggle_module`, `update_module_config`, `add_warning`, `kick_user`, `ban_user`, `timeout_user`, `leave_guild`, `start_bot`, `stop_bot`, `restart_bot`, `sync_guilds`

**Providers**: Anthropic Claude, OpenAI GPT, Google Gemini — configured by founder in admin panel.
