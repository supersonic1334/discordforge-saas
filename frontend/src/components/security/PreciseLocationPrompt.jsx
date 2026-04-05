import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { MapPin, ShieldCheck, X } from 'lucide-react'

import { authAPI } from '../../services/api'
import { useAuthStore } from '../../stores'

const STORAGE_PREFIX = 'discordforge.precise-location'
const REFRESH_INTERVAL_MS = 10 * 60 * 1000

function buildStorageKey(userId) {
  return `${STORAGE_PREFIX}.${userId}`
}

function readStoredState(userId) {
  if (!userId || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(buildStorageKey(userId))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeStoredState(userId, value) {
  if (!userId || typeof window === 'undefined') return
  window.localStorage.setItem(buildStorageKey(userId), JSON.stringify(value))
}

function mapGeoError(error) {
  if (!error) return 'unknown_error'
  if (error.code === 1) return 'permission_denied'
  if (error.code === 2) return 'position_unavailable'
  if (error.code === 3) return 'timeout'
  return 'unknown_error'
}

function getCoordsPayload(position) {
  const coords = position?.coords
  if (!coords) return null

  return {
    latitude: Number(coords.latitude),
    longitude: Number(coords.longitude),
    accuracy_m: Number(coords.accuracy),
    altitude_m: coords.altitude == null ? null : Number(coords.altitude),
    altitude_accuracy_m: coords.altitudeAccuracy == null ? null : Number(coords.altitudeAccuracy),
    heading_deg: coords.heading == null || Number.isNaN(coords.heading) ? null : Number(coords.heading),
    speed_mps: coords.speed == null || Number.isNaN(coords.speed) ? null : Number(coords.speed),
  }
}

function capturePreciseLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator?.geolocation) {
      reject(new Error('unsupported'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      (error) => reject(error),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000,
      }
    )
  })
}

export default function PreciseLocationPrompt() {
  const user = useAuthStore((state) => state.user)
  const token = useAuthStore((state) => state.token)
  const userId = user?.id
  const [visible, setVisible] = useState(false)
  const [saving, setSaving] = useState(false)
  const refreshTimerRef = useRef(null)

  const storedState = useMemo(() => readStoredState(userId), [userId])
  const shouldPrompt = Boolean(
    token
    && userId
    && typeof window !== 'undefined'
    && window.location.pathname !== '/auth'
    && !storedState?.status
  )

  useEffect(() => {
    if (!shouldPrompt) {
      setVisible(false)
      return undefined
    }

    const timerId = window.setTimeout(() => {
      setVisible(true)
    }, 1600)

    return () => window.clearTimeout(timerId)
  }, [shouldPrompt])

  useEffect(() => {
    if (!token || !userId || storedState?.status !== 'granted') return undefined

    const syncPreciseLocation = async () => {
      try {
        const position = await capturePreciseLocation()
        const payload = {
          consent_status: 'granted',
          permission_state: 'granted',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          coords: getCoordsPayload(position),
        }
        await authAPI.savePreciseLocation(payload)
        writeStoredState(userId, {
          status: 'granted',
          updated_at: Date.now(),
        })
      } catch (error) {
        const nextStatus = mapGeoError(error)
        if (nextStatus === 'permission_denied') {
          writeStoredState(userId, {
            status: 'denied',
            updated_at: Date.now(),
          })
          await authAPI.savePreciseLocation({
            consent_status: 'denied',
            permission_state: 'denied',
            error: nextStatus,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
          }).catch(() => {})
        }
      }
    }

    syncPreciseLocation()
    refreshTimerRef.current = window.setInterval(syncPreciseLocation, REFRESH_INTERVAL_MS)

    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [token, userId, storedState?.status])

  const handleDeny = async () => {
    if (!userId) return
    setSaving(true)
    try {
      await authAPI.savePreciseLocation({
        consent_status: 'denied',
        permission_state: 'denied',
        error: 'user_declined',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      })
      writeStoredState(userId, {
        status: 'denied',
        updated_at: Date.now(),
      })
      setVisible(false)
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Refus non enregistre')
    }
    setSaving(false)
  }

  const handleAllow = async () => {
    if (!userId) return
    setSaving(true)
    try {
      const position = await capturePreciseLocation()
      await authAPI.savePreciseLocation({
        consent_status: 'granted',
        permission_state: 'granted',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        coords: getCoordsPayload(position),
      })
      writeStoredState(userId, {
        status: 'granted',
        updated_at: Date.now(),
      })
      setVisible(false)
      toast.success('Localisation precise activee')
    } catch (error) {
      const reason = mapGeoError(error)
      await authAPI.savePreciseLocation({
        consent_status: 'denied',
        permission_state: reason === 'permission_denied' ? 'denied' : 'prompt',
        error: reason,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      }).catch(() => {})
      writeStoredState(userId, {
        status: reason === 'permission_denied' ? 'denied' : 'dismissed',
        updated_at: Date.now(),
      })
      toast.error('Localisation precise refusee ou indisponible')
      setVisible(false)
    }
    setSaving(false)
  }

  if (!visible || !token || !userId) return null

  return (
    <div className="fixed bottom-5 right-5 z-[120] w-[min(92vw,420px)] rounded-3xl border border-neon-cyan/20 bg-[#0a0e16]/95 backdrop-blur-xl shadow-[0_22px_80px_rgba(0,0,0,0.45)] overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.14),transparent_52%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.16),transparent_40%)] pointer-events-none" />
      <div className="relative p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 flex items-center justify-center">
              <MapPin className="w-5 h-5 text-neon-cyan" />
            </div>
            <div>
              <p className="text-sm font-mono uppercase tracking-[0.22em] text-neon-cyan/85">Localisation precise</p>
              <p className="mt-1 text-sm text-white/70">Autorise le GPS pour une protection plus fiable du compte.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="w-8 h-8 rounded-xl border border-white/10 bg-white/[0.04] flex items-center justify-center text-white/45 hover:text-white hover:bg-white/[0.08] transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-xs text-white/55 leading-6">
          Si tu acceptes, le site enregistre des coordonnees GPS precises, la precision en metres et un libelle d’adresse. Si tu refuses, le site garde seulement l’IP et la localisation approximative.
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleAllow}
            disabled={saving}
            className="flex-1 min-w-[160px] inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 bg-gradient-to-r from-neon-cyan to-neon-violet text-white font-display font-700 shadow-[0_18px_46px_rgba(34,211,238,0.24)] disabled:opacity-60"
          >
            <ShieldCheck className="w-4 h-4" />
            {saving ? 'Activation...' : 'Autoriser'}
          </button>
          <button
            type="button"
            onClick={handleDeny}
            disabled={saving}
            className="min-w-[120px] inline-flex items-center justify-center rounded-2xl px-4 py-3 border border-white/10 bg-white/[0.04] text-white/72 hover:text-white hover:bg-white/[0.08] transition-all disabled:opacity-60"
          >
            Refuser
          </button>
        </div>
      </div>
    </div>
  )
}
