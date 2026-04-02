import { BookOpenText, ExternalLink, KeyRound } from 'lucide-react'
import { getProviderQuickAccess } from '../utils/providerQuickAccess'

export default function ProviderQuickLinks({
  provider,
  title,
  description,
  keyLabel,
  docsLabel,
}) {
  const quickAccess = getProviderQuickAccess(provider)

  if (!provider || (!quickAccess?.keyUrl && !quickAccess?.docsUrl)) {
    return null
  }

  return (
    <div className="rounded-2xl border border-neon-cyan/15 bg-[linear-gradient(135deg,rgba(6,182,212,0.08),rgba(168,85,247,0.08))] px-4 py-4 shadow-[0_16px_40px_rgba(6,182,212,0.08)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-neon-cyan/80">{title}</p>
          <p className="mt-1 text-sm text-white/90">{provider.label}</p>
          <p className="mt-1 text-xs text-white/45">{description}</p>
        </div>
        <KeyRound className="w-4 h-4 text-neon-cyan shrink-0 mt-1" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {quickAccess.keyUrl ? (
          <a
            href={quickAccess.keyUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-neon-cyan/25 bg-neon-cyan/10 px-3 py-2 text-xs font-mono text-neon-cyan transition-all hover:-translate-y-0.5 hover:bg-neon-cyan/18 hover:shadow-[0_10px_25px_rgba(6,182,212,0.14)]"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            {keyLabel}
          </a>
        ) : null}

        {quickAccess.docsUrl ? (
          <a
            href={quickAccess.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-mono text-white/75 transition-all hover:-translate-y-0.5 hover:bg-white/[0.08]"
          >
            <BookOpenText className="w-3.5 h-3.5" />
            {docsLabel}
          </a>
        ) : null}
      </div>
    </div>
  )
}
