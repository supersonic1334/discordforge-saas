import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { MessageSquareText, Star, X } from 'lucide-react'
import { reviewsAPI } from '../../services/api'
import { useAuthStore } from '../../stores'

const INITIAL_DELAY_MS = 15 * 60 * 1000
const REMINDER_INTERVAL_MS = 18 * 60 * 1000
const COMPLETED_KEY_PREFIX = 'discordforge.review.prompt.completed.'
const ELAPSED_KEY_PREFIX = 'discordforge.review.prompt.elapsed.'
const NEXT_PROMPT_KEY_PREFIX = 'discordforge.review.prompt.next.'

function getCompletedKey(userId) {
  return `${COMPLETED_KEY_PREFIX}${userId}`
}

function getElapsedKey(userId) {
  return `${ELAPSED_KEY_PREFIX}${userId}`
}

function getNextPromptKey(userId) {
  return `${NEXT_PROMPT_KEY_PREFIX}${userId}`
}

function readUsageNumber(key, fallback = 0) {
  const parsed = Number(window.localStorage.getItem(key) || fallback)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

export default function ReviewReminderPopup() {
  const user = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const location = useLocation()
  const [visible, setVisible] = useState(false)
  const [completed, setCompleted] = useState(false)
  const requestRef = useRef(0)
  const elapsedUsageRef = useRef(0)
  const nextPromptElapsedRef = useRef(INITIAL_DELAY_MS)
  const lastTickRef = useRef(0)
  const completedRef = useRef(false)
  const visibleRef = useRef(false)
  const userId = user?.id || ''
  const onReviewsPage = location.pathname.startsWith('/dashboard/reviews')
  const onEligibleShell = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/email-fast')
  const completedKey = userId ? getCompletedKey(userId) : ''
  const elapsedKey = userId ? getElapsedKey(userId) : ''
  const nextPromptKey = userId ? getNextPromptKey(userId) : ''

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    completedRef.current = completed
  }, [completed])

  useEffect(() => {
    if (!userId) {
      elapsedUsageRef.current = 0
      nextPromptElapsedRef.current = INITIAL_DELAY_MS
      lastTickRef.current = 0
      completedRef.current = false
      visibleRef.current = false
      setCompleted(false)
      setVisible(false)
      return undefined
    }

    const storedCompleted = window.localStorage.getItem(completedKey) === '1'
    const storedElapsed = readUsageNumber(elapsedKey, 0)
    const storedNextPrompt = readUsageNumber(nextPromptKey, INITIAL_DELAY_MS)

    elapsedUsageRef.current = storedElapsed
    nextPromptElapsedRef.current = Math.max(INITIAL_DELAY_MS, storedNextPrompt || INITIAL_DELAY_MS)
    lastTickRef.current = Date.now()
    completedRef.current = storedCompleted
    visibleRef.current = false
    setCompleted(storedCompleted)
    setVisible(Boolean(
      !storedCompleted
      && onEligibleShell
      && !onReviewsPage
      && storedElapsed >= nextPromptElapsedRef.current
    ))

    if (storedCompleted) {
      return undefined
    }

    let cancelled = false
    const requestId = requestRef.current + 1
    requestRef.current = requestId

    const loadReviewState = async () => {
      try {
        const response = await reviewsAPI.overview()
        if (cancelled || requestRef.current !== requestId) return

        if (response.data?.my_review) {
          window.localStorage.setItem(completedKey, '1')
          completedRef.current = true
          visibleRef.current = false
          setCompleted(true)
          setVisible(false)
        }
      } catch {
        // Keep local usage timer active even if the review endpoint is briefly unavailable.
      }
    }

    loadReviewState()

    return () => {
      cancelled = true
    }
  }, [completedKey, elapsedKey, nextPromptKey, onEligibleShell, onReviewsPage, userId])

  useEffect(() => {
    if (!userId || !onEligibleShell || completed) {
      lastTickRef.current = 0
      setVisible(false)
      return undefined
    }

    const handleReviewSubmitted = (event) => {
      const nextUserId = String(event?.detail?.userId || '')
      if (nextUserId && nextUserId !== String(userId)) return

      window.localStorage.setItem(completedKey, '1')
      window.localStorage.removeItem(nextPromptKey)
      completedRef.current = true
      visibleRef.current = false
      setCompleted(true)
      setVisible(false)
    }

    const handleVisibilityChange = () => {
      lastTickRef.current = Date.now()

      if (window.localStorage.getItem(completedKey) === '1') {
        completedRef.current = true
        visibleRef.current = false
        setCompleted(true)
        setVisible(false)
        return
      }

      if (
        document.visibilityState === 'visible'
        && !completedRef.current
        && !visibleRef.current
        && !onReviewsPage
        && elapsedUsageRef.current >= nextPromptElapsedRef.current
      ) {
        setVisible(true)
      }
    }

    const handleStorage = (event) => {
      if (event.key !== completedKey) return
      if (event.newValue !== '1') return

      completedRef.current = true
      visibleRef.current = false
      setCompleted(true)
      setVisible(false)
    }

    const tickUsage = () => {
      const now = Date.now()
      const previousTick = lastTickRef.current || now
      lastTickRef.current = now

      if (document.visibilityState !== 'visible') return
      if (completedRef.current) return
      if (onReviewsPage) return

      const delta = Math.max(0, now - previousTick)
      if (delta < 250) return

      elapsedUsageRef.current += delta
      window.localStorage.setItem(elapsedKey, String(Math.round(elapsedUsageRef.current)))

      if (!visibleRef.current && elapsedUsageRef.current >= nextPromptElapsedRef.current) {
        setVisible(true)
      }
    }

    lastTickRef.current = Date.now()
    const intervalId = window.setInterval(tickUsage, 1000)
    window.addEventListener('review:submitted', handleReviewSubmitted)
    window.addEventListener('storage', handleStorage)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('review:submitted', handleReviewSubmitted)
      window.removeEventListener('storage', handleStorage)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [completed, completedKey, elapsedKey, nextPromptKey, onEligibleShell, onReviewsPage, userId])

  useEffect(() => {
    if (onReviewsPage) {
      setVisible(false)
    }
  }, [onReviewsPage])

  const deferNextReminder = () => {
    if (!userId) return

    nextPromptElapsedRef.current = elapsedUsageRef.current + REMINDER_INTERVAL_MS
    window.localStorage.setItem(elapsedKey, String(Math.round(elapsedUsageRef.current)))
    window.localStorage.setItem(nextPromptKey, String(Math.round(nextPromptElapsedRef.current)))
    visibleRef.current = false
    setVisible(false)
  }

  const dismissReminder = () => {
    deferNextReminder()
  }

  const openReviews = () => {
    deferNextReminder()
    navigate('/dashboard/reviews')
  }

  if (!userId || completed || onReviewsPage || !onEligibleShell) return null

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
