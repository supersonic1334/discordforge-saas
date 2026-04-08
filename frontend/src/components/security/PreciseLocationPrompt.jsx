import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { MapPin, ShieldCheck } from 'lucide-react'

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
  const [confirmDeny, setConfirmDeny] = useState(false)
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
      setConfirmDeny(false)
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
      setConfirmDeny(false)
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
      setConfirmDeny(false)
      setVisible(false)
      toast.success("Autorisation d'acces activee")
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
      setConfirmDeny(false)
      toast.error("Autorisation d'acces refusee ou indisponible")
      setVisible(false)
    }
    setSaving(false)
  }

  if (!visible || !token || !userId) return null

  return (
    <div className="fixed bottom-5 right-5 z-[120] w-[min(92vw,320px)] overflow-hidden rounded-2xl border border-neon-cyan/18 bg-[#0a0e16]/94 shadow-[0_22px_60px_rgba(0,0,0,0.42)] backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.12),transparent_58%),radial-gradient(circle_at_bottom_right,rgba(124,58,237,0.12),transparent_42%)]" />
      <div className="relative space-y-3 p-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/20 bg-neon-cyan/10">
            <MapPin className="h-4 w-4 text-neon-cyan" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-display font-700 text-white">Securiser l'acces du site ?</p>
          </div>
        </div>

        {confirmDeny && (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/70">
            Etes-vous sur ?
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAllow}
            disabled={saving}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-violet px-4 py-2.5 font-display font-700 text-white shadow-[0_16px_34px_rgba(34,211,238,0.22)] disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            {saving ? 'Activation...' : 'Oui'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmDeny) {
                handleDeny()
                return
              }
              setConfirmDeny(true)
            }}
            disabled={saving}
            className="inline-flex min-w-[84px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-white/72 transition-all hover:bg-white/[0.08] hover:text-white disabled:opacity-60"
          >
            {confirmDeny ? 'Confirmer' : 'Non'}
          </button>
          {confirmDeny && (
            <button
              type="button"
              onClick={() => setConfirmDeny(false)}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-transparent px-3 py-2.5 text-white/45 transition-all hover:text-white disabled:opacity-60"
            >
              Retour
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
