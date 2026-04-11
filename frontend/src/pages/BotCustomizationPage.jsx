import BotCustomizationPanel from '../components/bot/BotCustomizationPanel'
import { useAuthStore, useBotStore } from '../stores'

export default function BotCustomizationPage() {
  const { hasOwnBotToken } = useAuthStore()
  const fetchStatus = useBotStore((state) => state.fetchStatus)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-5 sm:py-6">
      <div>
        <p className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">Bot</p>
        <h1 className="mt-2 font-display text-3xl font-800 text-white">Personnalisation du bot</h1>
        <p className="mt-2 max-w-3xl text-sm leading-7 text-white/45">
          Regle le statut, l'activite, le pseudo et la description du bot depuis une page dediee.
        </p>
      </div>

      <BotCustomizationPanel canManageBot={hasOwnBotToken} onProfileUpdated={fetchStatus} />
    </div>
  )
}
