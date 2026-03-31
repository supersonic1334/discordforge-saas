import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Inbox,
  Infinity as InfinityIcon,
  KeyRound,
  Mail,
  MailPlus,
  QrCode,
  RefreshCw,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react'
import { useEmailFastManager } from './useEmailFastManager'
import {
  DELETE_CONFIRMATION_WORD,
  DURATION_OPTIONS,
  formatDateTime,
  formatMessageTime,
  formatRemaining,
  getDurationConfig,
  stripHtml,
} from './model'
import './EmailFastApp.css'

function PasswordField({
  label,
  placeholder,
  value,
  onChange,
  visible,
  onToggle,
  onKeyDown,
  readOnly = false,
}) {
  return (
    <label className="block space-y-2">
      <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{label}</span>
      <div className="relative">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          readOnly={readOnly}
          onChange={(event) => onChange?.(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            if (readOnly) event.currentTarget.select()
          }}
          placeholder={placeholder}
          className={clsx('input-field pr-12', !visible && 'secret-field', readOnly && 'cursor-default select-all')}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-xl border border-white/10 bg-white/[0.05] p-2 text-white/45 transition-all hover:border-white/15 hover:text-white"
          aria-label={visible ? 'Masquer la valeur' : 'Afficher la valeur'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  )
}

function getMailboxHealth(mailbox) {
  const isValid = mailbox.status === 'active' && !mailbox.isExpired

  return {
    isValid,
    validityLabel: isValid ? 'Valide' : 'Invalide',
    validityTone: isValid
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : 'border-red-400/20 bg-red-400/10 text-red-300',
  }
}

function DurationPicker({ title, draft, setDraft, compact = false }) {
  const durationMeta = useMemo(
    () => getDurationConfig(draft.durationKey, draft.customDurationMinutes),
    [draft.customDurationMinutes, draft.durationKey]
  )

  return (
    <div className={clsx('ef-panel', compact ? 'space-y-4' : 'space-y-5')}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-display font-700 text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/45">Choisis le temps avant expiration.</p>
        </div>
        <div className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono leading-none text-white/52">
          {durationMeta.valid ? durationMeta.label : 'À régler'}
        </div>
      </div>

      <div className={clsx('grid gap-2', compact ? 'sm:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-3')}>
        {DURATION_OPTIONS.map((option) => {
          const active = draft.durationKey === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setDraft((current) => ({ ...current, durationKey: option.id }))}
              className={clsx('ef-choice-card', active && 'ef-choice-card-active')}
            >
              <div className="ef-choice-head">
                <span className="ef-choice-label">{option.label}</span>
                {active && <CheckCircle2 className="h-4 w-4 text-neon-cyan" />}
              </div>
              <p className="mt-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{option.note}</p>
            </button>
          )
        })}
      </div>

      {draft.durationKey === 'custom' && (
        <label className="block space-y-2">
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Durée perso</span>
          <input
            type="number"
            min="1"
            max="10080"
            value={draft.customDurationMinutes}
            onChange={(event) => setDraft((current) => ({ ...current, customDurationMinutes: event.target.value }))}
            className="input-field"
            placeholder="60"
          />
          <p className={clsx('text-sm', durationMeta.valid ? 'text-white/45' : 'text-red-300')}>
            {durationMeta.valid ? 'Entre 1 minute et 7 jours.' : durationMeta.error}
          </p>
        </label>
      )}
    </div>
  )
}

function MailboxCard({ mailbox, active, onSelect, onRemove }) {
  const unread = mailbox.messages.filter((message) => !message.read).length
  const isPermanent = mailbox.durationKey === 'permanent' || !mailbox.expiresAt
  const health = getMailboxHealth(mailbox)
  const remainingMs = mailbox.expiresAt && !mailbox.isExpired ? Math.max(0, mailbox.expiresAt - Date.now()) : 0
  const progress = mailbox.expiresAt && mailbox.totalDurationMs
    ? Math.max(8, Math.min(100, (remainingMs / mailbox.totalDurationMs) * 100))
    : 100
  const remainingLabel = mailbox.isExpired
    ? 'Expirée'
    : mailbox.status === 'inactive'
      ? 'Indisponible'
      : isPermanent
        ? 'Permanent'
        : formatRemaining(remainingMs)

  return (
    <motion.button
      type="button"
      layout
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.992 }}
      onClick={onSelect}
      className={clsx('ef-mailbox-card w-full text-left', active && 'ef-mailbox-card-active', mailbox.isExpired && 'ef-mailbox-card-expired')}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border',
          active ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan' : 'border-white/10 bg-white/[0.04] text-white/50'
        )}>
          <Mail className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-700 text-white">{mailbox.label}</p>
              <p className="truncate font-mono text-[11px] text-white/42" title={mailbox.address}>{mailbox.address}</p>
            </div>

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onRemove()
              }}
              className="rounded-xl border border-white/10 bg-white/[0.05] p-2 text-white/35 transition-all hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-300"
              aria-label={`Retirer ${mailbox.label}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={clsx(
              'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em]',
              health.validityTone
            )}>
              <span className={clsx('h-2 w-2 rounded-full', health.isValid ? 'bg-emerald-300 ef-live-dot' : 'bg-red-300')} />
              {health.validityLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/48">
              {isPermanent ? <InfinityIcon className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
              {remainingLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/48">
              {unread} non lu{unread > 1 ? 's' : ''}
            </span>
          </div>

          <div className="mt-3 ef-progress-track ef-progress-track-compact">
            <div
              className={clsx(
                'ef-progress-bar',
                isPermanent && 'ef-progress-bar-permanent',
                mailbox.isExpired && 'ef-progress-bar-expired'
              )}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </motion.button>
  )
}

function MessageModal({ message, tab, setTab, onClose, onCopy }) {
  useEffect(() => {
    if (!message) return undefined

    function handleEscape(event) {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [message, onClose])

  if (!message) return null

  const previewText = stripHtml(message.bodyText || message.bodyHtml || '')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="ef-modal-backdrop"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        transition={{ duration: 0.18 }}
        className="ef-modal-shell depth-panel rounded-[30px] p-5 sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-display text-xl font-700 text-white">{message.subject}</p>
            <p className="mt-2 text-sm leading-6 text-white/48">{message.from}</p>
            <p className="text-xs font-mono text-white/32">{formatDateTime(message.date)}</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/70 transition-all hover:border-white/15 hover:text-white"
            >
              <Copy className="h-4 w-4" />
              Copier
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/70 transition-all hover:border-white/15 hover:text-white"
            >
              Fermer
            </button>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => setTab('text')}
            className={clsx(
              'rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.16em] transition-all',
              tab === 'text'
                ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white'
            )}
          >
            Texte
          </button>
          <button
            type="button"
            onClick={() => setTab('html')}
            disabled={!message.bodyHtml}
            className={clsx(
              'rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.16em] transition-all',
              tab === 'html'
                ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white',
              !message.bodyHtml && 'cursor-not-allowed opacity-40'
            )}
          >
            HTML
          </button>
        </div>

        <div className="mt-5 ef-preview-shell">
          {tab === 'html' && message.bodyHtml ? (
            <iframe
              title={message.subject}
              className="min-h-[360px] w-full rounded-[18px] bg-white"
              sandbox="allow-same-origin"
              srcDoc={message.bodyHtml}
            />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-white/72">
              {message.bodyText || previewText || '(vide)'}
            </pre>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

export default function EmailFastApp() {
  const { state, actions } = useEmailFastManager()
  const qrRef = useRef(null)
  const [showVaultKey, setShowVaultKey] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletePhrase, setDeletePhrase] = useState('')

  const createDurationMeta = useMemo(
    () => getDurationConfig(state.createDraft.durationKey, state.createDraft.customDurationMinutes),
    [state.createDraft.customDurationMinutes, state.createDraft.durationKey]
  )
  const runtimeDurationMeta = useMemo(
    () => getDurationConfig(state.runtimeDraft.durationKey, state.runtimeDraft.customDurationMinutes),
    [state.runtimeDraft.customDurationMinutes, state.runtimeDraft.durationKey]
  )
  const activeDurationMeta = useMemo(() => {
    if (!state.activeMailbox) return null
    return getDurationConfig(state.activeMailbox.durationKey, state.activeMailbox.customDurationMinutes)
  }, [state.activeMailbox])
  const activeMailboxHealth = state.activeMailbox ? getMailboxHealth(state.activeMailbox) : null
  const activeRemainingLabel = state.activeMailbox
    ? state.activeMailbox.isExpired
      ? 'Expirée'
      : activeDurationMeta?.isPermanent
        ? 'Permanent'
        : formatRemaining(state.remainingMs)
    : '--'
  const storedMailboxCount = state.mailboxes.length || state.storedVaultMeta?.mailboxCount || 0

  useEffect(() => {
    setLabelDraft(state.activeMailbox?.label || '')
  }, [state.activeMailbox?.id, state.activeMailbox?.label])

  useEffect(() => {
    if (!state.qrOpen || !state.qrReady || !state.activeMailbox?.address || !qrRef.current || !window.QRCode) {
      if (qrRef.current) qrRef.current.innerHTML = ''
      return undefined
    }

    qrRef.current.innerHTML = ''
    const instance = new window.QRCode(qrRef.current, {
      text: state.activeMailbox.address,
      width: 176,
      height: 176,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel.M,
    })

    return () => {
      qrRef.current?.replaceChildren()
      void instance
    }
  }, [state.activeMailbox?.address, state.qrOpen, state.qrReady])

  function commitLabel() {
    if (!state.activeMailbox?.id) return
    const nextLabel = labelDraft.trim()
    if (!nextLabel || nextLabel === state.activeMailbox.label) return
    actions.setMailboxLabel(state.activeMailbox.id, nextLabel)
  }

  function openDeleteModal(mailbox) {
    setDeleteTarget(mailbox)
    setDeletePhrase('')
  }

  function closeDeleteModal() {
    setDeleteTarget(null)
    setDeletePhrase('')
  }

  function confirmDeleteMailbox() {
    if (!deleteTarget || deletePhrase !== DELETE_CONFIRMATION_WORD) return
    actions.removeMailbox(deleteTarget.id)
    closeDeleteModal()
  }

  const motionFade = {
    initial: { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.34, ease: 'easeOut' },
  }

  const renderAuthScreen = () => {
    const hasSavedSession = state.hasStoredVault || state.mailboxes.length > 0

    return (
      <div className="email-fast-app mx-auto max-w-[1240px] space-y-5 px-4 py-5 sm:p-6">
        <motion.section className="depth-panel relative overflow-hidden rounded-[32px] p-5 sm:p-6" {...motionFade}>
          {state.lockoutSecondsLeft > 0 && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-slate-950/92 backdrop-blur-xl">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-300">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <div className="text-center">
                <p className="font-display text-xl font-700 text-white">Pause securite</p>
                <p className="mt-2 font-mono text-sm text-red-300">{state.lockoutSecondsLeft}s avant nouvel essai</p>
              </div>
            </div>
          )}

          <div className="relative z-[1] max-w-3xl">
            <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/70">Email temporaire</p>
            <h1 className="mt-4 font-display text-3xl font-800 text-white sm:text-4xl">
              {hasSavedSession ? 'Retrouver mes adresses' : 'Créer une adresse temporaire'}
            </h1>
            <p className="mt-3 text-sm leading-7 text-white/52 sm:text-[15px]">
              {hasSavedSession
                ? 'Tes adresses peuvent être rouvertes tout de suite depuis cet appareil.'
                : 'Choisis une durée, clique, et ton adresse se crée tout de suite.'}
            </p>
          </div>

          {state.authError && (
            <div className="relative z-[1] mt-5 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
              {state.authError}
            </div>
          )}

          {!hasSavedSession ? (
            <div className="relative z-[1] mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <DurationPicker title="Durée de l'adresse" draft={state.createDraft} setDraft={actions.setCreateDraft} />

              <div className="space-y-5">
                <div className="ef-panel space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-display font-700 text-white">Clé d'accès</p>
                      <p className="mt-1 text-sm leading-6 text-white/45">
                        Elle est générée automatiquement et reste disponible dans l'espace.
                      </p>
                    </div>
                    <KeyRound className="mt-1 h-5 w-5 text-neon-cyan" />
                  </div>

                  <PasswordField
                    label="Clé générée"
                    placeholder="Clé auto-générée"
                    value={state.createPassword}
                    onChange={actions.setCreatePassword}
                    visible={state.showCreatePassword}
                    onToggle={() => actions.setShowCreatePassword((current) => !current)}
                    readOnly
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        actions.handleCreateSubmit()
                      }
                    }}
                  />

                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={actions.copyAccessKey}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white"
                    >
                      <Copy className="h-4 w-4" />
                      Copier la clé
                    </button>
                    <button
                      type="button"
                      onClick={actions.regenerateCreatePassword}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Régénérer
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={actions.handleCreateSubmit}
                  disabled={state.isCreating || !createDurationMeta.valid}
                  className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state.isCreating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
                  {state.isCreating ? 'Création en cours' : 'Créer une adresse temporaire'}
                </button>
              </div>
            </div>
          ) : (
            <div className="relative z-[1] mt-6 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <div className="ef-panel space-y-4">
                <p className="text-sm font-display font-700 text-white">Adresses détectées</p>
                <p className="text-sm leading-6 text-white/45">
                  {storedMailboxCount} adresse{storedMailboxCount > 1 ? 's' : ''} retrouvée
                  {storedMailboxCount > 1 ? 's' : ''} sur cet appareil.
                </p>
                {state.storedVaultMeta?.updatedAt && (
                  <p className="text-xs font-mono text-white/35">
                    Dernière mise à jour: {formatDateTime(state.storedVaultMeta.updatedAt)}
                  </p>
                )}
              </div>

              <div className="space-y-5">
                <div className="ef-panel space-y-4">
                  <PasswordField
                    label="Clé d'accès"
                    placeholder="Colle ta clé d'accès"
                    value={state.accessPassword}
                    onChange={actions.setAccessPassword}
                    visible={state.showAccessPassword}
                    onToggle={() => actions.setShowAccessPassword((current) => !current)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        actions.handleUnlock()
                      }
                    }}
                  />
                </div>

                <button
                  type="button"
                  onClick={actions.handleUnlock}
                  disabled={state.isRestoring}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-4 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state.isRestoring ? <RefreshCw className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {state.isRestoring ? 'Ouverture...' : 'Ouvrir mes adresses'}
                </button>
              </div>
            </div>
          )}
        </motion.section>
      </div>
    )
  }
  const renderAppScreen = () => (
    <div className="email-fast-app mx-auto max-w-[1480px] space-y-5 px-4 py-5 sm:p-6">
      <motion.section className="section-hero" {...motionFade}>
        <div className="relative z-[1] grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="depth-panel rounded-[32px] p-5 sm:p-6">
            <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/70">Email temporaire</p>
            <h1 className="mt-4 font-display text-3xl font-800 text-white sm:text-4xl">Boîte de réception</h1>

            {state.activeMailbox ? (
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Adresse active</p>
                  <p className="mt-2 break-all font-display text-xl font-700 text-white">{state.activeMailbox.address}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <span className={clsx(
                    'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em]',
                    activeMailboxHealth?.validityTone
                  )}>
                    <span className={clsx('h-2 w-2 rounded-full', activeMailboxHealth?.isValid ? 'bg-emerald-300 ef-live-dot' : 'bg-red-300')} />
                    {activeMailboxHealth?.validityLabel || 'Invalide'}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/48">
                    {activeDurationMeta?.isPermanent ? <InfinityIcon className="h-3.5 w-3.5" /> : <Mail className="h-3.5 w-3.5" />}
                    {activeRemainingLabel}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/48">
                    {state.activeMailbox.messages.length} mail{state.activeMailbox.messages.length > 1 ? 's' : ''}
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="ef-progress-track">
                    <div
                      className={clsx(
                        'ef-progress-bar',
                        activeDurationMeta?.isPermanent && 'ef-progress-bar-permanent',
                        state.activeMailbox.isExpired && 'ef-progress-bar-expired'
                      )}
                      style={{ width: state.activeMailbox.isExpired ? '100%' : `${Math.max(6, state.progressPercent)}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={actions.copyActiveAddress}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/72 transition-all hover:border-neon-cyan/20 hover:text-white"
                    >
                      <Copy className="h-4 w-4" />
                      Copier l'adresse
                    </button>
                    <button
                      type="button"
                      onClick={actions.refreshActiveMailbox}
                      disabled={state.activeMailbox.isExpired}
                      className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-40"
                    >
                      <RefreshCw className={clsx('h-4 w-4', state.isRefreshing && 'animate-spin')} />
                      Actualiser
                    </button>
                    <button
                      type="button"
                      onClick={() => actions.setQrOpen((current) => !current)}
                      className={clsx(
                        'inline-flex items-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-all',
                        state.qrOpen
                          ? 'border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan'
                          : 'border-white/10 bg-white/[0.05] text-white/70 hover:text-white'
                      )}
                    >
                      <QrCode className="h-4 w-4" />
                      QR
                    </button>
                    <button
                      type="button"
                      onClick={actions.exportActiveMailbox}
                      className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white"
                    >
                      <Download className="h-4 w-4" />
                      Export
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center text-white/40">
                Crée une adresse pour afficher la boîte de réception.
              </div>
            )}
          </div>

          <div className="depth-panel rounded-[32px] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-display font-700 text-white">Clé d'accès</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Elle reste disponible ici et protège toutes tes adresses.
                </p>
              </div>
              <button
                type="button"
                onClick={actions.copyAccessKey}
                className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-2 text-xs text-neon-cyan transition-all hover:bg-neon-cyan/15"
              >
                <Copy className="h-4 w-4" />
                Copier
              </button>
            </div>

            <div className="mt-5">
              <PasswordField
                label="Clé active"
                placeholder="Clé d'accès"
                value={state.sessionPassword || state.createPassword || ''}
                onChange={() => {}}
                visible={showVaultKey}
                onToggle={() => setShowVaultKey((current) => !current)}
                readOnly
              />
            </div>
          </div>
        </div>
      </motion.section>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <motion.aside className="space-y-5" {...motionFade}>
          <div className="depth-panel rounded-[30px] p-5 sm:p-6">
            <DurationPicker title="Nouvelle adresse" draft={state.createDraft} setDraft={actions.setCreateDraft} compact />

            <button
              type="button"
              onClick={actions.handleCreateAnotherMailbox}
              disabled={state.isCreating || !createDurationMeta.valid}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {state.isCreating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
              {state.isCreating ? 'Création...' : 'Créer une adresse'}
            </button>
          </div>

          <div className="depth-panel rounded-[30px] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-700 text-white">Mes adresses</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Clique une adresse pour ouvrir sa boîte.
                </p>
              </div>
              <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/45">
                {state.mailboxes.length}
              </div>
            </div>

            <div className="ef-mailbox-list mt-5">
              <AnimatePresence initial={false}>
                {state.mailboxes.map((mailbox) => (
                  <MailboxCard
                    key={mailbox.id}
                    mailbox={mailbox}
                    active={mailbox.id === state.activeMailboxId}
                    onSelect={() => actions.switchMailbox(mailbox.id)}
                    onRemove={() => openDeleteModal(mailbox)}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </motion.aside>

        <motion.section className="space-y-5" {...motionFade}>
          {state.activeMailbox && (
            <div className="depth-panel rounded-[30px] p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-display text-lg font-700 text-white">Temps de cette adresse</p>
                  <p className="mt-1 text-sm leading-6 text-white/45">
                    Change la durée quand tu veux.
                  </p>
                </div>

                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/48">
                  {activeDurationMeta?.label || '--'}
                </div>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_180px]">
                <DurationPicker title="Durée" draft={state.runtimeDraft} setDraft={actions.setRuntimeDraft} compact />

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={actions.applyRuntimeSettings}
                    disabled={!runtimeDurationMeta.valid}
                    className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Appliquer
                  </button>
                  <button
                    type="button"
                    onClick={actions.makeActivePermanent}
                    disabled={activeDurationMeta?.isPermanent}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300 transition-all hover:bg-emerald-400/15 disabled:opacity-40"
                  >
                    <InfinityIcon className="h-4 w-4" />
                    Permanent
                  </button>
                </div>
              </div>
            </div>
          )}

          {state.qrOpen && state.activeMailbox && (
            <div className="depth-panel rounded-[30px] p-5 sm:p-6">
              <p className="font-display text-lg font-700 text-white">QR adresse</p>
              <p className="mt-1 text-sm leading-6 text-white/45">Scanne pour récupérer l'adresse sur mobile.</p>

              <div className="mt-5 flex flex-col items-center gap-4">
                <div className="ef-qr-shell">
                  <div ref={qrRef} />
                </div>
                <p className="break-all text-center font-mono text-xs text-white/45">{state.activeMailbox.address}</p>
              </div>
            </div>
          )}

          <div className="depth-panel rounded-[30px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-lg font-700 text-white">Boîte de réception</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Les nouveaux mails arrivent automatiquement ici.
                </p>
              </div>

              {state.activeMailbox && (
                <button
                  type="button"
                  onClick={actions.refreshActiveMailbox}
                  disabled={state.isRefreshing || state.activeMailbox.isExpired}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/70 transition-all hover:border-white/15 hover:text-white disabled:opacity-40"
                >
                  <RefreshCw className={clsx('h-4 w-4', state.isRefreshing && 'animate-spin')} />
                  Actualiser
                </button>
              )}
            </div>

            {state.syncError && (
              <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {state.syncError}
              </div>
            )}

            {!state.activeMailbox && (
              <div className="mt-5 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center text-white/40">
                Crée ou sélectionne une adresse pour afficher les emails.
              </div>
            )}

            {state.activeMailbox && state.visibleMessages.length === 0 && (
              <div className="mt-5 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                <Inbox className="mx-auto h-10 w-10 text-white/10" />
                <p className="mt-4 font-display text-lg font-700 text-white">Aucun mail pour le moment</p>
                <p className="mt-2 text-sm text-white/40">La boîte se mettra à jour toute seule.</p>
              </div>
            )}

            {state.activeMailbox && state.visibleMessages.length > 0 && (
              <div className="mt-5 space-y-3">
                <AnimatePresence initial={false}>
                  {state.visibleMessages.map((message) => {
                    const preview = stripHtml(message.bodyText || message.bodyHtml || '').slice(0, 160) || 'Apercu indisponible.'
                    const selected = state.selectedMessage?.id === message.id

                    return (
                      <motion.button
                        key={message.id}
                        type="button"
                        layout
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        onClick={() => actions.openMessage(message.id)}
                        className={clsx(
                          'ef-message-card w-full text-left',
                          selected && 'ef-message-card-active',
                          !message.read && 'ef-mail-unread'
                        )}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <p className="truncate font-display text-base font-700 text-white">{message.subject}</p>
                            <p className="mt-1 truncate text-sm text-white/55">{message.from}</p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                actions.toggleStar(message.id)
                              }}
                              className={clsx(
                                'rounded-xl border p-2 transition-all',
                                message.starred
                                  ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
                                  : 'border-white/10 bg-white/[0.04] text-white/35 hover:text-amber-300'
                              )}
                              aria-label={message.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                            >
                              <Star className="h-4 w-4" />
                            </button>

                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                actions.deleteMessage(message.id)
                              }}
                              className="rounded-xl border border-white/10 bg-white/[0.04] p-2 text-white/35 transition-all hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-300"
                              aria-label="Supprimer"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <p className="mt-3 text-sm leading-6 text-white/45">{preview}</p>

                        <div className="mt-4 flex items-center justify-between gap-3 text-[11px] font-mono uppercase tracking-[0.16em] text-white/32">
                          <span>{formatMessageTime(message.date)}</span>
                          <span>{message.starred ? 'favori' : message.read ? 'lu' : 'nouveau'}</span>
                        </div>
                      </motion.button>
                    )
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </motion.section>
      </div>

      <AnimatePresence>
        {state.selectedMessage && (
          <MessageModal
            message={state.selectedMessage}
            tab={state.modalTab}
            setTab={actions.setModalTab}
            onClose={actions.closeModal}
            onCopy={actions.copyMessageContent}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="ef-modal-backdrop"
            onClick={closeDeleteModal}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="ef-modal-shell depth-panel rounded-[30px] p-5 sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-400/20 bg-red-400/10 text-red-300">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-xl font-700 text-white">Suppression protégée</p>
                  <p className="mt-2 text-sm leading-6 text-white/48">
                    Cette adresse sera retirée. Pour confirmer, écris
                    <span className="mx-1 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 font-mono text-xs text-white">
                      {DELETE_CONFIRMATION_WORD}
                    </span>
                    exactement.
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="font-display text-base font-700 text-white">{deleteTarget.label}</p>
                <p className="mt-1 break-all font-mono text-xs text-white/42">{deleteTarget.address}</p>
              </div>

              <div className="mt-5 space-y-2">
                <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Confirmation</span>
                <input
                  value={deletePhrase}
                  onChange={(event) => setDeletePhrase(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      confirmDeleteMailbox()
                    }
                  }}
                  className="input-field"
                  placeholder={DELETE_CONFIRMATION_WORD}
                />
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  className="rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteMailbox}
                  disabled={deletePhrase !== DELETE_CONFIRMATION_WORD}
                  className="rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300 transition-all hover:bg-red-400/15 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Continuer a supprimer
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return state.screen === 'auth' ? renderAuthScreen() : renderAppScreen()
}
