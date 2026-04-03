import { useEffect, useId, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { motion } from 'framer-motion'
import {
  CheckCircle2,
  Lock,
  MessageSquareText,
  PenSquare,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
} from 'lucide-react'
import { reviewsAPI } from '../services/api'
import { useI18n } from '../i18n'
import { useAuthStore } from '../stores'

const STAR_POINTS = '12,2.25 15.03,8.42 21.84,9.41 16.92,14.2 18.08,21 12,17.8 5.92,21 7.08,14.2 2.16,9.41 8.97,8.42'

const TEXT = {
  fr: {
    badge: 'Retour clients',
    title: 'Les avis qui font monter la confiance.',
    subtitle: 'Une note unique par compte, un message modifiable a tout moment, et une vitrine plus propre pour donner envie aux prochains clients.',
    average: 'Note globale',
    total: 'Avis publies',
    oneVote: 'Une note par compte',
    oneVoteBody: 'La note reste fixe pour garder une moyenne fiable.',
    editableMessage: 'Message modifiable',
    editableMessageBody: 'Tu peux retoucher ton texte quand tu veux.',
    trustTitle: 'Vue d ensemble',
    trustBody: 'Un rendu plus clair pour voir la tendance generale en un coup d oeil.',
    distribution: 'Repartition',
    yourSpace: 'Ton espace avis',
    createTitle: 'Laisser ton avis',
    editTitle: 'Modifier ton message',
    createHint: 'Choisis ta note, ecris ton ressenti, puis publie.',
    editHint: 'Ta note reste bloquee. Seul ton message reste modifiable.',
    noteLabel: 'Note',
    noteLocked: 'Note verrouillee',
    lockedRating: 'Ta note est deja enregistree et ne peut plus changer.',
    messageLabel: 'Ton message',
    messagePlaceholder: 'Explique ce que tu aimes, ce qui te sert le plus, ou pourquoi le site t aide vraiment.',
    submit: 'Publier mon avis',
    save: 'Sauvegarder mon message',
    saving: 'Sauvegarde...',
    created: 'Avis enregistre',
    updated: 'Message mis a jour',
    yourReview: 'Ton avis',
    communityTitle: 'Avis de la communaute',
    communityBody: 'Les derniers retours visibles par les futurs clients.',
    noReviews: 'Aucun avis pour le moment.',
    noReviewsBody: 'Le mur d avis s affichera ici des qu un premier retour sera publie.',
    from: 'le',
    outOfFive: '/ 5',
  },
  en: {
    badge: 'Customer feedback',
    title: 'Reviews that build trust instantly.',
    subtitle: 'One rating per account, an editable message anytime, and a cleaner showcase that feels more premium to future clients.',
    average: 'Overall score',
    total: 'Published reviews',
    oneVote: 'One rating per account',
    oneVoteBody: 'The score stays fixed so the average remains reliable.',
    editableMessage: 'Editable message',
    editableMessageBody: 'You can update your text whenever you want.',
    trustTitle: 'Quick overview',
    trustBody: 'A clearer view so the overall trend is visible at a glance.',
    distribution: 'Breakdown',
    yourSpace: 'Your review space',
    createTitle: 'Leave your review',
    editTitle: 'Edit your message',
    createHint: 'Pick your rating, write your feedback, then publish.',
    editHint: 'Your rating stays locked. Only the message can change.',
    noteLabel: 'Rating',
    noteLocked: 'Rating locked',
    lockedRating: 'Your rating is already saved and can no longer change.',
    messageLabel: 'Your message',
    messagePlaceholder: 'Explain what you like, what helps most, or why the site is genuinely useful.',
    submit: 'Publish my review',
    save: 'Save my message',
    saving: 'Saving...',
    created: 'Review saved',
    updated: 'Message updated',
    yourReview: 'Your review',
    communityTitle: 'Community reviews',
    communityBody: 'The latest public feedback future clients will see.',
    noReviews: 'No reviews yet.',
    noReviewsBody: 'The review wall will appear here as soon as the first feedback is published.',
    from: 'on',
    outOfFive: '/ 5',
  },
  es: {
    badge: 'Comentarios de clientes',
    title: 'Resenas que inspiran confianza al instante.',
    subtitle: 'Una sola nota por cuenta, mensaje editable en cualquier momento y una presentacion mas premium para futuros clientes.',
    average: 'Nota global',
    total: 'Resenas publicadas',
    oneVote: 'Una nota por cuenta',
    oneVoteBody: 'La nota se mantiene fija para conservar una media fiable.',
    editableMessage: 'Mensaje editable',
    editableMessageBody: 'Puedes cambiar el texto cuando quieras.',
    trustTitle: 'Vista general',
    trustBody: 'Una vista mas clara para entender la tendencia de inmediato.',
    distribution: 'Distribucion',
    yourSpace: 'Tu espacio de resena',
    createTitle: 'Dejar tu resena',
    editTitle: 'Modificar tu mensaje',
    createHint: 'Elige tu nota, escribe tu opinion y publicala.',
    editHint: 'La nota queda bloqueada. Solo puedes cambiar el mensaje.',
    noteLabel: 'Nota',
    noteLocked: 'Nota bloqueada',
    lockedRating: 'Tu nota ya esta guardada y ya no puede cambiar.',
    messageLabel: 'Tu mensaje',
    messagePlaceholder: 'Explica lo que te gusta, lo que mas te ayuda o por que el sitio te resulta realmente util.',
    submit: 'Publicar mi resena',
    save: 'Guardar mi mensaje',
    saving: 'Guardando...',
    created: 'Resena guardada',
    updated: 'Mensaje actualizado',
    yourReview: 'Tu resena',
    communityTitle: 'Resenas de la comunidad',
    communityBody: 'Los ultimos comentarios visibles para futuros clientes.',
    noReviews: 'Todavia no hay resenas.',
    noReviewsBody: 'El muro de resenas aparecera aqui en cuanto se publique la primera opinion.',
    from: 'el',
    outOfFive: '/ 5',
  },
}

function getText(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return TEXT[key] || TEXT.fr
}

function formatDate(locale, value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleDateString(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return value
  }
}

function formatRating(locale, ratingHalf) {
  return (Number(ratingHalf || 0) / 2).toLocaleString(locale, {
    minimumFractionDigits: Number(ratingHalf || 0) % 2 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  })
}

function Avatar({ review }) {
  const avatarUrl = review?.display_avatar_url || review?.avatar_url
  const displayName = review?.display_name || review?.username

  if (avatarUrl) {
    return <img src={avatarUrl} alt={displayName} className="h-12 w-12 rounded-2xl border border-white/10 object-cover shadow-[0_0_18px_rgba(250,204,21,0.12)]" />
  }

  return (
    <div className="h-12 w-12 rounded-2xl border border-white/10 bg-gradient-to-br from-amber-500/20 to-yellow-400/15 flex items-center justify-center text-sm font-display font-700 text-white">
      {String(displayName || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

function StarShape({ filled = false, className = '', glow = false, glowStrength = 1 }) {
  const svgId = useId().replace(/:/g, '')
  const baseGradientId = `star-base-${svgId}`
  const fillGradientId = `star-fill-${svgId}`
  const shineGradientId = `star-shine-${svgId}`
  const shadowId = `star-shadow-${svgId}`

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={baseGradientId} x1="12" y1="2.25" x2="12" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#30303a" />
          <stop offset="58%" stopColor="#212129" />
          <stop offset="100%" stopColor="#15151c" />
        </linearGradient>
        <linearGradient id={fillGradientId} x1="12" y1="2.25" x2="12" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff7c2" />
          <stop offset="28%" stopColor="#fde68a" />
          <stop offset="62%" stopColor="#fbbf24" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <linearGradient id={shineGradientId} x1="12" y1="2.25" x2="12" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="rgba(255,255,255,0.88)" />
          <stop offset="45%" stopColor="rgba(255,255,255,0.22)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
        <filter id={shadowId} x="-90%" y="-90%" width="280%" height="280%">
          <feDropShadow
            dx="0"
            dy={filled ? 1.1 : 0.6}
            stdDeviation={filled ? 0.85 + (glow ? glowStrength * 0.7 : 0) : 0.55}
            floodColor={filled ? '#fbbf24' : '#000000'}
            floodOpacity={filled ? (glow ? 0.34 + (glowStrength * 0.12) : 0.18) : 0.26}
          />
          <feDropShadow
            dx="0"
            dy={filled ? 0 : 0.3}
            stdDeviation={filled ? (glow ? 1.2 + (glowStrength * 0.5) : 0.45) : 0.4}
            floodColor={filled ? '#fff1a8' : '#ffffff'}
            floodOpacity={filled ? (glow ? 0.18 : 0.08) : 0.04}
          />
        </filter>
      </defs>

      <g filter={`url(#${shadowId})`}>
        <polygon
          points={STAR_POINTS}
          fill={filled ? `url(#${fillGradientId})` : `url(#${baseGradientId})`}
          stroke={filled ? '#ffe8a3' : 'rgba(255,255,255,0.16)'}
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        <polygon
          points={STAR_POINTS}
          fill={`url(#${shineGradientId})`}
          opacity={filled ? 0.72 : 0.12}
          stroke="none"
        />
      </g>
    </svg>
  )
}

function StarGlyph({ fill = 0, className = 'h-6 w-6', glow = false, glowStrength = 1 }) {
  const clipRight = `${Math.max(0, Math.min(100, 100 - (fill * 100)))}%`

  return (
    <div className={`relative ${className}`}>
      <StarShape className="absolute inset-0 h-full w-full" />
      <div
        className="absolute inset-0"
        style={{
          clipPath: `inset(0 ${clipRight} 0 0)`,
          WebkitClipPath: `inset(0 ${clipRight} 0 0)`,
        }}
      >
        <StarShape filled glow={glow} glowStrength={glowStrength} className="h-full w-full" />
      </div>
    </div>
  )
}

function RatingDisplay({ ratingHalf, size = 'h-5 w-5' }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: 5 }, (_, index) => {
        const starNumber = index + 1
        const fill = ratingHalf >= starNumber * 2 ? 1 : ratingHalf === starNumber * 2 - 1 ? 0.5 : 0
        return (
          <motion.div
            key={starNumber}
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: fill > 0 ? 1.02 : 1,
            }}
            transition={{
              delay: starNumber * 0.035,
              duration: 0.24,
              ease: 'easeOut',
            }}
          >
            <StarGlyph fill={fill} glow={fill > 0} glowStrength={0.8} className={size} />
          </motion.div>
        )
      })}
    </div>
  )
}

function RatingInput({ valueHalf, onChange, disabled = false }) {
  const [hoverHalf, setHoverHalf] = useState(null)
  const renderValue = hoverHalf ?? valueHalf

  return (
    <div
      className={`flex items-center gap-1.5 ${disabled ? 'opacity-70' : ''}`}
      onMouseLeave={() => setHoverHalf(null)}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const starNumber = index + 1
        const leftValue = starNumber * 2 - 1
        const rightValue = starNumber * 2
        const fill = renderValue >= rightValue ? 1 : renderValue === leftValue ? 0.5 : 0
        const highlighted = hoverHalf !== null && renderValue >= leftValue

        return (
          <div key={starNumber} className="relative h-11 w-11 shrink-0">
            {!disabled && (
              <>
                <button
                  type="button"
                  className="absolute inset-y-0 left-0 z-10 w-1/2 rounded-l-xl"
                  onMouseEnter={() => setHoverHalf(leftValue)}
                  onFocus={() => setHoverHalf(leftValue)}
                  onClick={() => onChange(leftValue)}
                  aria-label={`${leftValue / 2} / 5`}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 z-10 w-1/2 rounded-r-xl"
                  onMouseEnter={() => setHoverHalf(rightValue)}
                  onFocus={() => setHoverHalf(rightValue)}
                  onClick={() => onChange(rightValue)}
                  aria-label={`${rightValue / 2} / 5`}
                />
              </>
            )}
            <motion.div
              animate={{
                scale: highlighted ? 1.12 : fill > 0 ? 1.03 : 1,
                y: highlighted ? -3 : 0,
                rotate: highlighted ? (index % 2 === 0 ? -4 : 4) : 0,
              }}
              transition={{
                type: 'spring',
                stiffness: 380,
                damping: 24,
                mass: 0.5,
              }}
              className="relative"
            >
              <StarGlyph
                fill={fill}
                glow={fill > 0 || highlighted}
                glowStrength={highlighted ? 1.45 : 0.9}
                className="relative h-11 w-11"
              />
            </motion.div>
          </div>
        )
      })}
    </div>
  )
}

function OverviewCard({ label, value, body, icon: Icon, accent = 'amber' }) {
  const accentClasses = {
    amber: 'from-amber-500/18 to-yellow-400/8 border-amber-400/15 text-amber-200',
    cyan: 'from-cyan-500/16 to-cyan-400/6 border-cyan-400/15 text-cyan-200',
    violet: 'from-violet-500/16 to-violet-400/6 border-violet-400/15 text-violet-200',
  }

  return (
    <div className={`rounded-3xl border bg-gradient-to-br ${accentClasses[accent] || accentClasses.amber} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/40">{label}</p>
          <p className="mt-3 font-display text-2xl font-800 text-white">{value}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-2.5">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-white/55">{body}</p>
    </div>
  )
}

export default function ReviewsPage() {
  const { locale } = useI18n()
  const currentUser = useAuthStore((state) => state.user)
  const text = useMemo(() => getText(locale), [locale])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [overview, setOverview] = useState({ stats: { average_rating: 0, total_reviews: 0 }, reviews: [], my_review: null })
  const [ratingHalf, setRatingHalf] = useState(10)
  const [message, setMessage] = useState('')
  const [draftDirty, setDraftDirty] = useState(false)

  const loadOverview = async ({ silent = false, hydrateDraft = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const res = await reviewsAPI.overview()
      const nextOverview = res.data || { stats: { average_rating: 0, total_reviews: 0 }, reviews: [], my_review: null }
      setOverview(nextOverview)
      if (nextOverview.my_review && (hydrateDraft || !draftDirty)) {
        setRatingHalf(nextOverview.my_review.rating_half)
        setMessage(nextOverview.my_review.message || '')
        setDraftDirty(false)
      }
    } catch (error) {
      if (silent) return
      toast.error(error?.response?.data?.error || error?.message || 'Unexpected error')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadOverview({ hydrateDraft: true })
  }, [])

  useEffect(() => {
    if (!currentUser?.id || !overview.my_review) return
    window.localStorage.setItem(`discordforge.review.prompt.completed.${currentUser.id}`, '1')
  }, [currentUser?.id, overview.my_review])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadOverview({ silent: true, hydrateDraft: false })
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [draftDirty])

  const handleCreate = async () => {
    if (!message.trim()) return
    setSaving(true)
    try {
      await reviewsAPI.create({
        rating_half: ratingHalf,
        message: message.trim(),
      })
      if (currentUser?.id) {
        window.localStorage.setItem(`discordforge.review.prompt.completed.${currentUser.id}`, '1')
        window.dispatchEvent(new CustomEvent('review:submitted', {
          detail: { userId: currentUser.id },
        }))
      }
      toast.success(text.created)
      await loadOverview({ hydrateDraft: true })
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Unexpected error')
    }
    setSaving(false)
  }

  const handleUpdate = async () => {
    if (!message.trim()) return
    setSaving(true)
    try {
      await reviewsAPI.updateMine({
        message: message.trim(),
      })
      toast.success(text.updated)
      await loadOverview({ hydrateDraft: true })
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Unexpected error')
    }
    setSaving(false)
  }

  const myReview = overview.my_review
  const displayAverage = Number(overview.stats?.average_rating || 0)
  const displayAverageHalf = Math.round(displayAverage * 2)
  const totalReviews = Number(overview.stats?.total_reviews || 0)
  const distribution = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    overview.reviews.forEach((review) => {
      const bucket = Math.max(1, Math.min(5, Math.round(Number(review.rating_half || 0) / 2)))
      counts[bucket] += 1
    })

    return [5, 4, 3, 2, 1].map((stars) => ({
      stars,
      count: counts[stars],
      ratio: totalReviews > 0 ? counts[stars] / totalReviews : 0,
    }))
  }, [overview.reviews, totalReviews])

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-6">
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="grid xl:grid-cols-[minmax(0,1.15fr)_380px] gap-6"
      >
        <div className="relative overflow-hidden rounded-[2rem] border border-amber-400/14 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.18),transparent_34%),radial-gradient(circle_at_right,rgba(139,92,246,0.14),transparent_36%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))] p-7">
          <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(250,204,21,0.06),transparent)] opacity-70" />
          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-amber-200">
              <Sparkles className="h-3.5 w-3.5" />
              {text.badge}
            </div>

            <div className="mt-5 max-w-3xl">
              <h1 className="font-display text-4xl leading-[0.92] font-800 text-white sm:text-5xl">
                {text.title}
              </h1>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/60">
                {text.subtitle}
              </p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              <OverviewCard
                label={text.average}
                value={`${displayAverage.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${text.outOfFive}`}
                body={text.trustBody}
                icon={ShieldCheck}
                accent="amber"
              />
              <OverviewCard
                label={text.total}
                value={totalReviews}
                body={text.communityBody}
                icon={Users}
                accent="cyan"
              />
              <OverviewCard
                label={text.oneVote}
                value={myReview ? text.noteLocked : formatRating(locale, ratingHalf)}
                body={myReview ? text.editableMessageBody : text.oneVoteBody}
                icon={PenSquare}
                accent="violet"
              />
            </div>
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut', delay: 0.05 }}
          className="glass-card p-6 space-y-5"
        >
          <div>
            <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-amber-300/80">{text.trustTitle}</p>
            <h2 className="mt-2 font-display text-2xl font-700 text-white">{text.average}</h2>
          </div>

          <div className="rounded-[1.75rem] border border-amber-400/14 bg-gradient-to-br from-amber-500/12 via-white/[0.02] to-transparent p-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="font-display text-5xl font-800 text-white">
                  {displayAverage.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </p>
                <p className="mt-2 text-sm text-white/45">{text.communityBody}</p>
              </div>
              <div className="rounded-2xl border border-amber-400/18 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                {totalReviews} {text.total.toLowerCase()}
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <RatingDisplay ratingHalf={displayAverageHalf} size="h-7 w-7" />
              <span className="text-sm text-white/60">{text.outOfFive}</span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-white">{text.distribution}</p>
              <p className="text-xs font-mono text-white/35">{totalReviews} total</p>
            </div>

            {distribution.map((item) => (
              <div key={item.stars} className="flex items-center gap-3">
                <div className="flex w-12 items-center gap-1 text-sm text-white/65">
                  <span>{item.stars}</span>
                  <Star className="h-3.5 w-3.5 text-amber-300 fill-amber-300/50" />
                </div>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 transition-all duration-500"
                    style={{ width: `${Math.max(6, item.ratio * 100)}%`, opacity: item.count > 0 ? 1 : 0.18 }}
                  />
                </div>
                <div className="w-10 text-right text-xs text-white/35">{item.count}</div>
              </div>
            ))}
          </div>
        </motion.div>
      </motion.section>

      <div className="grid xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
        <motion.aside
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut', delay: 0.08 }}
          className="xl:sticky xl:top-6 self-start"
        >
          <div className="glass-card p-5 space-y-5 border-amber-400/10">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/18 bg-amber-400/8 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-amber-200">
                  <Star className="h-3.5 w-3.5 fill-amber-300/50 text-amber-300" />
                  {text.yourSpace}
                </div>
                <h2 className="mt-3 font-display text-2xl font-700 text-white">{myReview ? text.editTitle : text.createTitle}</h2>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{myReview ? text.editHint : text.createHint}</p>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-white/8 bg-white/[0.03] p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/35">{text.noteLabel}</span>
                <span className="text-sm font-medium text-white/70">{formatRating(locale, myReview?.rating_half || ratingHalf)} {text.outOfFive}</span>
              </div>

              <div className="mt-4">
                <RatingInput valueHalf={myReview?.rating_half || ratingHalf} onChange={setRatingHalf} disabled={!!myReview} />
              </div>

              {myReview && (
                <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-amber-400/16 bg-amber-400/8 px-3 py-1 text-xs text-amber-200">
                  <Lock className="h-3.5 w-3.5" />
                  {text.lockedRating}
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-[11px] font-mono uppercase tracking-[0.16em] text-white/35">{text.messageLabel}</label>
              <textarea
                className="input-field min-h-[190px] resize-none"
                value={message}
                onChange={(event) => {
                  setMessage(event.target.value)
                  setDraftDirty(true)
                }}
                placeholder={text.messagePlaceholder}
                maxLength={1500}
              />
            </div>

            <button
              type="button"
              onClick={myReview ? handleUpdate : handleCreate}
              disabled={saving || !message.trim()}
              className="w-full rounded-2xl border border-amber-400/18 bg-gradient-to-r from-amber-500/14 via-yellow-400/12 to-amber-500/14 px-4 py-3 font-display text-base font-700 text-amber-100 transition-all duration-200 hover:border-amber-300/25 hover:shadow-[0_0_28px_rgba(250,204,21,0.15)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving ? text.saving : (myReview ? text.save : text.submit)}
            </button>
          </div>
        </motion.aside>

        <div className="space-y-4">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: 'easeOut', delay: 0.12 }}
            className="flex items-center justify-between gap-4 flex-wrap"
          >
            <div>
              <div className="flex items-center gap-2">
                <MessageSquareText className="h-5 w-5 text-amber-300" />
                <h2 className="font-display text-2xl font-700 text-white">{text.communityTitle}</h2>
              </div>
              <p className="mt-2 text-sm text-white/45">{text.communityBody}</p>
            </div>
          </motion.div>

          {loading ? (
            <div className="grid gap-4">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="glass-card p-5 skeleton h-40" />
              ))}
            </div>
          ) : overview.reviews.length < 1 ? (
            <div className="glass-card p-8 text-center">
              <p className="font-display text-xl text-white">{text.noReviews}</p>
              <p className="text-white/45 mt-2">{text.noReviewsBody}</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {overview.reviews.map((review, index) => (
                <motion.article
                  key={review.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25, ease: 'easeOut', delay: Math.min(index * 0.04, 0.18) }}
                  className="group relative overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] p-5 shadow-[0_18px_50px_rgba(0,0,0,0.18)] transition-all duration-200 hover:border-amber-400/12 hover:shadow-[0_24px_70px_rgba(0,0,0,0.26)]"
                >
                  <div className="absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 bg-[radial-gradient(circle_at_top_left,rgba(250,204,21,0.12),transparent_28%)]" />
                  <div className="relative z-10 flex items-start gap-4">
                    <Avatar review={review} />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-display text-lg font-700 text-white">{review.display_name || review.username}</p>
                            {review.is_mine && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/18 bg-amber-400/10 px-2.5 py-1 text-[11px] font-mono text-amber-200">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {text.yourReview}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-white/38">
                            {review.display_handle ? <span>{review.display_handle}</span> : null}
                            {review.discord_id ? <span>ID {review.discord_id}</span> : null}
                            <span className="uppercase tracking-[0.16em]">{review.identity_source === 'discord' ? 'Discord' : 'Site'}</span>
                          </div>

                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <RatingDisplay ratingHalf={review.rating_half} />
                            <span className="text-sm font-medium text-white/70">{formatRating(locale, review.rating_half)} {text.outOfFive}</span>
                            <span className="text-xs text-white/35">{text.from} {formatDate(locale, review.created_at)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-[1.35rem] border border-white/[0.06] bg-black/10 px-4 py-3">
                        <p className="text-sm leading-relaxed text-white/78 whitespace-pre-wrap">{review.message}</p>
                      </div>
                    </div>
                  </div>
                </motion.article>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
