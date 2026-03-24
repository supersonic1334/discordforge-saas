const QUICK_BOT_TOKEN_PREFIX = 'quick-bot-token:'

function normalizeOwner(owner) {
  if (!owner) return { email: '', id: '' }
  if (typeof owner === 'object') {
    return {
      email: String(owner.email || '').trim().toLowerCase(),
      id: String(owner.id || '').trim(),
    }
  }

  const value = String(owner).trim()
  if (!value) return { email: '', id: '' }
  if (value.includes('@')) return { email: value.toLowerCase(), id: '' }
  return { email: '', id: value }
}

function getStorageKeys(owner) {
  const normalized = normalizeOwner(owner)
  const keys = []

  if (normalized.email) keys.push(`${QUICK_BOT_TOKEN_PREFIX}${normalized.email}`)
  if (normalized.id) keys.push(`${QUICK_BOT_TOKEN_PREFIX}${normalized.id}`)

  return [...new Set(keys)]
}

export function getQuickBotToken(owner) {
  if (typeof window === 'undefined') return ''

  const storageKeys = getStorageKeys(owner)
  if (!storageKeys.length) return ''

  for (const storageKey of storageKeys) {
    const token = localStorage.getItem(storageKey) || ''
    if (token) {
      const primaryKey = storageKeys[0]
      if (primaryKey && primaryKey !== storageKey) {
        localStorage.setItem(primaryKey, token)
      }
      return token
    }
  }

  return ''
}

export function setQuickBotToken(owner, token) {
  if (typeof window === 'undefined') return

  const storageKeys = getStorageKeys(owner)
  if (!storageKeys.length) return

  const normalizedToken = token.trim()
  if (!normalizedToken) {
    storageKeys.forEach((storageKey) => localStorage.removeItem(storageKey))
    return
  }

  storageKeys.forEach((storageKey) => localStorage.setItem(storageKey, normalizedToken))
}
