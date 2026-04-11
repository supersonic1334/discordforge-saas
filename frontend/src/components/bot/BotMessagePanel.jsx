import { useEffect, useState } from 'react'
import { Hash, MessageSquareText, SendHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, messagesAPI } from '../../services/api'
import BotStudioCard from './BotStudioCard'
import SearchableSelect from '../ui/SearchableSelect'

export default function BotMessagePanel({ selectedGuildId, selectedGuild, canManageBot }) {
  const [channels, setChannels] = useState([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messagePayload, setMessagePayload] = useState({
    channel_id: '',
    message: '',
  })

  useEffect(() => {
    if (!selectedGuildId) {
      setChannels([])
      setMessagePayload((current) => ({ ...current, channel_id: '' }))
      return
    }

    let mounted = true
    setLoadingChannels(true)

    botAPI.channels(selectedGuildId)
      .then((response) => {
        if (!mounted) return

        const nextChannels = (response.data?.channels || [])
          .filter((channel) => [0, 5].includes(Number(channel?.type)))
          .map((channel) => ({
            id: String(channel.id),
            name: channel.name || `salon-${channel.id}`,
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

        setChannels(nextChannels)
        setMessagePayload((current) => ({
          ...current,
          channel_id: nextChannels.some((item) => item.id === current.channel_id)
            ? current.channel_id
            : (nextChannels[0]?.id || ''),
        }))
      })
      .catch(() => {
        if (!mounted) return
        setChannels([])
        setMessagePayload((current) => ({ ...current, channel_id: '' }))
      })
      .finally(() => {
        if (mounted) setLoadingChannels(false)
      })

    return () => {
      mounted = false
    }
  }, [selectedGuildId])

  const handleSendMessage = async () => {
    if (!selectedGuildId || !messagePayload.channel_id || !messagePayload.message.trim()) return

    setSendingMessage(true)
    try {
      await messagesAPI.sendChannel(selectedGuildId, {
        channel_id: messagePayload.channel_id,
        message: messagePayload.message.trim(),
      })
      setMessagePayload((current) => ({ ...current, message: '' }))
      toast.success('Message envoye')
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Impossible d envoyer le message')
    } finally {
      setSendingMessage(false)
    }
  }

  if (!canManageBot) {
    return (
      <BotStudioCard
        title="Messages du bot"
        subtitle="L'envoi direct reste reserve au proprietaire principal du token."
        icon={MessageSquareText}
      >
        <div className="rounded-2xl border border-neon-cyan/18 bg-neon-cyan/[0.08] px-4 py-4 text-sm leading-6 text-white/62">
          Ce module est disponible uniquement depuis le compte principal.
        </div>
      </BotStudioCard>
    )
  }

  return (
    <BotStudioCard
      title="Messages du bot"
      subtitle="Choisis un salon textuel puis fais parler le bot instantanement."
      icon={MessageSquareText}
    >
      {!selectedGuildId ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-sm leading-6 text-white/58">
          Selectionne d'abord un serveur actif pour ecrire dans un salon avec le bot.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-4">
            <p className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/28">Serveur actif</p>
            <p className="mt-2 font-display text-lg font-700 text-white">{selectedGuild?.name || 'Serveur selectionne'}</p>
          </div>

          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Salon</span>
            <SearchableSelect
              label="Salon actif"
              value={messagePayload.channel_id}
              onChange={(option) => {
                setMessagePayload((current) => ({ ...current, channel_id: option.id }))
              }}
              options={channels}
              disabled={loadingChannels || channels.length === 0}
              loading={loadingChannels}
              placeholder="Aucun salon textuel detecte"
              emptyLabel="Aucun salon textuel detecte"
              emptySearchLabel="Aucun salon ne correspond"
              countSuffix="salons"
              getOptionKey={(option) => option.id}
              getOptionLabel={(option) => option.name}
              renderValue={(option) => `#${option.name}`}
              renderOption={(option, active) => (
                <>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${
                    active
                      ? 'border-neon-cyan/22 bg-neon-cyan/10 text-neon-cyan'
                      : 'border-white/[0.08] bg-white/[0.04] text-white/48 group-hover:text-white/72'
                  }`}>
                    <Hash className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-display text-sm font-700 ${active ? 'text-white' : 'text-white/82'}`}>
                      #{option.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] font-mono uppercase tracking-[0.16em] text-white/26">
                      Salon textuel
                    </span>
                  </span>
                  {active && (
                    <span className="h-2 w-2 rounded-full bg-neon-cyan shadow-[0_0_14px_rgba(0,229,255,0.85)]" />
                  )}
                </>
              )}
            />
          </label>

          <label className="space-y-2">
            <span className="text-[11px] font-mono uppercase tracking-[0.22em] text-white/30">Message</span>
            <textarea
              rows={7}
              value={messagePayload.message}
              onChange={(event) => setMessagePayload((current) => ({ ...current, message: event.target.value.slice(0, 2000) }))}
              placeholder="Ecris ici le message que le bot doit envoyer."
              className="w-full resize-none rounded-[24px] border border-white/[0.08] bg-slate-950/60 px-4 py-3 text-sm leading-6 text-white outline-none transition-colors placeholder:text-white/22 focus:border-neon-cyan/30"
            />
          </label>

          <button
            type="button"
            onClick={handleSendMessage}
            disabled={sendingMessage || !messagePayload.channel_id || !messagePayload.message.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/22 bg-emerald-400/10 px-4 py-3 text-sm font-mono text-emerald-300 transition-all hover:-translate-y-0.5 hover:bg-emerald-400/18 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sendingMessage ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" /> : <SendHorizontal className="h-4 w-4" />}
            Envoyer avec le bot
          </button>
        </div>
      )}
    </BotStudioCard>
  )
}
