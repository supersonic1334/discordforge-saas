import axios from 'axios'
import { getDeviceId } from '../utils/deviceId'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
})

// Inject JWT token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  const deviceId = getDeviceId()
  if (deviceId) config.headers['X-Device-ID'] = deviceId
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

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authAPI = {
  register:       (data)     => api.post('/auth/register', data),
  login:          (data)     => api.post('/auth/login', data),
  providers:      ()         => api.get('/auth/providers'),
  accessStatus:   ()         => api.get('/auth/access-status'),
  me:             ()         => api.get('/auth/me'),
  getPrivateEmail: ()        => api.get('/auth/me/private-email'),
  setBotToken:    (token)    => api.post('/auth/bot-token', { token }),
  changeUsername: (username) => api.patch('/auth/me/username', { username }),
  updateAvatar:   (avatar_url) => api.patch('/auth/me/avatar', { avatar_url }),
  changePassword: (data)     => api.patch('/auth/me/password', data),
  updatePreferences: (data)  => api.patch('/auth/me/preferences', data),
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
  warnings:      (guildId, params) => api.get(`/bot/guilds/${guildId}/moderation/warnings`, { params }),
  userWarnings:  (guildId, userId) => api.get(`/bot/guilds/${guildId}/moderation/warnings/user/${userId}`),
  addWarning:    (guildId, data)   => api.post(`/bot/guilds/${guildId}/moderation/warnings`, data),
  deleteWarning: (guildId, warnId) => api.delete(`/bot/guilds/${guildId}/moderation/warnings/${warnId}`),
  actions:       (guildId, params) => api.get(`/bot/guilds/${guildId}/moderation/actions`, { params }),
  action:        (guildId, data)   => api.post(`/bot/guilds/${guildId}/moderation/actions`, data),
}

// ── Commands ──────────────────────────────────────────────────────────────────
export const commandsAPI = {
  list:   (guildId)       => api.get(`/bot/guilds/${guildId}/commands`),
  assistant: (guildId, data) => api.post(`/bot/guilds/${guildId}/commands/assistant`, data),
  create: (guildId, data) => api.post(`/bot/guilds/${guildId}/commands`, data),
  update: (guildId, id, data) => api.patch(`/bot/guilds/${guildId}/commands/${id}`, data),
  toggle: (guildId, id, enabled)   => api.patch(`/bot/guilds/${guildId}/commands/${id}/toggle`, typeof enabled === 'boolean' ? { enabled } : {}),
  delete: (guildId, id)   => api.delete(`/bot/guilds/${guildId}/commands/${id}`),
}

// ── Logs ──────────────────────────────────────────────────────────────────────
export const logsAPI = {
  list:       (guildId, params) => api.get(`/bot/guilds/${guildId}/logs`, { params }),
  discord:    (guildId, params) => api.get(`/bot/guilds/${guildId}/logs/discord`, { params }),
  analytics:  (guildId)         => api.get(`/bot/guilds/${guildId}/logs/analytics`),
  channel:    (guildId)         => api.get(`/bot/guilds/${guildId}/logs/channel`),
  setChannel: (guildId, data)   => api.put(`/bot/guilds/${guildId}/logs/channel`, data),
}

// ── AI ────────────────────────────────────────────────────────────────────────
export const aiAPI = {
  chat:   (data) => api.post('/ai/chat', data),
  status: ()     => api.get('/ai/status'),
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
