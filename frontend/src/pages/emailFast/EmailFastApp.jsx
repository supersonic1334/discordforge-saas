import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Activity,
  BellRing,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  EyeOff,
  Gauge,
  Inbox,
  Infinity as InfinityIcon,
  KeyRound,
  Lock,
  Mail,
  MailPlus,
  QrCode,
  RefreshCw,
  Search,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react'
import { useEmailFastManager } from './useEmailFastManager'
import {
  DELETE_CONFIRMATION_WORD,
  DURATION_OPTIONS,
  FILTER_OPTIONS,
  formatDateTime,
  formatMessageTime,
  formatRemaining,
  getDurationConfig,
  getPasswordStrengthMeta,
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

function StatTile({ label, value, detail, tone = 'cyan' }) {
  return (
    <div className={clsx('ef-stat-card', `ef-stat-card-${tone}`)}>
      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-3 font-display text-2xl font-800 text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-white/48">{detail}</p>
    </div>
  )
}

function NoteRow({ tone = 'cyan', title, body }) {
  return (
    <div className="ef-side-note">
      <span className={clsx('ef-side-note-dot', `ef-side-note-dot-${tone}`)} />
      <div className="min-w-0">
        <p className="text-sm font-display font-700 text-white">{title}</p>
        <p className="mt-1 text-sm leading-6 text-white/48">{body}</p>
      </div>
    </div>
  )
}

function getMailboxHealth(mailbox) {
  const statusLabel = mailbox.isExpired ? 'Expiree' : mailbox.status === 'inactive' ? 'Indisponible' : 'Active'
  const isValid = mailbox.status === 'active' && !mailbox.isExpired

  return {
    isValid,
    statusLabel,
    validityLabel: isValid ? 'Valide' : 'Invalide',
    validityTone: isValid
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : 'border-red-400/20 bg-red-400/10 text-red-300',
  }
}

function DurationSettingsBlock({ title, caption, draft, setDraft }) {
  const durationMeta = useMemo(
    () => getDurationConfig(draft.durationKey, draft.customDurationMinutes),
    [draft.customDurationMinutes, draft.durationKey]
  )

  return (
    <div className="ef-panel space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-display font-700 text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/45">{caption}</p>
        </div>
        <div className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono leading-none text-white/52">
          {durationMeta.valid ? durationMeta.label : 'A regler'}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {DURATION_OPTIONS.map((option) => {
          const active = draft.durationKey === option.id

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setDraft((current) => ({ ...current, durationKey: option.id }))}
              className={clsx('ef-choice-card', active && 'ef-choice-card-active')}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-display text-sm font-700 text-white">{option.label}</span>
                {active && <CheckCircle2 className="h-4 w-4 text-neon-cyan" />}
              </div>
              <p className="mt-2 text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{option.note}</p>
            </button>
          )
        })}
      </div>

      {draft.durationKey === 'custom' && (
        <label className="block space-y-2">
          <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Duree perso</span>
          <input
            type="number"
            min="5"
            max="10080"
            value={draft.customDurationMinutes}
            onChange={(event) => setDraft((current) => ({ ...current, customDurationMinutes: event.target.value }))}
            className="input-field"
            placeholder="180"
          />
          <p className={clsx('text-sm', durationMeta.valid ? 'text-white/45' : 'text-red-300')}>
            {durationMeta.valid ? 'Entre 5 minutes et 7 jours.' : durationMeta.error}
          </p>
        </label>
      )}

      <div className="rounded-[20px] border border-white/10 bg-white/[0.04] px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-display font-700 text-white">Synchro automatique</p>
            <p className="mt-1 text-sm leading-6 text-white/45">Les nouveaux mails se mettent a jour tout seuls.</p>
          </div>
          <div className="shrink-0 whitespace-nowrap rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-1 text-[11px] font-mono leading-none text-neon-cyan">
            Auto
          </div>
        </div>
      </div>
    </div>
  )
}

function MailboxCard({ mailbox, active, onSelect, onRemove }) {
  const unread = mailbox.messages.filter((message) => !message.read).length
  const isPermanent = mailbox.durationKey === 'permanent' || !mailbox.expiresAt
  const isInactive = mailbox.status === 'inactive'
  const health = getMailboxHealth(mailbox)
  const remainingMs = mailbox.expiresAt && !mailbox.isExpired ? Math.max(0, mailbox.expiresAt - Date.now()) : 0
  const progress = mailbox.expiresAt && mailbox.totalDurationMs
    ? Math.max(8, Math.min(100, (remainingMs / mailbox.totalDurationMs) * 100))
    : 100
  const remainingLabel = mailbox.isExpired
    ? 'Expiree'
    : isInactive
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
      className={clsx(
        'ef-mailbox-card w-full text-left',
        active && 'ef-mailbox-card-active',
        mailbox.isExpired && 'ef-mailbox-card-expired'
      )}
    >
      <div className="flex items-start gap-3">
        <div className={clsx(
          'mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border',
          active
            ? 'border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan'
            : 'border-white/10 bg-white/[0.04] text-white/50'
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
              <span className={clsx(
                'h-2 w-2 rounded-full',
                mailbox.isExpired ? 'bg-red-300' : isInactive ? 'bg-amber-300' : 'bg-emerald-300 ef-live-dot'
              )} />
              {health.validityLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/50">
              {isPermanent ? <InfinityIcon className="h-3.5 w-3.5" /> : <Activity className="h-3.5 w-3.5" />}
              {remainingLabel}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.16em] text-white/48">
              <BellRing className="h-3.5 w-3.5" />
              {unread} non lus
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

          <div className="mt-3 flex items-center justify-between gap-4 text-[11px] text-white/38">
            <span>{mailbox.messages.length} mails</span>
            <span>Maj {mailbox.lastSyncAt ? formatMessageTime(mailbox.lastSyncAt) : '--'}</span>
          </div>
        </div>
      </div>
    </motion.button>
  )
}

export default function EmailFastApp() {
  const { state, actions } = useEmailFastManager()
  const qrRef = useRef(null)
  const [labelDraft, setLabelDraft] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deletePhrase, setDeletePhrase] = useState('')
  const [showVaultKey, setShowVaultKey] = useState(false)

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
  const allUnread = useMemo(
    () => state.mailboxes.reduce((total, mailbox) => total + mailbox.messages.filter((message) => !message.read).length, 0),
    [state.mailboxes]
  )
  const permanentCount = useMemo(
    () => state.mailboxes.filter((mailbox) => mailbox.durationKey === 'permanent' || !mailbox.expiresAt).length,
    [state.mailboxes]
  )
  const inactiveCount = useMemo(
    () => state.mailboxes.filter((mailbox) => mailbox.status === 'inactive').length,
    [state.mailboxes]
  )
  const strengthMeta = getPasswordStrengthMeta(state.createPassword)
  const previewText = state.selectedMessage
    ? stripHtml(state.selectedMessage.bodyText || state.selectedMessage.bodyHtml || '')
    : ''
  const activeMailboxHealth = state.activeMailbox ? getMailboxHealth(state.activeMailbox) : null

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

  if (state.screen === 'auth') {
    const hasSavedSession = state.hasStoredVault || state.mailboxes.length > 0
    const storedMailboxCount = state.mailboxes.length || state.storedVaultMeta?.mailboxCount || 0

    return (
      <div className="email-fast-app mx-auto max-w-[1480px] space-y-5 px-4 py-5 sm:p-6">
        <motion.section className="section-hero" {...motionFade}>
          <div className="relative z-[1] space-y-6">
            <div className="max-w-3xl">
              <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/70">Email Fast</p>
              <h1 className="mt-4 font-display text-3xl font-800 text-white sm:text-4xl">
                Mes adresses
              </h1>
              <p className="mt-3 text-sm leading-7 text-white/52 sm:text-[15px]">
                Cree une adresse, retrouve les precedentes et change d adresse en un geste.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Adresses"
                value="Sans plafond"
                detail="Ajoute autant d adresses que tu veux sur cet appareil."
                tone="cyan"
              />
              <StatTile
                label="Duree"
                value="10 min a permanent"
                detail="Choix rapide ou duree perso."
                tone="violet"
              />
              <StatTile
                label="Acces"
                value="Cle auto"
                detail="Generee automatiquement puis copiable en un clic."
                tone="amber"
              />
            </div>
          </div>
        </motion.section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_380px]">
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

            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-display text-xl font-700 text-white">
                  {hasSavedSession ? 'Mes adresses' : 'Premiere adresse'}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/45">
                  {hasSavedSession
                    ? 'Colle ta cle d acces pour rouvrir tes adresses.'
                    : 'Une cle forte est preparee pour toi. Copie-la, puis cree ta premiere adresse.'}
                </p>
              </div>

              {!hasSavedSession && (
                <div className="rounded-full border border-neon-cyan/20 bg-neon-cyan/10 px-3 py-1 text-[11px] font-mono text-neon-cyan">
                  Auto
                </div>
              )}
            </div>

            {state.authError && (
              <div className="mt-5 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                {state.authError}
              </div>
            )}

            {!hasSavedSession && (
              <div className="mt-5 space-y-5">
                <PasswordField
                  label="Cle d acces"
                  placeholder="Cle auto-generee"
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
                    Copier la cle
                  </button>
                  <button
                    type="button"
                    onClick={actions.regenerateCreatePassword}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Regenerer
                  </button>
                </div>

                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: strengthMeta.width, background: strengthMeta.color }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                    <span className="font-mono uppercase tracking-[0.16em] text-white/35">Solidite</span>
                    <span className="text-white/45">{strengthMeta.label}</span>
                  </div>
                </div>

                <div className="rounded-[24px] border border-neon-cyan/15 bg-neon-cyan/10 px-4 py-4 text-sm leading-6 text-neon-cyan">
                  Cette cle ouvre et protege toutes tes adresses. Copie-la avant de quitter.
                </div>

                <DurationSettingsBlock
                  title="Premiere adresse"
                  caption="Choisis la duree de la premiere adresse."
                  draft={state.createDraft}
                  setDraft={actions.setCreateDraft}
                />

                <button
                  type="button"
                  onClick={actions.handleCreateSubmit}
                  disabled={state.isCreating || !createDurationMeta.valid}
                  className="btn-primary inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state.isCreating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
                  {state.isCreating ? 'Creation en cours' : 'Creer ma premiere adresse'}
                </button>
              </div>
            )}

            {hasSavedSession && (
              <div className="mt-5 space-y-5">
                <div className="rounded-[24px] border border-neon-cyan/15 bg-neon-cyan/10 px-4 py-4 text-sm leading-6 text-neon-cyan">
                  {storedMailboxCount} adresse{storedMailboxCount > 1 ? 's' : ''} detectee
                  {storedMailboxCount > 1 ? 's' : ''} sur cet appareil.
                  {state.storedVaultMeta?.updatedAt ? (
                    <span className="block text-xs text-neon-cyan/70">
                      Derniere mise a jour: {formatDateTime(state.storedVaultMeta.updatedAt)}
                    </span>
                  ) : null}
                </div>

                <PasswordField
                  label="Cle d acces"
                  placeholder="Colle ta cle d acces"
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
            )}
          </motion.section>

          <motion.aside className="space-y-5" {...motionFade}>
            <div className="depth-panel rounded-[30px] p-5 sm:p-6">
              <p className="font-display text-lg font-700 text-white">Acces simple</p>
              <p className="mt-2 text-sm leading-6 text-white/45">
                Tout est pense pour retrouver tes adresses sans repartir de zero.
              </p>

              <div className="mt-5 space-y-3">
                <NoteRow
                  tone="cyan"
                  title="Cle unique"
                  body="Une seule cle pour rouvrir toutes tes adresses."
                />
                <NoteRow
                  tone="emerald"
                  title="Duree par adresse"
                  body="Chaque adresse garde son propre temps et son propre statut."
                />
                <NoteRow
                  tone="violet"
                  title="Retour rapide"
                  body="Tes adresses reviennent directement quand tu reviens sur la page."
                />
              </div>
            </div>
          </motion.aside>
        </div>
      </div>
    )
  }

  return (
    <div className="email-fast-app mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:p-6">
      <motion.section className="section-hero" {...motionFade}>
        <div className="relative z-[1] flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/70">Email Fast</p>
            <h1 className="mt-4 font-display text-3xl font-800 text-white sm:text-4xl">Mes adresses</h1>
            <p className="mt-3 text-sm leading-7 text-white/52 sm:text-[15px]">
              Ouvre, retrouve et change d adresse en un geste. Chaque adresse garde ses mails et sa duree.
            </p>

            {state.activeMailbox ? (
              <div className="ef-active-strip mt-5">
                <div className="min-w-0">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Adresse ouverte</p>
                  <p className="mt-2 truncate font-display text-lg font-700 text-white">{state.activeMailbox.label}</p>
                  <p className="mt-1 truncate font-mono text-xs text-neon-cyan">{state.activeMailbox.address}</p>
                </div>

                <div className="ef-active-strip-side">
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/32">Derniere sync</p>
                    <p className="mt-2 text-sm text-white">
                      {state.activeMailbox.lastSyncAt ? formatDateTime(state.activeMailbox.lastSyncAt) : '--'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-mono uppercase tracking-[0.16em] text-white/32">Statut</p>
                    <p className="mt-2 text-sm text-white">{activeMailboxHealth?.validityLabel || 'Invalide'}</p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={actions.copyActiveAddress}
              disabled={!state.activeMailbox}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/72 transition-all hover:border-neon-cyan/20 hover:text-white disabled:opacity-40"
            >
              <Copy className="h-4 w-4" />
              Copier
            </button>
            <button
              type="button"
              onClick={actions.refreshActiveMailbox}
              disabled={!state.activeMailbox || state.activeMailbox.isExpired}
              className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-40"
            >
              <RefreshCw className={clsx('h-4 w-4', state.isRefreshing && 'animate-spin')} />
              Actualiser
            </button>
            <button
              type="button"
              onClick={actions.handleLock}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-300"
            >
              <Lock className="h-4 w-4" />
              Verrouiller
            </button>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 md:grid-cols-4">
          <StatTile
            label="Adresses"
            value={state.mailboxes.length}
            detail="Sans plafond fixe sur cet appareil."
            tone="cyan"
          />
          <StatTile
            label="Non lus"
            value={allUnread}
            detail="Toutes adresses confondues."
            tone="violet"
          />
          <StatTile
            label="Permanent"
            value={permanentCount}
            detail="Sans limite de retention."
            tone="emerald"
          />
          <StatTile
            label="Inactives"
            value={inactiveCount}
            detail="A reessayer ou supprimer."
            tone="amber"
          />
        </div>
      </motion.section>

      <div className="ef-switcher-strip" data-allow-select>
        {state.mailboxes.map((mailbox) => {
          const health = getMailboxHealth(mailbox)
          return (
            <button
              key={mailbox.id}
              type="button"
              onClick={() => actions.switchMailbox(mailbox.id)}
              className={clsx('ef-switcher-chip', mailbox.id === state.activeMailboxId && 'ef-switcher-chip-active')}
            >
              <span className={clsx('h-2 w-2 rounded-full', health.isValid ? 'bg-emerald-300 ef-live-dot' : 'bg-red-300')} />
              <span className="truncate">{mailbox.label}</span>
              <span className="text-white/35">{health.validityLabel}</span>
            </button>
          )
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
        <motion.aside className="order-3 space-y-5 xl:order-1" {...motionFade}>
          <div className="depth-panel rounded-[30px] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-700 text-white">Toutes mes adresses</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Choisis une adresse pour afficher ses mails tout de suite.
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

          <div className="depth-panel rounded-[30px] p-5 sm:p-6">
            <div>
              <div>
                <p className="font-display text-lg font-700 text-white">Nouvelle adresse</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Cree une autre adresse sans perdre les precedentes.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <DurationSettingsBlock
                title="Nouvelle adresse"
                caption="Choisis la duree de cette adresse."
                draft={state.createDraft}
                setDraft={actions.setCreateDraft}
              />

              <button
                type="button"
                onClick={actions.handleCreateAnotherMailbox}
                disabled={state.isCreating || !createDurationMeta.valid}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-4 py-3 font-mono text-sm text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {state.isCreating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MailPlus className="h-4 w-4" />}
                {state.isCreating ? 'Creation...' : 'Ajouter une adresse'}
              </button>
            </div>
          </div>
        </motion.aside>

        <motion.section className="order-1 space-y-5 xl:order-2" {...motionFade}>
          <div className="depth-panel rounded-[32px] p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-display text-lg font-700 text-white">Reception</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  {state.activeMailbox
                    ? `Reception de ${state.activeMailbox.label}.`
                    : 'Selectionne une adresse pour afficher ses mails.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => actions.setFilterMode(option.id)}
                    className={clsx(
                      'rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.16em] transition-all',
                      state.filterMode === option.id
                        ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative mt-5">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/25" />
              <input
                value={state.searchQuery}
                onChange={(event) => actions.setSearchQuery(event.target.value)}
                placeholder="Rechercher un expediteur, un objet ou un contenu..."
                className="input-field pl-11"
              />
            </div>

            <div className="mt-5 space-y-3">
              {!state.activeMailbox && (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center text-white/40">
                  Ouvre une adresse depuis la liste pour voir ses mails.
                </div>
              )}

              {state.activeMailbox && state.visibleMessages.length === 0 && (
                <div className="rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                  <Inbox className="mx-auto h-10 w-10 text-white/10" />
                  <p className="mt-4 font-display text-lg font-700 text-white">
                    {state.searchQuery ? 'Aucun resultat' : 'Inbox encore vide'}
                  </p>
                  <p className="mt-2 text-sm text-white/40">
                    {state.searchQuery
                      ? 'Change le filtre ou la recherche.'
                      : 'Les nouveaux mails apparaitront ici en temps reel.'}
                  </p>
                </div>
              )}

              <AnimatePresence initial={false}>
                {state.visibleMessages.map((message) => {
                  const preview = stripHtml(message.bodyText || message.bodyHtml || '').slice(0, 150) || 'Apercu indisponible.'
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
                          <div className="flex items-center gap-2">
                            {!message.read && <span className="h-2 w-2 rounded-full bg-neon-cyan ef-live-dot" />}
                            <p className="truncate font-display text-base font-700 text-white">{message.subject}</p>
                          </div>
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
          </div>
        </motion.section>

        <motion.aside className="order-2 space-y-5 xl:order-3" {...motionFade}>
          <div className="depth-panel rounded-[30px] p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-lg font-700 text-white">Reglages de l adresse</p>
                <p className="mt-1 text-sm leading-6 text-white/45">
                  Ajuste l adresse ouverte sans toucher aux autres.
                </p>
              </div>
              {activeDurationMeta && (
                <div className="shrink-0 whitespace-nowrap rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono leading-none text-white/48">
                  {activeDurationMeta.label}
                </div>
              )}
            </div>

            {state.activeMailbox ? (
              <div className="mt-5 space-y-5">
                <div className="ef-panel space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-display font-700 text-white">Cle d acces</p>
                      <p className="mt-1 text-sm leading-6 text-white/45">
                        Garde-la pour rouvrir toutes tes adresses plus tard.
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

                  <PasswordField
                    label="Cle active"
                    placeholder="Cle d acces"
                    value={state.sessionPassword || ''}
                    onChange={() => {}}
                    visible={showVaultKey}
                    onToggle={() => setShowVaultKey((current) => !current)}
                    readOnly
                  />
                </div>

                <div className="space-y-2">
                  <span className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Nom visible</span>
                  <div className="flex gap-2">
                    <input
                      value={labelDraft}
                      onChange={(event) => setLabelDraft(event.target.value)}
                      onBlur={commitLabel}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitLabel()
                        }
                      }}
                      className="input-field"
                      placeholder="Nom de l adresse"
                    />
                    <button
                      type="button"
                      onClick={commitLabel}
                      className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-white/70 transition-all hover:border-neon-cyan/20 hover:text-white"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="ef-panel space-y-4">
                  <div>
                    <p className="text-sm font-display font-700 text-white">Adresse active</p>
                    <p className="mt-2 break-all font-mono text-sm text-neon-cyan">{state.activeMailbox.address}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Validite</p>
                      <p className="mt-2 font-display text-lg font-700 text-white">{activeMailboxHealth?.validityLabel || 'Invalide'}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Messages</p>
                      <p className="mt-2 font-display text-lg font-700 text-white">{state.activeMailbox.messages.length}</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">Non lus</p>
                      <p className="mt-2 font-display text-lg font-700 text-white">{state.unreadCount}</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-white/45">Retention</span>
                      <span className="font-mono text-white">
                        {state.activeMailbox.isExpired
                          ? 'Expiree'
                          : activeDurationMeta?.isPermanent
                            ? 'Permanent'
                            : formatRemaining(state.remainingMs)}
                      </span>
                    </div>
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
                  </div>
                </div>

                <DurationSettingsBlock
                  title="Reglages"
                  caption="Change la duree quand tu veux."
                  draft={state.runtimeDraft}
                  setDraft={actions.setRuntimeDraft}
                />

                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={actions.applyRuntimeSettings}
                    disabled={!runtimeDurationMeta.valid}
                    className="btn-primary inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-mono disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Gauge className="h-4 w-4" />
                    Appliquer
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.extendActiveMailbox(60)}
                    disabled={!state.activeMailbox || activeDurationMeta?.isPermanent}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white disabled:opacity-40"
                  >
                    <Activity className="h-4 w-4" />
                    +1 heure
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.extendActiveMailbox(10)}
                    disabled={!state.activeMailbox || activeDurationMeta?.isPermanent}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white disabled:opacity-40"
                  >
                    <Activity className="h-4 w-4" />
                    +10 min
                  </button>
                  <button
                    type="button"
                    onClick={actions.makeActivePermanent}
                    disabled={!state.activeMailbox || activeDurationMeta?.isPermanent}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300 transition-all hover:bg-emerald-400/15 disabled:opacity-40"
                  >
                    <InfinityIcon className="h-4 w-4" />
                    Permanent
                  </button>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => actions.setQrOpen((current) => !current)}
                    className={clsx(
                      'inline-flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm transition-all',
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
                    onClick={actions.copyActiveAddress}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white"
                  >
                    <Copy className="h-4 w-4" />
                    Copier
                  </button>
                  <button
                    type="button"
                    onClick={actions.exportActiveMailbox}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/70 transition-all hover:border-white/15 hover:text-white"
                  >
                    <Download className="h-4 w-4" />
                    Export
                  </button>
                </div>

                {state.syncError && (
                  <div className="rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-3 text-sm text-red-200">
                    {state.syncError}
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-5 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center text-white/40">
                Selectionne une adresse pour regler sa duree.
              </div>
            )}
          </div>

          {state.qrOpen && state.activeMailbox && (
            <div className="depth-panel rounded-[30px] p-5 sm:p-6">
              <p className="font-display text-lg font-700 text-white">QR adresse</p>
              <p className="mt-1 text-sm leading-6 text-white/45">Scanne pour recuperer l adresse sur mobile.</p>

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
                <p className="font-display text-lg font-700 text-white">Preview</p>
                <p className="mt-1 text-sm leading-6 text-white/45">Lecture rapide du mail selectionne.</p>
              </div>
              {state.selectedMessage && (
                <button
                  type="button"
                  onClick={actions.copyMessageContent}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-white/70 transition-all hover:border-white/15 hover:text-white"
                >
                  <Copy className="h-4 w-4" />
                  Copier
                </button>
              )}
            </div>

            {!state.selectedMessage && (
              <div className="mt-5 rounded-[24px] border border-dashed border-white/10 bg-white/[0.03] px-6 py-12 text-center">
                <Inbox className="mx-auto h-10 w-10 text-white/10" />
                <p className="mt-4 font-display text-lg font-700 text-white">Aucun mail ouvert</p>
                <p className="mt-2 text-sm text-white/40">Choisis un message pour afficher son contenu ici.</p>
              </div>
            )}

            {state.selectedMessage && (
              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-xs font-mono uppercase tracking-[0.16em] text-white/35">Sujet</p>
                  <p className="mt-2 font-display text-xl font-700 text-white">{state.selectedMessage.subject}</p>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">
                  <p><span className="text-white/38">De:</span> {state.selectedMessage.from}</p>
                  <p className="mt-2"><span className="text-white/38">Recu:</span> {formatDateTime(state.selectedMessage.date)}</p>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => actions.setModalTab('text')}
                    className={clsx(
                      'rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.16em] transition-all',
                      state.modalTab === 'text'
                        ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white'
                    )}
                  >
                    Texte
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.setModalTab('html')}
                    disabled={!state.selectedMessage.bodyHtml}
                    className={clsx(
                      'rounded-full border px-3 py-2 text-[11px] font-mono uppercase tracking-[0.16em] transition-all',
                      state.modalTab === 'html'
                        ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan'
                        : 'border-white/10 bg-white/[0.04] text-white/45 hover:text-white',
                      !state.selectedMessage.bodyHtml && 'cursor-not-allowed opacity-40'
                    )}
                  >
                    HTML
                  </button>
                </div>

                {state.modalTab === 'html' && state.selectedMessage.bodyHtml ? (
                  <div className="ef-preview-shell">
                    <iframe
                      title={state.selectedMessage.subject}
                      className="min-h-[360px] w-full rounded-[18px] bg-white"
                      sandbox="allow-same-origin"
                      srcDoc={state.selectedMessage.bodyHtml}
                    />
                  </div>
                ) : (
                  <div className="ef-preview-shell">
                    <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-7 text-white/72">
                      {state.selectedMessage.bodyText || previewText || '(vide)'}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.aside>
      </div>

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
                  <p className="font-display text-xl font-700 text-white">Suppression protegee</p>
                  <p className="mt-2 text-sm leading-6 text-white/48">
                    Cette adresse sera retiree, meme si elle est permanente. Pour confirmer, ecris
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
}
