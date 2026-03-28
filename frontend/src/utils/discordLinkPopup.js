function buildPopupFeatures(width = 560, height = 760) {
  const dualScreenLeft = typeof window.screenLeft !== 'undefined' ? window.screenLeft : window.screenX
  const dualScreenTop = typeof window.screenTop !== 'undefined' ? window.screenTop : window.screenY
  const screenWidth = window.innerWidth || document.documentElement.clientWidth || window.screen.width
  const screenHeight = window.innerHeight || document.documentElement.clientHeight || window.screen.height
  const left = Math.max(0, dualScreenLeft + Math.round((screenWidth - width) / 2))
  const top = Math.max(0, dualScreenTop + Math.round((screenHeight - height) / 2))

  return [
    'popup=yes',
    'toolbar=no',
    'menubar=no',
    'location=yes',
    'status=no',
    'resizable=yes',
    'scrollbars=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
  ].join(',')
}

export function openDiscordLinkPopup(url, { timeoutMs = 120000, closeGraceMs = 1600 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('Fenetre indisponible'))
      return
    }

    const expectedOrigin = window.location.origin
    const popup = window.open(url, 'discord-link-popup', buildPopupFeatures())

    if (!popup) {
      reject(new Error('Popup bloquee'))
      return
    }

    let settled = false
    let closePoll = null
    let timeoutId = null
    let closeGraceTimeout = null

    const cleanup = () => {
      if (settled) return
      settled = true
      window.removeEventListener('message', handleMessage)
      if (closePoll) {
        window.clearInterval(closePoll)
        closePoll = null
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
      if (closeGraceTimeout) {
        window.clearTimeout(closeGraceTimeout)
        closeGraceTimeout = null
      }
    }

    const handleMessage = (event) => {
      if (event.origin !== expectedOrigin) return
      if (!event.data || event.data.source !== 'discord-link') return
      cleanup()
      resolve(event.data)
    }

    window.addEventListener('message', handleMessage)

    closePoll = window.setInterval(() => {
      if (!popup || popup.closed) {
        if (closeGraceTimeout) return
        closeGraceTimeout = window.setTimeout(() => {
          cleanup()
          reject(new Error('Popup fermee'))
        }, closeGraceMs)
      }
    }, 350)

    timeoutId = window.setTimeout(() => {
      cleanup()
      try {
        popup.close()
      } catch {
        // ignore
      }
      reject(new Error('Timeout de liaison Discord'))
    }, timeoutMs)
  })
}

export default openDiscordLinkPopup
