const QUICK_BOT_TOKEN_PREFIX = 'quick-bot-token:'
const QUICK_BOT_TOKEN_DB = 'discordforger-secure-vault'
const QUICK_BOT_TOKEN_STORE = 'secrets'
const QUICK_BOT_TOKEN_KEY_ID = 'quick-bot-token-key'
const ENCRYPTED_PREFIX = 'enc:v1:'

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

function canUseSecureVault() {
  return typeof window !== 'undefined'
    && !!window.indexedDB
    && !!window.crypto?.subtle
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'))
  })
}

function waitForTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'))
  })
}

function openVault() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(QUICK_BOT_TOKEN_DB, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(QUICK_BOT_TOKEN_STORE)) {
        db.createObjectStore(QUICK_BOT_TOKEN_STORE)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open secure vault'))
  })
}

async function withVaultStore(mode, callback) {
  const db = await openVault()

  try {
    const transaction = db.transaction(QUICK_BOT_TOKEN_STORE, mode)
    const store = transaction.objectStore(QUICK_BOT_TOKEN_STORE)
    const result = await callback(store)
    await waitForTransaction(transaction)
    return result
  } finally {
    db.close()
  }
}

async function getVaultKey() {
  if (!canUseSecureVault()) return null

  try {
    let key = await withVaultStore('readonly', (store) => requestToPromise(store.get(QUICK_BOT_TOKEN_KEY_ID)))
    if (key) return key

    key = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    )

    await withVaultStore('readwrite', (store) => requestToPromise(store.put(key, QUICK_BOT_TOKEN_KEY_ID)))
    return key
  } catch {
    return null
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return window.btoa(binary)
}

function base64ToBytes(value) {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function encryptToken(token) {
  const key = await getVaultKey()
  if (!key) return null

  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const encodedToken = new TextEncoder().encode(token)
  const encrypted = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodedToken)

  return `${ENCRYPTED_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(encrypted))}`
}

async function decryptToken(value) {
  if (!value.startsWith(ENCRYPTED_PREFIX)) return value

  const key = await getVaultKey()
  if (!key) return ''

  const serialized = value.slice(ENCRYPTED_PREFIX.length)
  const [ivBase64, payloadBase64] = serialized.split(':')
  if (!ivBase64 || !payloadBase64) return ''

  try {
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(ivBase64) },
      key,
      base64ToBytes(payloadBase64)
    )

    return new TextDecoder().decode(decrypted)
  } catch {
    return ''
  }
}

function readStoredToken(storageKey) {
  const persisted = localStorage.getItem(storageKey) || ''
  if (persisted) return { value: persisted, sessionOnly: false }

  const sessionValue = sessionStorage.getItem(storageKey) || ''
  if (sessionValue) return { value: sessionValue, sessionOnly: true }

  return { value: '', sessionOnly: false }
}

function clearStoredToken(storageKey) {
  localStorage.removeItem(storageKey)
  sessionStorage.removeItem(storageKey)
}

export async function getQuickBotToken(owner) {
  if (typeof window === 'undefined') return ''

  const storageKeys = getStorageKeys(owner)
  if (!storageKeys.length) return ''

  for (const storageKey of storageKeys) {
    const { value, sessionOnly } = readStoredToken(storageKey)
    if (value) {
      if (!sessionOnly && value.startsWith(ENCRYPTED_PREFIX)) {
        const decrypted = await decryptToken(value)
        if (!decrypted) {
          clearStoredToken(storageKey)
          continue
        }

        const primaryKey = storageKeys[0]
        if (primaryKey && primaryKey !== storageKey) {
          localStorage.setItem(primaryKey, value)
        }
        return decrypted
      }

      if (!sessionOnly && canUseSecureVault()) {
        await setQuickBotToken(owner, value)
      } else if (!sessionOnly) {
        localStorage.removeItem(storageKey)
        sessionStorage.setItem(storageKey, value)
      }

      const primaryKey = storageKeys[0]
      if (primaryKey && primaryKey !== storageKey) {
        if (sessionOnly) sessionStorage.setItem(primaryKey, value)
        else {
          const storedPrimary = readStoredToken(primaryKey).value
          if (!storedPrimary) {
            sessionStorage.setItem(primaryKey, value)
          }
        }
      }
      return value
    }
  }

  return ''
}

export async function setQuickBotToken(owner, token) {
  if (typeof window === 'undefined') return

  const storageKeys = getStorageKeys(owner)
  if (!storageKeys.length) return

  const normalizedToken = token.trim()
  if (!normalizedToken) {
    storageKeys.forEach(clearStoredToken)
    return
  }

  const encryptedToken = await encryptToken(normalizedToken)
  if (encryptedToken) {
    storageKeys.forEach((storageKey) => {
      sessionStorage.removeItem(storageKey)
      localStorage.setItem(storageKey, encryptedToken)
    })
    return
  }

  storageKeys.forEach((storageKey) => {
    localStorage.removeItem(storageKey)
    sessionStorage.setItem(storageKey, normalizedToken)
  })
}
