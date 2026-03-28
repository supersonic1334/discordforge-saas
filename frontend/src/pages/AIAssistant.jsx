import { useState, useRef, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, CheckCircle, AlertCircle, Sparkles, Mic, Zap, Server, Shield, Terminal, MessageCircle, Search, ScrollText, Settings, HelpCircle, ArrowUp, Square } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import toast from 'react-hot-toast'
import { aiAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { useSpeechToText } from '../hooks/useSpeechToText'
import VoiceMeter from '../components/VoiceMeter'

const VOICE_UI = {
  fr: {
    insert: 'Arrêter et insérer',
    send: 'Transcrire et envoyer',
    live: 'Transcription en direct',
    listening: 'Écoute en cours',
    preparing: 'Autorisation du micro…',
  },
  en: {
    insert: 'Stop and insert',
    send: 'Transcribe and send',
    live: 'Live transcript',
    listening: 'Listening',
    preparing: 'Allowing microphone…',
  },
  es: {
    insert: 'Detener e insertar',
    send: 'Transcribir y enviar',
    live: 'Transcripcion en vivo',
    listening: 'Escuchando',
    preparing: 'Autorizando microfono…',
  },
}

function getAssistantErrorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function Message({ msg, locale, actionLabel }) {
  const isUser = msg.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20 border border-neon-violet/30 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-4 h-4 text-neon-violet" />
        </div>
      )}
      <div className={`max-w-[88%] sm:max-w-[80%] ${isUser ? 'order-first' : ''}`}>
        <div className={`px-4 py-3 rounded-2xl text-sm font-body ${
          isUser
            ? 'bg-neon-cyan/10 border border-neon-cyan/20 text-white ml-auto'
            : 'bg-white/[0.04] border border-white/[0.08] text-white/90'
        } break-words`}>
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <ReactMarkdown
              className="prose prose-invert prose-sm max-w-none"
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0 text-white/90">{children}</p>,
                code: ({ children }) => <code className="bg-white/10 px-1.5 py-0.5 rounded font-mono text-neon-cyan text-xs">{children}</code>,
                pre: ({ children }) => <pre className="bg-white/[0.06] border border-white/[0.08] rounded-xl p-3 mt-2 overflow-x-auto">{children}</pre>,
                ul: ({ children }) => <ul className="list-disc list-inside space-y-1 my-2 text-white/80">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside space-y-1 my-2 text-white/80">{children}</ol>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
                strong: ({ children }) => <strong className="text-white font-600">{children}</strong>,
                h3: ({ children }) => <h3 className="text-white font-display font-700 text-base mt-3 mb-1">{children}</h3>,
                h4: ({ children }) => <h4 className="text-white font-display font-600 text-sm mt-2 mb-1">{children}</h4>,
                blockquote: ({ children }) => <blockquote className="border-l-2 border-neon-violet/30 pl-3 my-2 text-white/70 italic">{children}</blockquote>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}
        </div>

        {msg.actionExecuted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`flex items-center gap-2 mt-2 px-3 py-2 rounded-xl text-xs font-mono ${
              msg.actionExecuted.result?.error
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            }`}
          >
            {msg.actionExecuted.result?.error
              ? <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              : <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
            <span className="opacity-60">{actionLabel}:</span>
            <span className="font-600">{msg.actionExecuted.action}</span>
            {msg.actionExecuted.result?.message && !msg.actionExecuted.result?.error && (
              <span className="text-emerald-400/70"> — {msg.actionExecuted.result.message}</span>
            )}
            {msg.actionExecuted.result?.error && (
              <span className="text-red-400/80"> — {msg.actionExecuted.result.error}</span>
            )}
          </motion.div>
        )}

        <p className="text-[10px] text-white/15 font-mono mt-1 px-1">
          {new Date(msg.ts).toLocaleTimeString(locale)}
        </p>
      </div>

      {isUser && (
        <div className="w-9 h-9 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-4 h-4 text-neon-cyan" />
        </div>
      )}
    </motion.div>
  )
}

function getAssistantCopy(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]

  if (key === 'en') {
    return {
      heroTitle: 'DiscordForger co-pilot',
      heroText: 'Specialized in Discord, bot workflows, commands, moderation, and dashboard guidance.',
      helpLabel: 'Help',
      helpAction: 'Help me understand everything you can do on DiscordForger, including commands, moderation, protection, messages, and the current server context.',
      cards: [
        { icon: Server, title: 'Server ops', text: 'Build, clone, organize, and secure Discord servers.' },
        { icon: Shield, title: 'Protection', text: 'Explain modules, moderation flows, and safe actions.' },
        { icon: Terminal, title: 'Commands', text: 'Guide or generate richer Discord command ideas.' },
      ],
    }
  }

  if (key === 'es') {
    return {
      heroTitle: 'Copiloto DiscordForger',
      heroText: 'Especializado en Discord, flujos del bot, comandos, moderacion y guia del dashboard.',
      helpLabel: 'Help',
      helpAction: 'Ayudame a entender todo lo que puedes hacer en DiscordForger, incluyendo comandos, moderacion, proteccion, mensajes y el contexto del servidor actual.',
      cards: [
        { icon: Server, title: 'Servidor', text: 'Construir, clonar, organizar y asegurar servidores Discord.' },
        { icon: Shield, title: 'Proteccion', text: 'Explicar modulos, moderacion y acciones seguras.' },
        { icon: Terminal, title: 'Comandos', text: 'Guiar o generar ideas de comandos mas ricos.' },
      ],
    }
  }

  return {
    heroTitle: 'Copilote DiscordForger',
    heroText: 'Spécialisé Discord, workflows du bot, commandes, modération et accompagnement du dashboard.',
    helpLabel: 'Help',
    helpAction: 'Aide-moi à comprendre tout ce que tu peux faire sur DiscordForger, y compris les commandes, la modération, la protection, les messages et le contexte du serveur actuel.',
    cards: [
      { icon: Server, title: 'Serveur', text: 'Construire, cloner, organiser et sécuriser des serveurs Discord.' },
      { icon: Shield, title: 'Protection', text: 'Expliquer les modules, la modération et les actions sûres.' },
      { icon: Terminal, title: 'Commandes', text: 'Guider ou générer des idées de commandes plus riches.' },
    ],
  }
}

export default function AIAssistant() {
  const { t, locale } = useI18n()
  const assistantCopy = getAssistantCopy(locale)
  const voiceUi = VOICE_UI[String(locale || 'fr').toLowerCase().split('-')[0]] || VOICE_UI.fr
  const [messages, setMessages] = useState(() => ([
    {
      role: 'assistant',
      content: t('assistant.welcome'),
      ts: Date.now(),
    }
  ]))
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [aiStatus, setAiStatus] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const { selectedGuildId, guilds } = useGuildStore()
  const selectedGuild = useMemo(() => guilds.find(g => g.id === selectedGuildId), [guilds, selectedGuildId])
  const speech = useSpeechToText({
    value: input,
    onChange: setInput,
    locale,
    onError: (code) => {
      if (code === 'unsupported') {
        toast.error(t('assistant.voiceUnsupported'))
        return
      }
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        toast.error(t('assistant.voiceDenied'))
        return
      }
      if (code === 'aborted') return
      toast.error(t('assistant.voiceError'))
    },
  })
  const speechActive = speech.isListening || speech.isRequestingPermission || speech.isProcessing

  useEffect(() => {
    aiAPI.status().then((r) => setAiStatus(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (text) => {
    if (loading) return

    const resolvedText = typeof text === 'string' && text.trim()
      ? text.trim()
      : (speechActive ? await speech.stop() : input.trim())
    const msg = resolvedText.trim()
    if (!msg || loading) return
    setInput('')
    setLoading(true)

    const userMsg = { role: 'user', content: msg, ts: Date.now() }
    setMessages((prev) => [...prev, userMsg])

    try {
      const history = messages.slice(-10).map((message) => ({ role: message.role, content: message.content }))
      const res = await aiAPI.chat({
        message: msg,
        guild_id: selectedGuildId || undefined,
        conversation_history: history,
      })

      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: res.data.message,
        actionExecuted: res.data.actionExecuted,
        ts: Date.now(),
      }])
    } catch (err) {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: '⚠️ ' + getAssistantErrorMessage(err, t('assistant.unavailable')),
        ts: Date.now(),
      }])
    }

    setLoading(false)
  }

  const stopDictation = async () => {
    await speech.stop()
    inputRef.current?.focus()
  }

  const sendDictation = async () => {
    const transcript = await speech.stop()
    await send(transcript)
  }

  return (
    <div className="flex flex-col h-full max-h-screen overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 p-4 sm:p-6 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20 border border-neon-violet/30 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-neon-violet" />
          </div>
          <div>
            <h1 className="font-display font-700 text-lg text-white">{t('assistant.title')}</h1>
            <p className="text-xs text-white/40">
              {aiStatus?.configured
                ? <span className="text-emerald-400 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" /> {t('assistant.ready')}</span>
                : <span className="text-amber-400">! {t('assistant.notConfigured')}</span>}
            </p>
          </div>
        </div>
        {selectedGuild && (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/8 bg-white/[0.02] text-white/40 text-xs font-mono">
            <Server className="w-3 h-3" />
            {selectedGuild.name}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6 space-y-4">
        <AnimatePresence>
          {messages.map((msg, index) => <Message key={index} msg={msg} locale={locale} actionLabel={t('assistant.actionLabel')} />)}
        </AnimatePresence>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="w-9 h-9 rounded-xl bg-neon-violet/10 border border-neon-violet/20 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-neon-violet" />
            </div>
            <div className="px-4 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.08]">
              <div className="flex gap-1.5 items-center py-1">
                {[0, 1, 2].map((dot) => (
                  <motion.div
                    key={dot}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: dot * 0.15 }}
                    className="w-1.5 h-1.5 rounded-full bg-neon-violet/60"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && (
        <div className="px-4 sm:px-6 pb-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => send(assistantCopy.helpAction)}
              className="feature-chip text-white/75 hover:text-white"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              {assistantCopy.helpLabel}
            </button>
          </div>
        </div>
      )}

      <div className="p-3 sm:p-4 border-t border-white/[0.06] shrink-0">
        <div className="space-y-2">
          <AnimatePresence>
            {speechActive && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-[24px] border border-white/[0.08] bg-white/[0.03] p-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <VoiceMeter
                        bars={speech.audioBars}
                        active={speech.isListening}
                        processing={speech.isRequestingPermission || speech.isProcessing}
                        accent={speech.isRequestingPermission ? 'amber' : 'violet'}
                      />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-mono ${speech.isRequestingPermission || speech.isProcessing ? 'text-amber-300/80' : 'text-neon-violet/80'}`}>
                          {speech.isRequestingPermission ? voiceUi.preparing : speech.isProcessing ? voiceUi.send : voiceUi.listening}
                        </p>
                        <p className="mt-1 text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">{voiceUi.live}</p>
                        <p className="mt-2 min-h-[54px] max-w-full rounded-2xl border border-white/8 bg-black/20 px-3 py-3 text-sm text-white/78">
                          {speech.liveTranscript || speech.interimTranscript || '…'}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={stopDictation}
                        disabled={speech.isRequestingPermission}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-2.5 text-xs font-mono text-white/80 transition-all hover:border-white/20 hover:text-white disabled:opacity-50"
                      >
                        <Square className="h-3.5 w-3.5 fill-current" />
                        {voiceUi.insert}
                      </button>
                      <button
                        type="button"
                        onClick={sendDictation}
                        disabled={speech.isRequestingPermission || loading}
                        className="inline-flex items-center gap-2 rounded-2xl border border-neon-violet/25 bg-neon-violet/12 px-4 py-2.5 text-xs font-mono text-violet-100 transition-all hover:bg-neon-violet/18 disabled:opacity-50"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                        {voiceUi.send}
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder={t('assistant.placeholder')}
              className="input-field resize-none min-h-[56px] max-h-36 py-3 pr-[120px] sm:pr-[148px] font-body"
              rows={1}
              style={{ height: 'auto' }}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {speechActive ? (
                <>
                  <motion.button
                    type="button"
                    onClick={stopDictation}
                    disabled={speech.isRequestingPermission || speech.isProcessing}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="h-11 w-11 rounded-full border border-white/12 bg-white/[0.06] text-white/88 flex items-center justify-center transition-all shrink-0 disabled:opacity-55"
                    title={voiceUi.insert}
                  >
                    <Square className="h-4 w-4 fill-current" />
                  </motion.button>
                  <motion.button
                    type="button"
                    onClick={sendDictation}
                    disabled={speech.isRequestingPermission || speech.isProcessing || loading}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="h-11 w-11 rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan flex items-center justify-center text-white shadow-neon-violet disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
                    title={voiceUi.send}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </motion.button>
                </>
              ) : (
                <>
                  <motion.button
                    type="button"
                    onClick={() => speech.start()}
                    disabled={speech.isRequestingPermission}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="h-11 w-11 rounded-full border border-white/12 bg-white/[0.06] text-white/85 hover:border-neon-violet/35 hover:bg-neon-violet/10 hover:text-neon-violet flex items-center justify-center transition-all shrink-0 disabled:opacity-70"
                    title={t('assistant.voiceStart')}
                  >
                    <Mic className="w-4 h-4" />
                  </motion.button>
                  <motion.button
                    onClick={() => send()}
                    disabled={!input.trim() || loading}
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="h-11 w-11 rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan flex items-center justify-center text-white shadow-neon-violet disabled:opacity-40 disabled:cursor-not-allowed transition-opacity shrink-0"
                  >
                    {loading
                      ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      : <Send className="w-4 h-4" />}
                  </motion.button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
