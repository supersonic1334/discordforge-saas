class WSService {
  constructor() {
    this.ws = null
    this.listeners = new Map()
    this.reconnectTimer = null
    this.reconnectDelay = 1000
    this.isManualClose = false
  }

  _getWebSocketUrl(token) {
    const explicitUrl = import.meta.env.VITE_WS_URL?.trim()
    if (explicitUrl) {
      return `${explicitUrl.replace(/\/$/, '')}?token=${encodeURIComponent(token)}`
    }

    if (import.meta.env.DEV) {
      return `ws://localhost:4000/ws?token=${encodeURIComponent(token)}`
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`
  }

  connect(token) {
    if (!token) return
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return
    this.isManualClose = false
    clearTimeout(this.reconnectTimer)
    const url = this._getWebSocketUrl(token)

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this._emit('ws:connected', {})
      // Keepalive ping every 25s
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
        this.reconnectTimer = setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000)
          this.connect(token)
        }, this.reconnectDelay)
      }
    }

    this.ws.onerror = () => {
      this._emit('ws:error', {})
    }
  }

  disconnect() {
    this.isManualClose = true
    clearInterval(this._pingInterval)
    clearTimeout(this.reconnectTimer)
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
