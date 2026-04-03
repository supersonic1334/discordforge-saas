import axios from 'axios'
import { getDeviceId } from '../utils/deviceId'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: {
    'X-App-Client': 'discordforger-web',
    'X-Requested-With': 'XMLHttpRequest',
  },
})

// Inject JWT token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  config.headers['X-App-Client'] = 'discordforger-web'
  config.headers['X-Requested-With'] = 'XMLHttpRequest'
  const deviceId = getDeviceId()
  if (deviceId) config.headers['X-Device-ID'] = deviceId

  const method = String(config.method || 'get').toLowerCase()
  const hasBody = typeof config.data !== 'undefined' && config.data !== null
  if (!hasBody && ['get', 'delete', 'head'].includes(method)) {
    delete config.headers['Content-Type']
  }

  return config
})

// On 401, clear token and redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 403 && err.response?.data?.code === 'ACCESS_BLOCKED') {
      if (!window.location.search.includes('blocked=1')) {
        window.location.href = '/auth?blocked=1'
      }
    }
    if (err.response?.status === 401) {
      localStorage.removeItem('token')
      if (window.location.pathname !== '/auth') {
        window.location.href = '/auth'
      }
    }
    // Re-throw as-is so callers can read err.response.data
    return Promise.reject(err)
  }
)

function requestWithoutJsonBody(method, url, config = {}) {
  const token = localStorage.getItem('token')
  const deviceId = getDeviceId()
  const headers = {
    Accept: 'application/json',
    'X-App-Client': 'discordforger-web',
    'X-Requested-With': 'XMLHttpRequest',
    ...(config.headers || {}),
  }

  if (token) headers.Authorization = `Bearer ${token}`
  if (deviceId) headers['X-Device-ID'] = deviceId
  delete headers['Content-Type']

  const requestUrl = new URL(`${api.defaults.baseURL}${url}`, window.location.origin)
  if (config.params) {
    Object.entries(config.params).forEach(([key, value]) => {
      if (typeof value !== 'undefined' && value !== null && value !== '') {
        requestUrl.searchParams.set(key, value)
      }
    })
  }

  return fetch(requestUrl.toString(), {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  }).then(async (response) => {
    const raw = await response.text()
    let payload = null

    if (raw) {
      try {
        payload = JSON.parse(raw)
      } catch {
        payload = raw
      }
    }

    if (!response.ok) {
      if (response.status === 403 && payload?.code === 'ACCESS_BLOCKED' && !window.location.search.includes('blocked=1')) {
        window.location.href = '/auth?blocked=1'
      }
      if (response.status === 401) {
        localStorage.removeItem('token')
        if (window.location.pathname !== '/auth') {
          window.location.href = '/auth'
        }
      }

      const error = new Error(payload?.error || response.statusText || 'Request failed')
      error.response = {
        status: response.status,
        data: payload,
      }
      throw error
    }

    return {
      data: payload,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    }
  })
}

function deleteNoBody(url, config = {}) {
  return requestWithoutJsonBody('DELETE', url, config)
}

function postNoBody(url, config = {}) {
  return requestWithoutJsonBody('POST', url, config)
}

function getNoBody(url, config = {}) {
  return requestWithoutJsonBody('GET', url, config)
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  registerChallenge: () => api.get('/auth/register-captcha'),
  register:       (data)     => api.post('/auth/register', data),
  login:          (data)     => api.post('/auth/login', data),
  providers:      ()         => api.get('/auth/providers'),
  createDiscordLink: (data)  => api.post('/auth/discord/link', data),
  accessStatus:   ()         => api.get('/auth/access-status'),
  me:             ()         => api.get('/auth/me'),
  getPrivateEmail: ()        => api.get('/auth/me/private-email'),
  setBotToken:    (token)    => api.post('/auth/bot-token', { token }),
  changeUsername: (username) => api.patch('/auth/me/username', { username }),
  updateAvatar:   (avatar_url) => api.patch('/auth/me/avatar', { avatar_url }),
  changePassword: (data)     => api.patch('/auth/me/password', data),
  updatePreferences: (data)  => api.patch('/auth/me/preferences', data),
  getEmailFastVaultMeta: ()  => api.get('/auth/me/email-fast-vault/meta'),
  saveEmailFastVault: (payload) => api.put('/auth/me/email-fast-vault', { payload }),
  unlockEmailFastVault: (currentPassword) => api.post('/auth/me/email-fast-vault/unlock', currentPassword ? { currentPassword } : {}),
  clearEmailFastVault: ()    => api.delete('/auth/me/email-fast-vault'),
}

// ── Bot ───────────────────────────────────────────────────────────────────────
export const botAPI = {
  status:     ()        => api.get('/bot/status'),
  start:      ()        => api.post('/bot/start'),
  stop:       ()        => api.post('/bot/stop'),
  restart:    ()        => api.post('/bot/restart'),
  guilds:     ()        => api.get('/bot/guilds'),
  syncGuilds: ()        => api.post('/bot/guilds/sync'),
  leaveGuild: (guildId) => api.delete(`/bot/guilds/${guildId}`),
  guild:      (guildId) => api.get(`/bot/guilds/${guildId}`),
  channels:   (guildId) => api.get(`/bot/guilds/${guildId}/channels`),
  roles:      (guildId) => api.get(`/bot/guilds/${guildId}/roles`),
}

// ── Modules ───────────────────────────────────────────────────────────────────
export const modulesAPI = {
  list:   (guildId)             => api.get(`/bot/guilds/${guildId}/modules`),
  get:    (guildId, type)       => api.get(`/bot/guilds/${guildId}/modules/${type}`),
  toggle: (guildId, type, enabled) => api.patch(`/bot/guilds/${guildId}/modules/${type}/toggle`, { enabled }),
  config: (guildId, type, data) => api.patch(`/bot/guilds/${guildId}/modules/${type}/config`, data),
  reset:  (guildId, type)       => api.post(`/bot/guilds/${guildId}/modules/${type}/reset`),
}

// ── Moderation ────────────────────────────────────────────────────────────────
export const modAPI = {
  searchUsers:   (guildId, params) => api.get(`/bot/guilds/${guildId}/moderation/search`, { params }),
  userProfile:   (guildId, userId) => api.get(`/bot/guilds/${guildId}/moderation/users/${userId}`),
  warnings:      (guildId, params) => api.get(`/bot/guilds/${guildId}/moderation/warnings`, { params }),
  userWarnings:  (guildId, userId) => api.get(`/bot/guilds/${guildId}/moderation/warnings/user/${userId}`),
  addWarning:    (guildId, data)   => api.post(`/bot/guilds/${guildId}/moderation/warnings`, data),
  deleteWarning: (guildId, warnId) => api.delete(`/bot/guilds/${guildId}/moderation/warnings/${warnId}`),
  actions:       (guildId, params) => api.get(`/bot/guilds/${guildId}/moderation/actions`, { params }),
  action:        (guildId, data)   => api.post(`/bot/guilds/${guildId}/moderation/actions`, data),
}

export const blockedAPI = {
  list:         (guildId, params) => api.get(`/bot/guilds/${guildId}/blocked`, { params }),
  unban:        (guildId, userId) => deleteNoBody(`/bot/guilds/${guildId}/blocked/bans/${userId}`, { params: { _: Date.now() } }),
  unblacklist:  (guildId, userId) => deleteNoBody(`/bot/guilds/${guildId}/blocked/blacklist/${userId}`, { params: { _: Date.now() } }),
  unbanGet:     (guildId, userId) => getNoBody(`/bot/guilds/${guildId}/blocked/bans/${userId}/unban`, { params: { _: Date.now() } }),
  unblacklistGet: (guildId, userId) => getNoBody(`/bot/guilds/${guildId}/blocked/blacklist/${userId}/remove`, { params: { _: Date.now() } }),
  unbanDelete:  (guildId, userId) => deleteNoBody(`/bot/guilds/${guildId}/blocked/bans/${userId}`, { params: { _: Date.now() } }),
  unblacklistDelete: (guildId, userId) => deleteNoBody(`/bot/guilds/${guildId}/blocked/blacklist/${userId}`, { params: { _: Date.now() } }),
}

export const messagesAPI = {
  config:     (guildId) => api.get(`/bot/guilds/${guildId}/messages/config`),
  saveConfig: (guildId, data) => api.put(`/bot/guilds/${guildId}/messages/config`, data),
  search:     (guildId, params) => api.get(`/bot/guilds/${guildId}/messages/search`, { params }),
  send:       (guildId, data) => api.post(`/bot/guilds/${guildId}/messages/direct`, data),
}

export const teamAPI = {
  overview:       (guildId) => api.get(`/bot/guilds/${guildId}/team`),
  invite:         (guildId, data) => api.post(`/bot/guilds/${guildId}/team/invite`, data),
  createCode:     (guildId, data) => api.post(`/bot/guilds/${guildId}/team/codes`, data),
  revokeCode:     (guildId, codeId) => api.delete(`/bot/guilds/${guildId}/team/codes/${codeId}`),
  redeemCode:     (data) => api.post('/bot/team/join-code/redeem', data),
  updateMember:   (guildId, userId, data) => api.patch(`/bot/guilds/${guildId}/team/members/${userId}`, data),
  suspendMember:  (guildId, userId, data) => api.patch(`/bot/guilds/${guildId}/team/members/${userId}/suspend`, data),
  removeMember:   (guildId, userId) => api.delete(`/bot/guilds/${guildId}/team/members/${userId}`),
  auditLog:       (guildId, params) => api.get(`/bot/guilds/${guildId}/team/audit`, { params }),
  snapshots:      (guildId) => api.get(`/bot/guilds/${guildId}/team/snapshots`),
  createSnapshot: (guildId, data) => api.post(`/bot/guilds/${guildId}/team/snapshots`, data),
  restoreSnapshot:(guildId, snapshotId) => api.post(`/bot/guilds/${guildId}/team/snapshots/${snapshotId}/restore`),
  deleteSnapshot: (guildId, snapshotId) => api.delete(`/bot/guilds/${guildId}/team/snapshots/${snapshotId}`),
  exportBackup:   (guildId) => api.get(`/bot/guilds/${guildId}/team/backups/export`, { responseType: 'blob', timeout: 60000 }),
  importBackup:   (guildId, data) => api.post(`/bot/guilds/${guildId}/team/backups/import`, data, { timeout: 60000 }),
}

export const scanAPI = {
  scan:   (guildId, params) => api.get(`/bot/guilds/${guildId}/scan`, { params }),
  member: (guildId, userId) => api.get(`/bot/guilds/${guildId}/scan/members/${userId}`),
}

export const rassicanAPI = scanAPI

// ── Playbooks ─────────────────────────────────────────────────────────────────
export const playbooksAPI = {
  definitions: (guildId) => api.get(`/guilds/${guildId}/playbooks/definitions`),
  list:        (guildId) => api.get(`/guilds/${guildId}/playbooks`),
  get:         (guildId, id) => api.get(`/guilds/${guildId}/playbooks/${id}`),
  create:      (guildId, data) => api.post(`/guilds/${guildId}/playbooks`, data),
  fromTemplate:(guildId, data) => api.post(`/guilds/${guildId}/playbooks/from-template`, data),
  update:      (guildId, id, data) => api.patch(`/guilds/${guildId}/playbooks/${id}`, data),
  toggle:      (guildId, id, enabled) => api.patch(`/guilds/${guildId}/playbooks/${id}/toggle`, { enabled }),
  delete:      (guildId, id) => api.delete(`/guilds/${guildId}/playbooks/${id}`),
  logs:        (guildId, id) => api.get(`/guilds/${guildId}/playbooks/${id}/logs`),
}

// ── Commands ──────────────────────────────────────────────────────────────────
export const commandsAPI = {
  list:   (guildId)       => api.get(`/bot/guilds/${guildId}/commands`),
  assistant: (guildId, data) => api.post(`/bot/guilds/${guildId}/commands/assistant`, data),
  create: (guildId, data) => api.post(`/bot/guilds/${guildId}/commands`, data),
  update: (guildId, id, data) => api.patch(`/bot/guilds/${guildId}/commands/${id}`, data),
  setSystemLogChannel: (guildId, log_channel_id) => api.patch(`/bot/guilds/${guildId}/commands/system/log-channel`, { log_channel_id }),
  toggle: (guildId, id, enabled)   => api.patch(`/bot/guilds/${guildId}/commands/${id}/toggle`, typeof enabled === 'boolean' ? { enabled } : {}),
  delete: (guildId, id)   => api.delete(`/bot/guilds/${guildId}/commands/${id}`),
}

export const ticketGeneratorAPI = {
  get: (guildId) => api.get(`/bot/guilds/${guildId}/tickets`),
  save: (guildId, data) => api.put(`/bot/guilds/${guildId}/tickets/config`, data, { timeout: 30000 }),
  publish: (guildId) => api.post(`/bot/guilds/${guildId}/tickets/publish`, {}, { timeout: 60000 }),
}

export const captchaAPI = {
  get: (guildId) => api.get(`/bot/guilds/${guildId}/captcha`),
  save: (guildId, data) => api.put(`/bot/guilds/${guildId}/captcha/config`, data, { timeout: 30000 }),
  publish: (guildId) => api.post(`/bot/guilds/${guildId}/captcha/publish`, {}, { timeout: 60000 }),
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export const logsAPI = {
  list:       (guildId, params) => api.get(`/bot/guilds/${guildId}/logs`, { params }),
  discord:    (guildId, params) => api.get(`/bot/guilds/${guildId}/logs/discord`, { params }),
  clearDiscord: (guildId)       => deleteNoBody(`/bot/guilds/${guildId}/logs/discord`),
  analytics:  (guildId)         => api.get(`/bot/guilds/${guildId}/logs/analytics`),
  channel:    (guildId)         => api.get(`/bot/guilds/${guildId}/logs/channel`),
  setChannel: (guildId, data)   => api.put(`/bot/guilds/${guildId}/logs/channel`, data),
}

// ── AI ────────────────────────────────────────────────────────────────────────
export const aiAPI = {
  chat:   (data) => api.post('/ai/chat', data),
  continueAction: (data) => api.post('/ai/continue-action', data),
  status: ()     => api.get('/ai/status'),
  transcribe: (data) => api.post('/ai/transcribe', data),
}

export const osintAPI = {
  status: () => api.get('/osint/status'),
  scanUsername: (username) => api.post('/osint/username', { username }, { timeout: 70000 }),
  geolocate: (imageBase64, mimeType) => api.post('/osint/geolocate', {
    image_base64: imageBase64,
    mime_type: mimeType,
  }, { timeout: 90000 }),
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export const adminAPI = {
  users:      (params)   => api.get('/admin/users', { params }),
  setRole:    (userId, role) => api.patch(`/admin/users/${userId}/role`, { role }),
  setStatus:  (userId, is_active) => api.patch(`/admin/users/${userId}/status`, { is_active }),
  setPassword: (userId, newPassword) => api.patch(`/admin/users/${userId}/password`, { newPassword }),
  deleteUser: (userId)   => api.delete(`/admin/users/${userId}`),
  getAI:      ()         => api.get('/admin/ai'),
  getAIRecommendation: (params) => api.get('/admin/ai/recommendation', { params }),
  setAI:      (data)     => api.put('/admin/ai', data),
  refreshProviderKey: (keyId) => api.post(`/admin/ai/provider-keys/${keyId}/refresh`),
  updateProviderKeyModel: (keyId, model) => api.patch(`/admin/ai/provider-keys/${keyId}/model`, { model }),
  getProviderKeySecret: (keyId) => api.get(`/admin/ai/provider-keys/${keyId}/secret`),
  deleteProviderKey: (keyId) => api.delete(`/admin/ai/provider-keys/${keyId}`),
  system:     ()         => api.get('/admin/system'),
  bots:       ()         => api.get('/admin/bots'),
  restartBot: (userId)   => api.post(`/admin/bots/${userId}/restart`),
}

export const providerAPI = {
  getAI: () => api.get('/provider/ai'),
  saveKey: (data) => api.put('/provider/ai', data),
  refreshKey: (keyId) => api.post(`/provider/ai/${keyId}/refresh`),
  updateModel: (keyId, model) => api.patch(`/provider/ai/${keyId}/model`, { model }),
  deleteKey: (keyId) => api.delete(`/provider/ai/${keyId}`),
}

export const supportAPI = {
  listTickets: (params) => api.get('/support/tickets', { params }),
  createTicket: (data) => api.post('/support/tickets', data),
  getTicket: (ticketId) => api.get(`/support/tickets/${ticketId}`),
  sendMessage: (ticketId, data) => api.post(`/support/tickets/${ticketId}/messages`, data),
  claimTicket: (ticketId) => api.post(`/support/tickets/${ticketId}/claim`),
  unclaimTicket: (ticketId) => api.delete(`/support/tickets/${ticketId}/claim`),
  setStatus: (ticketId, data) => api.patch(`/support/tickets/${ticketId}/status`, data),
  updateTicket: (ticketId, data) => api.patch(`/support/tickets/${ticketId}`, data),
  deleteTicket: (ticketId) => api.delete(`/support/tickets/${ticketId}`),
  deleteMessage: (messageId) => api.delete(`/support/messages/${messageId}`),
}

export const reviewsAPI = {
  overview: () => api.get('/reviews'),
  create: (data) => api.post('/reviews', data),
  updateMine: (data) => api.patch('/reviews/me', data),
}

export default api
