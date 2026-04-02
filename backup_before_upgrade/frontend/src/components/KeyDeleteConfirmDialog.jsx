import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function KeyDeleteConfirmDialog({
  open,
  busy = false,
  title,
  description,
  highlight,
  details = [],
  confirmWord = 'SUPPRIMER',
  inputLabel,
  inputPlaceholder,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
}) {
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!open) {
      setValue('')
      return
    }

    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose?.()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, busy, onClose])

  if (!open) return null

  const isReady = value.trim() === confirmWord

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-surface-0/80 backdrop-blur-md">
      <div className="absolute inset-0" onClick={() => !busy && onClose?.()} aria-hidden="true" />

      <div className="danger-confirm-shell relative w-full max-w-2xl overflow-hidden rounded-[28px] border border-red-500/25 bg-[#090a12] shadow-[0_40px_120px_rgba(0,0,0,0.7)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,91,91,0.18),transparent_48%),radial-gradient(circle_at_bottom_right,rgba(255,196,0,0.10),transparent_38%)] opacity-90" />

        <div className="relative p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="danger-confirm-pulse mt-0.5 flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-red-500/25 bg-red-500/10 text-red-300 shadow-[0_0_40px_rgba(255,91,91,0.2)]">
              <ShieldAlert className="h-7 w-7" />
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.24em] text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Suppression critique
                </div>
                <h3 className="text-2xl font-display font-700 text-white">{title}</h3>
                <p className="text-sm leading-6 text-white/62">{description}</p>
              </div>

              {highlight ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm leading-6 text-red-100/90">
                  {highlight}
                </div>
              ) : null}

              {details.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {details.map((detail) => (
                    <div key={detail.label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">{detail.label}</p>
                      <p className="mt-1 break-all text-sm text-white/78">{detail.value || '-'}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                <label className="mb-2 block text-xs font-mono uppercase tracking-[0.18em] text-white/36">
                  {inputLabel}
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={inputPlaceholder}
                  autoFocus
                />
                <p className="mt-2 text-xs text-white/34">
                  Mot attendu : <span className="font-mono text-amber-300">{confirmWord}</span>
                </p>
              </div>

              <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => !busy && onClose?.()}
                  disabled={busy}
                  className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white/70 transition-all hover:bg-white/[0.08] hover:text-white disabled:opacity-40"
                >
                  {cancelLabel}
                </button>
                <button
                  type="button"
                  onClick={() => isReady && !busy && onConfirm?.()}
                  disabled={!isReady || busy}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/12 px-5 py-3 text-sm font-display font-600 text-red-300 transition-all hover:bg-red-500/18 hover:text-red-200 disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2Mini />}
                  {confirmLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Trash2Mini() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}
