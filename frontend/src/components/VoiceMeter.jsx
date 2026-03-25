export default function VoiceMeter({ bars = [], active = false, accent = 'cyan' }) {
  const accentClass = accent === 'violet'
    ? 'from-violet-300/95 via-violet-400/90 to-fuchsia-300/95 shadow-[0_0_16px_rgba(168,85,247,0.22)]'
    : accent === 'amber'
      ? 'from-amber-200/95 via-amber-300/90 to-orange-300/95 shadow-[0_0_16px_rgba(251,191,36,0.24)]'
      : 'from-cyan-200/95 via-cyan-300/90 to-sky-300/95 shadow-[0_0_16px_rgba(34,211,238,0.22)]'

  return (
    <div className="inline-flex h-9 items-end gap-1 rounded-full border border-white/10 bg-black/25 px-2.5 py-2 backdrop-blur-sm">
      {(bars.length ? bars : [0.12, 0.18, 0.14, 0.2, 0.16]).map((level, index) => (
        <span
          key={index}
          className={`w-1 rounded-full bg-gradient-to-t transition-all duration-150 ${accentClass} ${active ? 'opacity-100' : 'opacity-55'}`}
          style={{ height: `${Math.max(6, Math.round(6 + level * 20))}px` }}
        />
      ))}
    </div>
  )
}
