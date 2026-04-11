import React from 'react'

export default function BotStudioCard({ title, subtitle, icon: Icon, children }) {
  return (
    <div className="rounded-[26px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,31,0.92),rgba(6,10,21,0.94))] p-5 shadow-[0_18px_60px_rgba(4,8,20,0.22)]">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.05]">
          <Icon className="h-5 w-5 text-neon-cyan" />
        </div>
        <div>
          <p className="font-display text-xl font-700 text-white">{title}</p>
          <p className="mt-1 text-sm leading-6 text-white/42">{subtitle}</p>
        </div>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  )
}
