import { motion } from 'framer-motion'
import VoiceMeter from './VoiceMeter'

const ACCENT_STYLES = {
  cyan: {
    shell: 'border-neon-cyan/18 bg-neon-cyan/8',
    badge: 'border-neon-cyan/24 bg-neon-cyan/10 text-cyan-100',
    text: 'text-neon-cyan',
  },
  violet: {
    shell: 'border-neon-violet/18 bg-neon-violet/8',
    badge: 'border-neon-violet/24 bg-neon-violet/10 text-violet-100',
    text: 'text-violet-200',
  },
  amber: {
    shell: 'border-amber-300/18 bg-amber-400/8',
    badge: 'border-amber-300/24 bg-amber-400/10 text-amber-100',
    text: 'text-amber-200',
  },
}

export default function VoiceComposerPanel({
  accent = 'cyan',
  active = false,
  processing = false,
  bars = [],
  statusLabel,
  helperText,
}) {
  const styles = ACCENT_STYLES[accent] || ACCENT_STYLES.cyan

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className={`rounded-[24px] border p-4 shadow-[0_16px_42px_rgba(2,8,23,0.24)] backdrop-blur-xl ${styles.shell}`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.18em] ${styles.badge}`}>
            {statusLabel}
          </span>
          <p className="text-sm leading-6 text-white/72">
            {helperText}
          </p>
        </div>

        <div className="flex justify-center sm:justify-end">
          <VoiceMeter
            bars={bars}
            active={active}
            processing={processing}
            accent={accent}
          />
        </div>
      </div>
    </motion.div>
  )
}
