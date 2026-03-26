import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'

const ACCENT_CONFIG = {
  violet: {
    bar: 'from-violet-300 via-violet-400 to-fuchsia-300',
    glow: 'shadow-[0_0_20px_rgba(168,85,247,0.35)]',
    ring: 'border-violet-400/40',
    bg: 'bg-violet-500/8',
    dot: 'bg-violet-400',
  },
  amber: {
    bar: 'from-amber-200 via-amber-300 to-orange-300',
    glow: 'shadow-[0_0_20px_rgba(251,191,36,0.35)]',
    ring: 'border-amber-400/40',
    bg: 'bg-amber-500/8',
    dot: 'bg-amber-400',
  },
  cyan: {
    bar: 'from-cyan-200 via-cyan-300 to-sky-300',
    glow: 'shadow-[0_0_20px_rgba(34,211,238,0.35)]',
    ring: 'border-cyan-400/40',
    bg: 'bg-cyan-500/8',
    dot: 'bg-cyan-400',
  },
}

const BAR_COUNT = 7
const DEFAULT_BARS = [0.12, 0.18, 0.14, 0.22, 0.16, 0.2, 0.13]

function WaveformBars({ bars, accent, active }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  const data = bars.length >= BAR_COUNT ? bars.slice(0, BAR_COUNT) : DEFAULT_BARS

  return (
    <div className="inline-flex h-10 items-center gap-[3px]">
      {data.map((level, i) => {
        const height = active ? Math.max(8, Math.round(8 + level * 28)) : 8
        return (
          <motion.span
            key={i}
            animate={{ height }}
            transition={{ type: 'spring', stiffness: 400, damping: 18, mass: 0.4 }}
            className={`w-[3px] rounded-full bg-gradient-to-t ${cfg.bar} ${active ? 'opacity-100' : 'opacity-40'}`}
          />
        )
      })}
    </div>
  )
}

function PulseRings({ accent }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  return (
    <>
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className={`absolute inset-0 rounded-full border ${cfg.ring}`}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.5 + i * 0.3, opacity: 0 }}
          transition={{
            duration: 1.8,
            repeat: Infinity,
            delay: i * 0.6,
            ease: 'easeOut',
          }}
        />
      ))}
    </>
  )
}

function ProcessingDots({ accent }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`}
          animate={{ y: [0, -4, 0], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

export default function VoiceMeter({ bars = [], active = false, processing = false, accent = 'cyan' }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  const state = processing ? 'processing' : active ? 'listening' : 'idle'

  const avgLevel = useMemo(() => {
    if (!bars.length) return 0
    return bars.reduce((sum, v) => sum + v, 0) / bars.length
  }, [bars])

  return (
    <div className="relative inline-flex items-center justify-center">
      <AnimatePresence mode="wait">
        {state === 'listening' && (
          <motion.div
            key="listening"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className={`relative inline-flex h-10 items-center gap-2 rounded-full border border-white/10 ${cfg.bg} px-3 py-2 backdrop-blur-sm ${cfg.glow}`}
          >
            <PulseRings accent={accent} />
            <WaveformBars bars={bars} accent={accent} active={active} />
          </motion.div>
        )}

        {state === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.2 }}
            className={`inline-flex h-10 items-center gap-2 rounded-full border border-white/10 ${cfg.bg} px-4 py-2 backdrop-blur-sm`}
          >
            <ProcessingDots accent={accent} />
          </motion.div>
        )}

        {state === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="inline-flex h-9 items-end gap-[3px] rounded-full border border-white/10 bg-black/25 px-2.5 py-2 backdrop-blur-sm"
          >
            {DEFAULT_BARS.map((level, i) => (
              <span
                key={i}
                className={`w-[3px] rounded-full bg-gradient-to-t ${cfg.bar} opacity-30`}
                style={{ height: '8px' }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
