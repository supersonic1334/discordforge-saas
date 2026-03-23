const QUICK_BOT_TOKEN_PREFIX = 'quick-bot-token:'

function getStorageKey(userId) {
  if (!userId) return null
  return `${QUICK_BOT_TOKEN_PREFIX}${userId}`
}

export function getQuickBotToken(userId) {
  if (typeof window === 'undefined') return ''
  const storageKey = getStorageKey(userId)
  if (!storageKey) return ''
  return localStorage.getItem(storageKey) || ''
}

export function setQuickBotToken(userId, token) {
  if (typeof window === 'undefined') return
  const storageKey = getStorageKey(userId)
  if (!storageKey) return

  const normalizedToken = token.trim()
  if (!normalizedToken) {
    localStorage.removeItem(storageKey)
    return
  }

  localStorage.setItem(storageKey, normalizedToken)
}
