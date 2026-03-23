const STORAGE_KEY = 'discordforge_device_id'

function createFallbackId() {
  return `df_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

export function getDeviceId() {
  if (typeof window === 'undefined') return null

  try {
    const existing = localStorage.getItem(STORAGE_KEY)
    if (existing) return existing

    const generated = typeof crypto !== 'undefined' && crypto.randomUUID
      ? `df_${crypto.randomUUID()}`
      : createFallbackId()

    localStorage.setItem(STORAGE_KEY, generated)
    return generated
  } catch {
    return createFallbackId()
  }
}
