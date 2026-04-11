import BotMessagePanel from '../components/bot/BotMessagePanel'
import { useAuthStore, useGuildStore } from '../stores'

export default function BotMessagesPage() {
  const { hasOwnBotToken } = useAuthStore()
  const { guilds, selectedGuildId } = useGuildStore()
  const selectedGuild = guilds.find((guild) => guild.id === selectedGuildId) || null

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-5 sm:py-6">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Bot</p>
        <h1 className="mt-2 font-display text-3xl font-800 text-white">Messages du bot</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-white/45">
          Choisis un salon, redige un message, puis envoie-le directement avec le bot.
        </p>
      </div>

      <BotMessagePanel
        selectedGuildId={selectedGuildId}
        selectedGuild={selectedGuild}
        canManageBot={hasOwnBotToken}
      />
    </div>
  )
}
