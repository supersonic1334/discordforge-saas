import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { CheckCircle2, Lock, MessageSquareText, Sparkles, Star } from 'lucide-react'
import { reviewsAPI } from '../services/api'
import { useI18n } from '../i18n'

const TEXT = {
  fr: {
    title: 'Avis clients',
    subtitle: 'Une note par compte. Ta note reste fixe, mais tu peux modifier ton message quand tu veux.',
    average: 'Moyenne',
    total: 'Avis',
    yourReview: 'Ton avis',
    noReviews: 'Aucun avis pour le moment.',
    noReviewsBody: 'Sois le premier a laisser une note et un message.',
    createTitle: 'Laisser un avis',
    editTitle: 'Modifier ton message',
    lockedRating: 'Ta note est deja enregistree et verrouillee.',
    messageLabel: 'Message',
    messagePlaceholder: 'Explique ce que tu aimes sur le site, ce qui t aide, ou ton ressenti global.',
    submit: 'Publier mon avis',
    save: 'Sauvegarder le message',
    saving: 'Sauvegarde...',
    created: 'Avis enregistre',
    updated: 'Message mis a jour',
    createHint: 'Choisis une note de 0,5 a 5 etoiles, puis ecris ton message.',
    editHint: 'Tu peux modifier seulement le message. La note reste la meme.',
    noteLabel: 'Note',
    noteLocked: 'Note verrouillee',
    listTitle: 'Tous les avis',
    from: 'depuis',
    starsSuffix: 'etoiles',
    authOnly: 'Connecte-toi pour laisser ton avis.',
  },
  en: {
    title: 'Customer reviews',
    subtitle: 'One rating per account. Your rating stays fixed, but you can edit your message anytime.',
    average: 'Average',
    total: 'Reviews',
    yourReview: 'Your review',
    noReviews: 'No reviews yet.',
    noReviewsBody: 'Be the first to leave a rating and a message.',
    createTitle: 'Leave a review',
    editTitle: 'Edit your message',
    lockedRating: 'Your rating is already saved and locked.',
    messageLabel: 'Message',
    messagePlaceholder: 'Explain what you like about the site, what helps you, or your overall feeling.',
    submit: 'Publish my review',
    save: 'Save message',
    saving: 'Saving...',
    created: 'Review saved',
    updated: 'Message updated',
    createHint: 'Pick a rating from 0.5 to 5 stars, then write your message.',
    editHint: 'You can edit only the message. The rating stays the same.',
    noteLabel: 'Rating',
    noteLocked: 'Rating locked',
    listTitle: 'All reviews',
    from: 'since',
    starsSuffix: 'stars',
    authOnly: 'Sign in to leave your review.',
  },
  es: {
    title: 'Resenas de clientes',
    subtitle: 'Una nota por cuenta. La nota queda fija, pero puedes modificar el mensaje cuando quieras.',
    average: 'Media',
    total: 'Resenas',
    yourReview: 'Tu resena',
    noReviews: 'Todavia no hay resenas.',
    noReviewsBody: 'Se la primera persona en dejar una nota y un mensaje.',
    createTitle: 'Dejar una resena',
    editTitle: 'Modificar tu mensaje',
    lockedRating: 'Tu nota ya esta guardada y bloqueada.',
    messageLabel: 'Mensaje',
    messagePlaceholder: 'Explica lo que te gusta del sitio, lo que te ayuda o tu impresion general.',
    submit: 'Publicar mi resena',
    save: 'Guardar mensaje',
    saving: 'Guardando...',
    created: 'Resena guardada',
    updated: 'Mensaje actualizado',
    createHint: 'Elige una nota de 0,5 a 5 estrellas y luego escribe tu mensaje.',
    editHint: 'Solo puedes modificar el mensaje. La nota se mantiene igual.',
    noteLabel: 'Nota',
    noteLocked: 'Nota bloqueada',
    listTitle: 'Todas las resenas',
    from: 'desde',
    starsSuffix: 'estrellas',
    authOnly: 'Inicia sesion para dejar tu resena.',
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
  if (review?.avatar_url) {
    return <img src={review.avatar_url} alt={review.username} className="h-12 w-12 rounded-2xl border border-white/10 object-cover" />
  }

  return (
    <div className="h-12 w-12 rounded-2xl border border-white/10 bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center text-sm font-display font-700 text-white">
      {String(review?.username || '?').slice(0, 2).toUpperCase()}
    </div>
  )
}

function StarGlyph({ fill = 0, className = 'h-6 w-6' }) {
  return (
    <div className={`relative ${className}`}>
      <Star className="absolute inset-0 h-full w-full text-white/10" />
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${Math.max(0, Math.min(100, fill * 100))}%` }}>
        <Star className="h-full w-full fill-amber-400 text-amber-400" />
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
        return <StarGlyph key={starNumber} fill={fill} className={size} />
      })}
    </div>
  )
}

function RatingInput({ valueHalf, onChange, disabled = false }) {
  const [hoverHalf, setHoverHalf] = useState(null)
  const renderValue = hoverHalf ?? valueHalf

  return (
    <div
      className={`flex items-center gap-1 ${disabled ? 'opacity-70' : ''}`}
      onMouseLeave={() => setHoverHalf(null)}
    >
      {Array.from({ length: 5 }, (_, index) => {
        const starNumber = index + 1
        const leftValue = starNumber * 2 - 1
        const rightValue = starNumber * 2
        const fill = renderValue >= rightValue ? 1 : renderValue === leftValue ? 0.5 : 0

        return (
          <div key={starNumber} className="relative h-9 w-9">
            {!disabled && (
              <>
                <button
                  type="button"
                  className="absolute inset-y-0 left-0 z-10 w-1/2"
                  onMouseEnter={() => setHoverHalf(leftValue)}
                  onFocus={() => setHoverHalf(leftValue)}
                  onClick={() => onChange(leftValue)}
                  aria-label={`${leftValue / 2} / 5`}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 z-10 w-1/2"
                  onMouseEnter={() => setHoverHalf(rightValue)}
                  onFocus={() => setHoverHalf(rightValue)}
                  onClick={() => onChange(rightValue)}
                  aria-label={`${rightValue / 2} / 5`}
                />
              </>
            )}
            <StarGlyph fill={fill} className="h-9 w-9" />
          </div>
        )
      })}
    </div>
  )
}

export default function ReviewsPage() {
  const { locale } = useI18n()
  const text = useMemo(() => getText(locale), [locale])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [overview, setOverview] = useState({ stats: { average_rating: 0, total_reviews: 0 }, reviews: [], my_review: null })
  const [ratingHalf, setRatingHalf] = useState(9)
  const [message, setMessage] = useState('')

  const loadOverview = async () => {
    setLoading(true)
    try {
      const res = await reviewsAPI.overview()
      const nextOverview = res.data || { stats: { average_rating: 0, total_reviews: 0 }, reviews: [], my_review: null }
      setOverview(nextOverview)
      if (nextOverview.my_review) {
        setRatingHalf(nextOverview.my_review.rating_half)
        setMessage(nextOverview.my_review.message || '')
      }
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Unexpected error')
    }
    setLoading(false)
  }

  useEffect(() => {
    loadOverview()
  }, [])

  const handleCreate = async () => {
    if (!message.trim()) return
    setSaving(true)
    try {
      await reviewsAPI.create({
        rating_half: ratingHalf,
        message: message.trim(),
      })
      toast.success(text.created)
      await loadOverview()
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
      await loadOverview()
    } catch (error) {
      toast.error(error?.response?.data?.error || error?.message || 'Unexpected error')
    }
    setSaving(false)
  }

  const myReview = overview.my_review

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-[11px] font-mono text-amber-300 mb-3">
            <Sparkles className="h-3.5 w-3.5" />
            {text.yourReview}
          </div>
          <h1 className="font-display text-3xl font-800 text-white">{text.title}</h1>
          <p className="text-white/45 mt-2 max-w-2xl">{text.subtitle}</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass-card p-5">
          <p className="text-xs font-mono text-white/35 mb-3">{text.average}</p>
          <div className="flex items-center gap-3">
            <p className="font-display text-3xl font-800 text-white">
              {Number(overview.stats?.average_rating || 0).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </p>
            <RatingDisplay ratingHalf={Math.round(Number(overview.stats?.average_rating || 0) * 2)} />
          </div>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs font-mono text-white/35 mb-3">{text.total}</p>
          <p className="font-display text-3xl font-800 text-white">{overview.stats?.total_reviews || 0}</p>
        </div>
        <div className="glass-card p-5">
          <p className="text-xs font-mono text-white/35 mb-3">{text.noteLabel}</p>
          {myReview ? (
            <div className="space-y-2">
              <RatingDisplay ratingHalf={myReview.rating_half} />
              <p className="text-xs text-amber-300 inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                {text.noteLocked}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <RatingDisplay ratingHalf={ratingHalf} />
              <p className="text-xs text-white/45">{formatRating(locale, ratingHalf)} / 5</p>
            </div>
          )}
        </div>
      </div>

      <div className="grid xl:grid-cols-[420px_minmax(0,1fr)] gap-6">
        <div className="glass-card p-5 space-y-4">
          <div>
            <h2 className="font-display text-xl font-700 text-white">{myReview ? text.editTitle : text.createTitle}</h2>
            <p className="text-sm text-white/45 mt-1">{myReview ? text.editHint : text.createHint}</p>
          </div>

          <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs font-mono text-white/35">{text.noteLabel}</span>
              <span className="text-sm text-white/70">{formatRating(locale, myReview?.rating_half || ratingHalf)} / 5</span>
            </div>
            <RatingInput valueHalf={myReview?.rating_half || ratingHalf} onChange={setRatingHalf} disabled={!!myReview} />
            {myReview && (
              <p className="text-xs text-amber-300 inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" />
                {text.lockedRating}
              </p>
            )}
          </div>

          <div>
            <label className="text-xs font-mono text-white/35 mb-2 block">{text.messageLabel}</label>
            <textarea
              className="input-field min-h-[170px] resize-none"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder={text.messagePlaceholder}
              maxLength={1500}
            />
          </div>

          <button
            type="button"
            onClick={myReview ? handleUpdate : handleCreate}
            disabled={saving || !message.trim()}
            className="w-full btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? text.saving : (myReview ? text.save : text.submit)}
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <MessageSquareText className="h-5 w-5 text-neon-cyan" />
            <h2 className="font-display text-xl font-700 text-white">{text.listTitle}</h2>
          </div>

          {loading ? (
            <div className="grid gap-3">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="glass-card p-5 skeleton h-36" />
              ))}
            </div>
          ) : overview.reviews.length < 1 ? (
            <div className="glass-card p-8 text-center">
              <p className="font-display text-lg text-white">{text.noReviews}</p>
              <p className="text-white/45 mt-2">{text.noReviewsBody}</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {overview.reviews.map((review) => (
                <div key={review.id} className="glass-card p-5">
                  <div className="flex items-start gap-4">
                    <Avatar review={review} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-display text-lg font-700 text-white">{review.username}</p>
                            {review.is_mine && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-2 py-0.5 text-[11px] font-mono text-neon-cyan">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {text.yourReview}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-1 flex-wrap">
                            <RatingDisplay ratingHalf={review.rating_half} />
                            <span className="text-sm text-white/65">{formatRating(locale, review.rating_half)} / 5</span>
                            <span className="text-xs text-white/35">{text.from} {formatDate(locale, review.created_at)}</span>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-white/75 leading-relaxed mt-4 whitespace-pre-wrap">{review.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
