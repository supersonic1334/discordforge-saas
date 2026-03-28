import { useMemo } from 'react'
import { motion } from 'framer-motion'

function buildSnowLayer(count, options) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${options.key}-${index}`,
    left: Math.random() * 100,
    top: -18 - Math.random() * 92,
    size: options.minSize + Math.random() * (options.maxSize - options.minSize),
    duration: options.minDuration + Math.random() * (options.maxDuration - options.minDuration),
    delay: Math.random() * options.maxDelay,
    drift: (Math.random() - 0.5) * options.maxDrift,
    opacity: options.minOpacity + Math.random() * (options.maxOpacity - options.minOpacity),
    blur: Math.random() * options.maxBlur,
    sway: 0.35 + Math.random() * 0.85,
    rotate: (Math.random() - 0.5) * 60,
  }))
}

export default function AuthSnowBackdrop({ className = '' }) {
  const backFlakes = useMemo(() => buildSnowLayer(78, {
    key: 'back',
    minSize: 0.8,
    maxSize: 2.4,
    minDuration: 18,
    maxDuration: 31,
    maxDelay: 18,
    maxDrift: 28,
    minOpacity: 0.1,
    maxOpacity: 0.28,
    maxBlur: 1.4,
  }), [])

  const midFlakes = useMemo(() => buildSnowLayer(56, {
    key: 'mid',
    minSize: 1.1,
    maxSize: 3.8,
    minDuration: 13,
    maxDuration: 23,
    maxDelay: 16,
    maxDrift: 40,
    minOpacity: 0.16,
    maxOpacity: 0.46,
    maxBlur: 0.9,
  }), [])

  const frontFlakes = useMemo(() => buildSnowLayer(52, {
    key: 'front',
    minSize: 1.8,
    maxSize: 5.6,
    minDuration: 9,
    maxDuration: 17,
    maxDelay: 16,
    maxDrift: 58,
    minOpacity: 0.28,
    maxOpacity: 0.8,
    maxBlur: 0.5,
  }), [])

  return (
    <div className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`} aria-hidden="true">
      <div className="absolute inset-0 bg-black" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(38,62,84,0.22),rgba(9,16,24,0.2)_18%,rgba(0,0,0,0.9)_54%,rgba(0,0,0,1))]" />
      <div className="absolute inset-x-0 top-0 h-[42vh] bg-[linear-gradient(180deg,rgba(92,123,154,0.12),rgba(92,123,154,0.05)_36%,transparent)]" />

      <motion.div
        className="absolute inset-[-8%]"
        animate={{ x: [0, 18, -10, 0], y: [0, -8, 5, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      >
        {backFlakes.map((flake) => (
          <motion.span
            key={flake.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${flake.left}%`,
              top: `${flake.top}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: `blur(${flake.blur}px)`,
              boxShadow: '0 0 8px rgba(188,208,228,0.12)',
            }}
            animate={{
              x: [0, flake.drift * flake.sway, flake.drift * -0.25],
              y: ['0vh', '135vh'],
              opacity: [0, flake.opacity, flake.opacity * 0.92, 0],
            }}
            transition={{
              duration: flake.duration,
              ease: 'linear',
              repeat: Infinity,
              delay: flake.delay,
            }}
          />
        ))}

        {midFlakes.map((flake) => (
          <motion.span
            key={flake.id}
            className="absolute rounded-full bg-[radial-gradient(circle,rgba(247,251,255,0.95),rgba(208,224,239,0.24)_62%,transparent)]"
            style={{
              left: `${flake.left}%`,
              top: `${flake.top}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: `blur(${flake.blur}px)`,
              boxShadow: '0 0 12px rgba(201,220,238,0.16)',
            }}
            animate={{
              x: [0, flake.drift * 0.65, flake.drift * -0.12],
              y: ['0vh', '137vh'],
              opacity: [0, flake.opacity, flake.opacity, 0],
            }}
            transition={{
              duration: flake.duration,
              ease: 'linear',
              repeat: Infinity,
              delay: flake.delay,
            }}
          />
        ))}

        {frontFlakes.map((flake) => (
          <motion.span
            key={flake.id}
            className="absolute"
            style={{
              left: `${flake.left}%`,
              top: `${flake.top}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: `blur(${flake.blur}px)`,
            }}
            animate={{
              x: [0, flake.drift, flake.drift * 0.38],
              y: ['0vh', '138vh'],
              rotate: [flake.rotate, flake.rotate + 18, flake.rotate - 10, flake.rotate + 8],
              opacity: [0, flake.opacity, flake.opacity * 0.94, 0],
            }}
            transition={{
              duration: flake.duration,
              ease: 'linear',
              repeat: Infinity,
              delay: flake.delay,
            }}
          >
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-white"
              style={{
                width: flake.size * 0.34,
                height: flake.size * 0.34,
                marginLeft: -(flake.size * 0.17),
                marginTop: -(flake.size * 0.17),
                boxShadow: '0 0 10px rgba(214,230,245,0.22)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(214,236,255,0.18))]"
              style={{
                width: Math.max(1, flake.size * 0.12),
                height: flake.size,
                marginLeft: -(Math.max(1, flake.size * 0.12) / 2),
                marginTop: -(flake.size / 2),
                boxShadow: '0 0 8px rgba(214,230,245,0.16)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.95),rgba(214,236,255,0.18))]"
              style={{
                width: flake.size,
                height: Math.max(1, flake.size * 0.12),
                marginLeft: -(flake.size / 2),
                marginTop: -(Math.max(1, flake.size * 0.12) / 2),
                boxShadow: '0 0 8px rgba(214,230,245,0.16)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(45deg,rgba(255,255,255,0.84),rgba(214,236,255,0.12))]"
              style={{
                width: flake.size * 0.82,
                height: Math.max(1, flake.size * 0.1),
                marginLeft: -(flake.size * 0.41),
                marginTop: -(Math.max(1, flake.size * 0.1) / 2),
                transform: 'rotate(45deg)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(214,236,255,0.12))]"
              style={{
                width: flake.size * 0.82,
                height: Math.max(1, flake.size * 0.1),
                marginLeft: -(flake.size * 0.41),
                marginTop: -(Math.max(1, flake.size * 0.1) / 2),
                transform: 'rotate(-45deg)',
              }}
            />
          </motion.span>
        ))}
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  )
}
