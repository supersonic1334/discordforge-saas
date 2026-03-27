import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'

const ACCENT_CONFIG = {
  violet: {
    bar: 'from-violet-200 via-violet-400 to-fuchsia-300',
    orb: 'from-violet-500/70 via-fuchsia-500/70 to-cyan-400/70',
    glow: 'shadow-[0_0_32px_rgba(168,85,247,0.34)]',
    ring: 'border-violet-300/45',
    bg: 'bg-violet-500/10',
    dot: 'bg-violet-300',
  },
  amber: {
    bar: 'from-amber-200 via-amber-300 to-orange-300',
    orb: 'from-amber-400/70 via-orange-400/65 to-amber-200/70',
    glow: 'shadow-[0_0_32px_rgba(251,191,36,0.34)]',
    ring: 'border-amber-300/45',
    bg: 'bg-amber-500/10',
    dot: 'bg-amber-300',
  },
  cyan: {
    bar: 'from-cyan-200 via-cyan-300 to-sky-300',
    orb: 'from-cyan-400/75 via-sky-400/70 to-violet-400/65',
    glow: 'shadow-[0_0_32px_rgba(34,211,238,0.34)]',
    ring: 'border-cyan-300/45',
    bg: 'bg-cyan-500/10',
    dot: 'bg-cyan-300',
  },
}

const BAR_COUNT = 9
const DEFAULT_BARS = [0.18, 0.26, 0.22, 0.34, 0.28, 0.24, 0.3, 0.22, 0.16]

function WaveformBars({ bars, accent, active }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  const data = bars.length >= BAR_COUNT ? bars.slice(0, BAR_COUNT) : DEFAULT_BARS

  return (
    <div className="inline-flex h-10 items-center gap-[3px]">
      {data.map((level, index) => {
        const height = active ? Math.max(8, Math.round(10 + level * 24)) : 8
        return (
          <motion.span
            key={index}
            animate={{ height, opacity: active ? 1 : 0.38 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18, mass: 0.36 }}
            className={`w-[3px] rounded-full bg-gradient-to-t ${cfg.bar}`}
          />
        )
      })}
    </div>
  )
}

function PulseRings({ accent, level }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  return (
    <>
      {[0, 1, 2].map((index) => (
        <motion.div
          key={index}
          className={`absolute inset-0 rounded-full border ${cfg.ring}`}
          initial={{ scale: 1, opacity: 0.4 }}
          animate={{
            scale: 1.35 + index * 0.28 + level * 0.18,
            opacity: [0.45, 0],
          }}
          transition={{
            duration: 1.55,
            repeat: Infinity,
            delay: index * 0.35,
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
    <div className="flex items-center gap-2">
      {[0, 1, 2].map((index) => (
        <motion.div
          key={index}
          className={`h-2.5 w-2.5 rounded-full ${cfg.dot}`}
          animate={{ y: [0, -5, 0], opacity: [0.45, 1, 0.45] }}
          transition={{ duration: 0.82, repeat: Infinity, delay: index * 0.16, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

export default function VoiceMeter({ bars = [], active = false, processing = false, accent = 'cyan' }) {
  const cfg = ACCENT_CONFIG[accent] || ACCENT_CONFIG.cyan
  const state = processing ? 'processing' : active ? 'listening' : 'idle'

  const avgLevel = useMemo(() => {
    if (!bars.length) return 0.2
    return bars.reduce((sum, value) => sum + value, 0) / bars.length
  }, [bars])

  return (
    <div className="relative inline-flex items-center justify-center">
      <AnimatePresence mode="wait">
        {state === 'listening' && (
          <motion.div
            key="listening"
            initial={{ opacity: 0, scale: 0.84, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.84, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`relative inline-flex min-h-[48px] items-center gap-3 rounded-full border border-white/10 ${cfg.bg} px-3 py-2 backdrop-blur-md ${cfg.glow}`}
          >
            <div className="relative flex h-8 w-8 items-center justify-center rounded-full">
              <PulseRings accent={accent} level={avgLevel} />
              <motion.div
                animate={{
                  scale: 1 + avgLevel * 0.28,
                  opacity: 0.92,
                }}
                transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                className={`h-8 w-8 rounded-full bg-gradient-to-br ${cfg.orb} shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]`}
              />
              <motion.div
                animate={{ scale: 0.72 + avgLevel * 0.16 }}
                transition={{ type: 'spring', stiffness: 420, damping: 16 }}
                className="absolute h-3 w-3 rounded-full bg-white/90 shadow-[0_0_16px_rgba(255,255,255,0.45)]"
              />
            </div>
            <WaveformBars bars={bars} accent={accent} active={active} />
          </motion.div>
        )}

        {state === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.84, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.84, y: -4 }}
            transition={{ duration: 0.2 }}
            className={`inline-flex min-h-[46px] items-center gap-3 rounded-full border border-white/10 ${cfg.bg} px-3 py-2 backdrop-blur-md ${cfg.glow}`}
          >
            <motion.div
              animate={{ scale: [0.92, 1.08, 0.92] }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
              className={`h-7 w-7 rounded-full bg-gradient-to-br ${cfg.orb}`}
            />
            <ProcessingDots accent={accent} />
          </motion.div>
        )}

        {state === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-full border border-white/10 bg-black/25 px-2.5 py-2 backdrop-blur-md"
          >
            <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${cfg.orb} opacity-55`} />
            <WaveformBars bars={DEFAULT_BARS} accent={accent} active={false} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
