import { getDeviceId } from '../utils/deviceId'

class WSService {
  constructor() {
    this.ws = null
    this.listeners = new Map()
    this.reconnectTimer = null
    this.reconnectDelay = 1000
    this.isManualClose = false
    this.connectPromise = null
  }

  _getWebSocketUrl(ticket) {
    const explicitUrl = import.meta.env.VITE_WS_URL?.trim()
    if (explicitUrl) {
      return `${explicitUrl.replace(/\/$/, '')}?ticket=${encodeURIComponent(ticket)}`
    }

    if (import.meta.env.DEV) {
      return `ws://localhost:4000/ws?ticket=${encodeURIComponent(ticket)}`
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws?ticket=${encodeURIComponent(ticket)}`
  }

  async _fetchTicket(token) {
    const headers = {
      Authorization: `Bearer ${token}`,
      'X-App-Client': 'discordforger-web',
      'X-Requested-With': 'XMLHttpRequest',
    }

    const deviceId = getDeviceId()
    if (deviceId) {
      headers['X-Device-ID'] = deviceId
    }

    const response = await fetch('/api/v1/auth/ws-ticket', {
      method: 'POST',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}))
      const error = new Error(payload?.error || 'WebSocket auth failed')
      error.status = response.status
      error.code = payload?.code || ''
      throw error
    }

    const payload = await response.json()
    return payload.ticket
  }

  _scheduleReconnect(token) {
    if (this.isManualClose) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
      this.connect(token)
    }, this.reconnectDelay)
  }

  connect(token) {
    if (!token) return
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING || this.connectPromise) return
    this.isManualClose = false
    clearTimeout(this.reconnectTimer)

    this.connectPromise = this._fetchTicket(token)
      .then((ticket) => {
        if (!ticket || this.isManualClose) return

        const url = this._getWebSocketUrl(ticket)
        this.ws = new WebSocket(url)

        this.ws.onopen = () => {
          this.reconnectDelay = 1000
          this._emit('ws:connected', {})
          this._pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(JSON.stringify({ type: 'ping' }))
            }
          }, 25000)
        }

        this.ws.onmessage = (event) => {
          try {
            const { event: name, data } = JSON.parse(event.data)
            this._emit(name, data)
          } catch { /* ignore */ }
        }

        this.ws.onclose = (event) => {
          clearInterval(this._pingInterval)
          if (event?.code === 4005) {
            this._emit('account:profileUpdated', {
              reason: event?.reason || 'profile_updated',
              forceReload: true,
            })
            return
          }
          if (event?.code === 4003) {
            this._emit('account:blocked', {})
            return
          }
          if (event?.code === 4004) {
            this._emit('account:deleted', {})
            return
          }
          if (event?.code === 4001) {
            this._emit('session:invalid', {})
            return
          }
          if (!this.isManualClose) {
            this._emit('ws:disconnected', {})
            this._scheduleReconnect(token)
          }
        }

        this.ws.onerror = () => {
          this._emit('ws:error', {})
        }
      })
      .catch((error) => {
        if (error?.status === 403 && error?.code === 'ACCESS_BLOCKED') {
          this._emit('account:blocked', {})
          return
        }
        if (error?.status === 401) {
          this._emit('session:invalid', {})
          return
        }
        this._emit('ws:error', {})
        this._scheduleReconnect(token)
      })
      .finally(() => {
        this.connectPromise = null
      })
  }

  disconnect() {
    this.isManualClose = true
    clearInterval(this._pingInterval)
    clearTimeout(this.reconnectTimer)
    this.connectPromise = null
    this.ws?.close()
    this.ws = null
  }

  on(event, cb) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set())
    this.listeners.get(event).add(cb)
    return () => this.listeners.get(event)?.delete(cb)
  }

  _emit(event, data) {
    this.listeners.get(event)?.forEach((cb) => cb(data))
  }
}

export const wsService = new WSService()
export default wsService
