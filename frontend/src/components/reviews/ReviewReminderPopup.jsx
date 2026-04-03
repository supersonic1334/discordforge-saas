import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageSquareText, Star, X } from 'lucide-react'
import { reviewsAPI } from '../../services/api'
import { useAuthStore } from '../../stores'

const REMINDER_INTERVAL_MS = 18 * 60 * 1000
const DISMISS_KEY_PREFIX = 'discordforge.review.prompt.dismissed.'
const COMPLETED_KEY_PREFIX = 'discordforge.review.prompt.completed.'

function getDismissKey(userId) {
  return `${DISMISS_KEY_PREFIX}${userId}`
}

function getCompletedKey(userId) {
  return `${COMPLETED_KEY_PREFIX}${userId}`
}

export default function ReviewReminderPopup() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const location = useLocation()
  const [visible, setVisible] = useState(false)
  const [completed, setCompleted] = useState(false)
  const timerRef = useRef(null)
  const requestRef = useRef(0)
  const userId = user?.id || ''
  const onReviewsPage = location.pathname.startsWith('/dashboard/reviews')
  const onAuthShell = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/email-fast')
  const dismissKey = useMemo(() => userId ? getDismissKey(userId) : '', [userId])
  const completedKey = useMemo(() => userId ? getCompletedKey(userId) : '', [userId])

  const clearReminderTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const scheduleReminder = (delayMs = REMINDER_INTERVAL_MS) => {
    clearReminderTimer()
    if (!userId || completed || onReviewsPage || !onAuthShell) return
    timerRef.current = window.setTimeout(() => {
      setVisible(true)
    }, Math.max(0, Number(delayMs) || 0))
  }

  useEffect(() => {
    if (!userId || !onAuthShell) {
      clearReminderTimer()
      setVisible(false)
      setCompleted(false)
      return undefined
    }

    const completedAlready = window.localStorage.getItem(completedKey) === '1'
    if (completedAlready) {
      clearReminderTimer()
      setVisible(false)
      setCompleted(true)
      return undefined
    }

    let cancelled = false
    const loadReviewState = async () => {
      const requestId = requestRef.current + 1
      requestRef.current = requestId

      try {
        const response = await reviewsAPI.overview()
        if (cancelled || requestRef.current !== requestId) return

        const hasReview = !!response.data?.my_review
        if (hasReview) {
          window.localStorage.setItem(completedKey, '1')
          window.localStorage.removeItem(dismissKey)
          clearReminderTimer()
          setCompleted(true)
          setVisible(false)
          return
        }

        setCompleted(false)
        setVisible(false)
        const dismissedAt = Number(window.localStorage.getItem(dismissKey) || 0)
        const remainingDelay = dismissedAt
          ? REMINDER_INTERVAL_MS - (Date.now() - dismissedAt)
          : 0

        scheduleReminder(Math.max(0, remainingDelay))
      } catch {
        setCompleted(false)
        setVisible(false)
        scheduleReminder(90 * 1000)
      }
    }

    const handleReviewSubmitted = (event) => {
      const nextUserId = String(event?.detail?.userId || '')
      if (nextUserId && nextUserId !== String(userId)) return
      window.localStorage.setItem(completedKey, '1')
      window.localStorage.removeItem(dismissKey)
      clearReminderTimer()
      setCompleted(true)
      setVisible(false)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadReviewState()
      }
    }

    loadReviewState()
    window.addEventListener('review:submitted', handleReviewSubmitted)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      clearReminderTimer()
      window.removeEventListener('review:submitted', handleReviewSubmitted)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [completedKey, dismissKey, onAuthShell, userId, onReviewsPage])

  useEffect(() => {
    if (onReviewsPage) {
      setVisible(false)
    }
  }, [onReviewsPage])

  const dismissReminder = () => {
    if (!userId) return
    window.localStorage.setItem(dismissKey, String(Date.now()))
    setVisible(false)
    scheduleReminder(REMINDER_INTERVAL_MS)
  }

  const openReviews = () => {
    if (!userId) return
    window.localStorage.setItem(dismissKey, String(Date.now()))
    setVisible(false)
    navigate('/dashboard/reviews')
    scheduleReminder(REMINDER_INTERVAL_MS)
  }

  if (!userId || completed || onReviewsPage || !onAuthShell) return null

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.96 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="fixed bottom-5 right-5 z-[90] w-[min(92vw,380px)]"
        >
          <div className="relative overflow-hidden rounded-[28px] border border-amber-400/16 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.16),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(0,229,255,0.12),transparent_36%),linear-gradient(180deg,rgba(12,16,28,0.96),rgba(8,11,20,0.98))] p-5 shadow-[0_24px_90px_rgba(0,0,0,0.42)]">
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(250,204,21,0.08),transparent)] opacity-80" />

            <div className="relative z-[1] flex items-start gap-3">
              <div className="mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-300/20 bg-amber-400/12 text-amber-200 shadow-[0_0_24px_rgba(250,204,21,0.16)]">
                <Star className="h-5 w-5 fill-amber-300/35" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-amber-200/75">Avis</p>
                    <h3 className="mt-2 font-display text-xl font-700 text-white">Laisse ton avis</h3>
                  </div>

                  <button
                    type="button"
                    onClick={dismissReminder}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-white/50 transition-all hover:bg-white/[0.08] hover:text-white"
                    aria-label="Fermer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <p className="mt-3 text-sm leading-6 text-white/68">
                  Veuillez laisser un avis sur le site. Un retour rapide aide les prochains clients a faire confiance.
                </p>

                <button
                  type="button"
                  onClick={openReviews}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-amber-300/18 bg-gradient-to-r from-amber-500/16 via-yellow-400/12 to-amber-500/16 px-4 py-3 text-sm font-display font-700 text-amber-100 transition-all hover:border-amber-200/28 hover:shadow-[0_0_30px_rgba(250,204,21,0.18)]"
                >
                  <MessageSquareText className="h-4 w-4" />
                  Appuie ici pour laisser ton avis
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
