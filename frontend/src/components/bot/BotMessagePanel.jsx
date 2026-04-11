import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Hash, MessageSquareText, SendHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { botAPI, messagesAPI } from '../../services/api'
import BotStudioCard from './BotStudioCard'

export default function BotMessagePanel({ selectedGuildId, selectedGuild, canManageBot }) {
  const [channels, setChannels] = useState([])
  const [loadingChannels, setLoadingChannels] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [channelMenuOpen, setChannelMenuOpen] = useState(false)
  const [messagePayload, setMessagePayload] = useState({
    channel_id: '',
    message: '',
  })
  const channelSelectRef = useRef(null)

  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === messagePayload.channel_id) || null,
    [channels, messagePayload.channel_id]
  )

  useEffect(() => {
    if (!selectedGuildId) {
      setChannels([])
      setChannelMenuOpen(false)
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

  useEffect(() => {
    if (!channelMenuOpen) return undefined

    const handlePointerDown = (event) => {
      if (channelSelectRef.current?.contains(event.target)) return
      setChannelMenuOpen(false)
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setChannelMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [channelMenuOpen])

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
            <div ref={channelSelectRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  if (loadingChannels || channels.length === 0) return
                  setChannelMenuOpen((current) => !current)
                }}
                disabled={loadingChannels || channels.length === 0}
                className="group flex w-full items-center justify-between gap-3 overflow-hidden rounded-[24px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(10,16,29,0.94),rgba(5,9,19,0.98))] px-4 py-3.5 text-left text-white shadow-[0_16px_48px_rgba(3,8,20,0.28)] transition-all duration-200 hover:-translate-y-0.5 hover:border-neon-cyan/30 hover:shadow-[0_18px_54px_rgba(0,229,255,0.14)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.14),transparent_42%)] opacity-90" />
                <span className="relative flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] shadow-[0_10px_30px_rgba(34,211,238,0.08)]">
                    <Hash className="h-4.5 w-4.5 text-neon-cyan" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[11px] font-mono uppercase tracking-[0.22em] text-white/28">
                      {loadingChannels ? 'Chargement' : 'Salon actif'}
                    </span>
                    <span className="mt-1 block truncate font-display text-base font-700 text-white">
                      {selectedChannel ? `#${selectedChannel.name}` : (loadingChannels ? 'Recuperation des salons...' : 'Aucun salon textuel detecte')}
                    </span>
                  </span>
                </span>
                <span className="relative flex items-center gap-3">
                  {channels.length > 0 && (
                    <span className="hidden rounded-full border border-white/[0.08] bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-white/42 sm:inline-flex">
                      {channels.length} salons
                    </span>
                  )}
                  <ChevronDown className={`h-4.5 w-4.5 shrink-0 text-white/55 transition-transform duration-200 ${channelMenuOpen ? 'rotate-180 text-neon-cyan' : ''}`} />
                </span>
              </button>

              <AnimatePresence>
                {channelMenuOpen && channels.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.985 }}
                    transition={{ duration: 0.16, ease: 'easeOut' }}
                    className="absolute left-0 right-0 top-[calc(100%+10px)] z-30 overflow-hidden rounded-[24px] border border-neon-cyan/18 bg-[linear-gradient(180deg,rgba(9,14,28,0.98),rgba(6,10,20,0.99))] p-2 shadow-[0_28px_80px_rgba(0,0,0,0.46),0_0_0_1px_rgba(255,255,255,0.02)] backdrop-blur-2xl"
                  >
                    <div className="max-h-72 space-y-1 overflow-y-auto pr-1 scrollbar-none">
                      {channels.map((channel, index) => {
                        const active = channel.id === messagePayload.channel_id

                        return (
                          <motion.button
                            key={channel.id}
                            type="button"
                            initial={{ opacity: 0, x: -6 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.015, duration: 0.14 }}
                            onClick={() => {
                              setMessagePayload((current) => ({ ...current, channel_id: channel.id }))
                              setChannelMenuOpen(false)
                            }}
                            className={`group flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left transition-all duration-150 ${
                              active
                                ? 'border border-neon-cyan/20 bg-[linear-gradient(90deg,rgba(34,211,238,0.14),rgba(168,85,247,0.12))] shadow-[0_12px_32px_rgba(0,229,255,0.08)]'
                                : 'border border-transparent bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.05]'
                            }`}
                          >
                            <span className={`flex h-9 w-9 items-center justify-center rounded-2xl border ${
                              active
                                ? 'border-neon-cyan/22 bg-neon-cyan/10 text-neon-cyan'
                                : 'border-white/[0.08] bg-white/[0.04] text-white/48 group-hover:text-white/72'
                            }`}>
                              <Hash className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block truncate font-display text-sm font-700 ${active ? 'text-white' : 'text-white/82'}`}>
                                #{channel.name}
                              </span>
                              <span className="mt-0.5 block text-[11px] font-mono uppercase tracking-[0.16em] text-white/26">
                                Salon textuel
                              </span>
                            </span>
                            {active && (
                              <span className="h-2 w-2 rounded-full bg-neon-cyan shadow-[0_0_14px_rgba(0,229,255,0.85)]" />
                            )}
                          </motion.button>
                        )
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
