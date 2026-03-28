import { motion } from 'framer-motion'
import VoiceMeter from './VoiceMeter'

const ACCENT_STYLES = {
  cyan: {
    shell: 'bg-neon-cyan/8',
    panel: 'border-neon-cyan/16 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.16),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]',
    badge: 'border-neon-cyan/24 bg-neon-cyan/10 text-cyan-100',
    transcript: 'border-neon-cyan/14 bg-black/24',
  },
  violet: {
    shell: 'bg-neon-violet/8',
    panel: 'border-neon-violet/16 bg-[radial-gradient(circle_at_top_right,rgba(139,92,246,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]',
    badge: 'border-neon-violet/24 bg-neon-violet/10 text-violet-100',
    transcript: 'border-neon-violet/14 bg-black/24',
  },
  amber: {
    shell: 'bg-amber-500/8',
    panel: 'border-amber-300/16 bg-[radial-gradient(circle_at_top_right,rgba(251,191,36,0.18),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.02))]',
    badge: 'border-amber-300/24 bg-amber-400/10 text-amber-100',
    transcript: 'border-amber-300/14 bg-black/24',
  },
}

export default function VoiceComposerPanel({
  accent = 'cyan',
  active = false,
  processing = false,
  bars = [],
  statusLabel,
  liveLabel,
  transcript,
  placeholder,
}) {
  const styles = ACCENT_STYLES[accent] || ACCENT_STYLES.cyan
  const displayText = String(transcript || '').trim() || placeholder

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`relative overflow-hidden rounded-[28px] border p-4 sm:p-5 ${styles.panel}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),transparent_45%)]" />
      <div className="relative grid gap-4 xl:grid-cols-[auto,minmax(0,1fr)] xl:items-center">
        <div className="flex justify-center xl:justify-start">
          <div className={`rounded-[24px] border border-white/10 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ${styles.shell}`}>
            <VoiceMeter
              bars={bars}
              active={active}
              processing={processing}
              accent={accent}
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] ${styles.badge}`}>
              {statusLabel}
            </span>
            <span className="rounded-full border border-white/10 bg-black/18 px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/50">
              {liveLabel}
            </span>
          </div>

          <div className={`mt-3 rounded-[22px] border px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] ${styles.transcript}`}>
            <p className="whitespace-pre-wrap break-words text-sm leading-7 text-white/90">
              {displayText}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
