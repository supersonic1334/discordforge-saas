export const API = 'https://api.mail.tm'
export const QR_CODE_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
export const MAX_MAILBOXES = 5
export const EMAIL_FAST_VAULT_KEY = 'discordforger-email-fast-vault'
export const DELETE_CONFIRMATION_WORD = 'SUPPRIMER'

export const DURATION_OPTIONS = [
  { id: '10m', label: '10 min', note: 'Sprint', minutes: 10 },
  { id: '1h', label: '1 heure', note: 'Classique', minutes: 60 },
  { id: '6h', label: '6 heures', note: 'Longue', minutes: 360 },
  { id: '24h', label: '24 heures', note: 'Journee', minutes: 1440 },
  { id: 'permanent', label: 'Permanent', note: 'Sans limite', minutes: null },
  { id: 'custom', label: 'Perso', note: '5 min a 7 jours', minutes: 'custom' },
]

export const POLL_OPTIONS = [
  { id: 'fast', label: '6 s', value: 6000, note: 'Ultra live' },
  { id: 'balanced', label: '15 s', value: 15000, note: 'Equilibre' },
  { id: 'steady', label: '30 s', value: 30000, note: 'Calme' },
]

export const FILTER_OPTIONS = [
  { id: 'all', label: 'Tous' },
  { id: 'unread', label: 'Non lus' },
  { id: 'starred', label: 'Favoris' },
]

export const DEFAULT_DRAFT = {
  durationKey: '1h',
  customDurationMinutes: '180',
  pollIntervalMs: 6000,
}

let qrCodeScriptPromise

export function ensureQRCodeScript() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.QRCode) return Promise.resolve(window.QRCode)

  if (!qrCodeScriptPromise) {
    qrCodeScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${QR_CODE_SCRIPT_URL}"]`)

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.QRCode), { once: true })
        existingScript.addEventListener('error', reject, { once: true })
        return
      }

      const script = document.createElement('script')
      script.src = QR_CODE_SCRIPT_URL
      script.async = true
      script.onload = () => resolve(window.QRCode)
      script.onerror = () => {
        qrCodeScriptPromise = null
        reject(new Error('Unable to load QRCode.js'))
      }
      document.head.appendChild(script)
    })
  }

  return qrCodeScriptPromise
}

export function randomString(length) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const array = new Uint32Array(length)
    window.crypto.getRandomValues(array)
    return Array.from(array, (value) => chars[value % chars.length]).join('')
  }
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export function stripHtml(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', 'readonly')
    textarea.style.position = 'absolute'
    textarea.style.left = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
  }
}

export function formatDuration(totalMinutes) {
  const minutes = Number(totalMinutes)
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min'
  if (minutes < 60) return `${minutes} min`
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return `${days} jour${days > 1 ? 's' : ''}`
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return `${hours} heure${hours > 1 ? 's' : ''}`
  }
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return `${hours} h ${String(remainder).padStart(2, '0')}`
}

export function getDurationConfig(durationKey, customInput) {
  if (durationKey === 'permanent') {
    return {
      key: durationKey,
      label: 'Permanent',
      summary: 'Sans expiration locale',
      isPermanent: true,
      minutes: null,
      totalMs: null,
      valid: true,
    }
  }

  if (durationKey === 'custom') {
    const parsed = Number(customInput)
    if (!Number.isFinite(parsed) || parsed < 5 || parsed > 10080) {
      return {
        key: durationKey,
        label: 'Perso',
        summary: 'Entre 5 minutes et 7 jours',
        isPermanent: false,
        minutes: null,
        totalMs: null,
        valid: false,
        error: 'Choisis une duree perso entre 5 minutes et 7 jours.',
      }
    }

    return {
      key: durationKey,
      label: formatDuration(parsed),
      summary: `Perso - ${formatDuration(parsed)}`,
      isPermanent: false,
      minutes: parsed,
      totalMs: parsed * 60 * 1000,
      valid: true,
    }
  }

  const option = DURATION_OPTIONS.find((item) => item.id === durationKey)
  const minutes = option?.minutes

  if (!Number.isFinite(minutes)) {
    return {
      key: durationKey,
      label: 'Invalide',
      summary: 'Preset introuvable',
      isPermanent: false,
      minutes: null,
      totalMs: null,
      valid: false,
      error: 'Preset de duree introuvable.',
    }
  }

  return {
    key: durationKey,
    label: option.label,
    summary: option.note,
    isPermanent: false,
    minutes,
    totalMs: minutes * 60 * 1000,
    valid: true,
  }
}

export function formatRemaining(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00'
  const totalSeconds = Math.ceil(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (days > 0) return `${days}j ${String(hours).padStart(2, '0')}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatMessageTime(value) {
  if (!value) return '--'
  try {
    const date = new Date(value)
    const diff = Date.now() - date.getTime()
    if (diff < 60000) return 'A l instant'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min`
    if (diff < 86400000) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  } catch {
    return value
  }
}

export function formatDateTime(value) {
  if (!value) return '--'
  try {
    return new Date(value).toLocaleString('fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

export function getPasswordStrengthMeta(password) {
  let score = 0
  if (password.length >= 8) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1

  const steps = [
    { label: 'Tres faible', width: '18%', color: '#ef4444' },
    { label: 'Faible', width: '38%', color: '#f97316' },
    { label: 'Correct', width: '66%', color: '#38bdf8' },
    { label: 'Solide', width: '100%', color: '#22c55e' },
  ]

  if (!password.length) {
    return { label: 'Vide', width: '0%', color: 'transparent', score: 0 }
  }

  return { ...steps[Math.max(0, score - 1)], score }
}

function bytesToBase64(bytes) {
  const chunkSize = 32768
  let binary = ''
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
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

async function deriveVaultKey(password, saltBytes) {
  const material = await window.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  )

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: 210000,
      hash: 'SHA-256',
    },
    material,
    {
      name: 'AES-GCM',
      length: 256,
    },
    false,
    ['encrypt', 'decrypt']
  )
}

export function loadStoredVault() {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(EMAIL_FAST_VAULT_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function saveStoredVault(vault) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(EMAIL_FAST_VAULT_KEY, JSON.stringify(vault))
}

export function clearStoredVault() {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(EMAIL_FAST_VAULT_KEY)
}

export async function encryptVault(password, payload) {
  const saltBytes = window.crypto.getRandomValues(new Uint8Array(16))
  const ivBytes = window.crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveVaultKey(password, saltBytes)
  const encodedPayload = new TextEncoder().encode(JSON.stringify(payload))
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    encodedPayload
  )

  return {
    version: 1,
    updatedAt: Date.now(),
    mailboxCount: Array.isArray(payload?.mailboxes) ? payload.mailboxes.length : 0,
    salt: bytesToBase64(saltBytes),
    iv: bytesToBase64(ivBytes),
    data: bytesToBase64(new Uint8Array(cipherBuffer)),
  }
}

export async function decryptVault(password, vault) {
  if (!vault?.salt || !vault?.iv || !vault?.data) {
    throw new Error('Coffre Email Fast invalide.')
  }

  try {
    const saltBytes = base64ToBytes(vault.salt)
    const ivBytes = base64ToBytes(vault.iv)
    const cipherBytes = base64ToBytes(vault.data)
    const key = await deriveVaultKey(password, saltBytes)
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: ivBytes },
      key,
      cipherBytes
    )

    return JSON.parse(new TextDecoder().decode(plainBuffer))
  } catch {
    throw new Error('Mot de passe incorrect ou coffre illisible.')
  }
}
