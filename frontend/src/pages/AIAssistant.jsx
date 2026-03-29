import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowUp,
  Bot,
  CheckCircle,
  Download,
  HelpCircle,
  Image as ImageIcon,
  Link2,
  Mic,
  Copy,
  Send,
  Server,
  Sparkles,
  Square,
  User,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import toast from 'react-hot-toast'
import { aiAPI, authAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { useSpeechToText } from '../hooks/useSpeechToText'
import { openDiscordLinkPopup } from '../utils/discordLinkPopup'

const ASSISTANT_MESSAGE_LIMIT = 20

const VOICE_UI = {
  fr: {
    stop: 'Arreter',
    send: 'Envoyer quand le texte est pret',
  },
  en: {
    stop: 'Stop',
    send: 'Send when text is ready',
  },
  es: {
    stop: 'Detener',
    send: 'Enviar cuando el texto este listo',
  },
}

function getAssistantErrorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function createWelcomeMessage(content) {
  return {
    role: 'assistant',
    content,
    ts: Date.now(),
    isWelcome: true,
  }
}

function getAssistantStorageKey(userId, guildId) {
  // Scope the saved thread to the current user and selected workspace.
  return `discordforger:ai-assistant:${String(userId || 'guest')}:${String(guildId || 'global')}`
}

function sanitizeMessagesForStorage(messages = []) {
  return messages
    .filter((message) => message?.role === 'user' || message?.role === 'assistant')
    .slice(-ASSISTANT_MESSAGE_LIMIT)
    .map((message) => ({
      role: message.role,
      content: String(message.content || ''),
      ts: Number(message.ts || Date.now()),
      isWelcome: Boolean(message.isWelcome),
      actionExecuted: message.actionExecuted || null,
      requiresDiscordLink: Boolean(message.requiresDiscordLink),
      pendingAction: message.pendingAction || null,
    }))
}

function readStoredConversation(storageKey, welcomeContent) {
  if (typeof window === 'undefined') return [createWelcomeMessage(welcomeContent)]

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return [createWelcomeMessage(welcomeContent)]
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [createWelcomeMessage(welcomeContent)]
    }
    return parsed
  } catch {
    return [createWelcomeMessage(welcomeContent)]
  }
}

function buildHistory(messages) {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: String(message.content || '').slice(0, 700),
    }))
}

function getButtonCopy(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  if (key === 'en') {
    return {
      link: 'Link Discord and continue',
      continue: 'Continue action',
      download: 'Download',
      copy: 'Copy',
    }
  }
  if (key === 'es') {
    return {
      link: 'Vincular Discord y continuar',
      continue: 'Continuar accion',
      download: 'Descargar',
      copy: 'Copiar',
    }
  }
  return {
    link: 'Lier Discord et continuer',
    continue: 'Continuer',
    download: 'Telecharger',
    copy: 'Copier',
  }
}

function Message({
  msg,
  locale,
  actionLabel,
  onLinkDiscord,
  onDownloadImage,
  onCopyImage,
  linkingDiscord,
}) {
  const isUser = msg.role === 'user'
  const buttonCopy = getButtonCopy(locale)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {!isUser && (
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neon-violet/30 bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20">
          <Bot className="h-4 w-4 text-neon-violet" />
        </div>
      )}

      <div className={`max-w-[88%] sm:max-w-[80%] ${isUser ? 'order-first' : ''}`}>
        <div
          className={`break-words rounded-2xl px-4 py-3 text-sm font-body ${
            isUser
              ? 'ml-auto border border-neon-cyan/20 bg-neon-cyan/10 text-white'
              : 'border border-white/[0.08] bg-white/[0.04] text-white/90'
          }`}
        >
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <ReactMarkdown
              className="prose prose-invert prose-sm max-w-none"
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0 text-white/90">{children}</p>,
                code: ({ children }) => <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-neon-cyan">{children}</code>,
                pre: ({ children }) => <pre className="mt-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.06] p-3">{children}</pre>,
                ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 text-white/80">{children}</ul>,
                ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 text-white/80">{children}</ol>,
                strong: ({ children }) => <strong className="font-600 text-white">{children}</strong>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
          )}

          {msg.generatedImage && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <img
                src={msg.generatedImage.dataUrl}
                alt={msg.generatedImage.prompt || 'Generation IA'}
                className="block max-h-[420px] w-full object-cover"
              />
              <div className="flex flex-wrap gap-2 border-t border-white/10 p-3">
                <button
                  type="button"
                  onClick={() => onDownloadImage?.(msg.generatedImage)}
                  className="feature-chip text-white/80 hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  {buttonCopy.download}
                </button>
                <button
                  type="button"
                  onClick={() => onCopyImage?.(msg.generatedImage)}
                  className="feature-chip text-white/80 hover:text-white"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {buttonCopy.copy}
                </button>
              </div>
            </div>
          )}

          {msg.requiresDiscordLink && msg.pendingAction && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => onLinkDiscord?.(msg.pendingAction)}
                disabled={linkingDiscord}
                className="feature-chip text-white/85 hover:text-white disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" />
                {linkingDiscord ? buttonCopy.continue : buttonCopy.link}
              </button>
            </div>
          )}
        </div>

        {msg.actionExecuted && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className={`mt-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-mono ${
              msg.actionExecuted.result?.error
                ? 'border border-red-500/20 bg-red-500/10 text-red-400'
                : 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
            }`}
          >
            {msg.actionExecuted.result?.error ? (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="opacity-60">{actionLabel}:</span>
            <span className="font-600">{msg.actionExecuted.action}</span>
            <span className="opacity-80">
              {msg.actionExecuted.result?.error || msg.actionExecuted.result?.message || ''}
            </span>
          </motion.div>
        )}

        <p className="mt-1 px-1 font-mono text-[10px] text-white/20">
          {new Date(msg.ts).toLocaleTimeString(locale)}
        </p>
      </div>

      {isUser && (
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neon-cyan/20 bg-neon-cyan/10">
          <User className="h-4 w-4 text-neon-cyan" />
        </div>
      )}
    </motion.div>
  )
}

export default function AIAssistant() {
  const { t, locale } = useI18n()
  const voiceUi = VOICE_UI[String(locale || 'fr').toLowerCase().split('-')[0]] || VOICE_UI.fr
  const { selectedGuildId, guilds } = useGuildStore()
  const { user, fetchMe } = useAuthStore()
  const storageKey = useMemo(
    () => getAssistantStorageKey(user?.id, selectedGuildId),
    [user?.id, selectedGuildId]
  )
  const [messages, setMessages] = useState(() => [createWelcomeMessage(t('assistant.welcome'))])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [linkingDiscord, setLinkingDiscord] = useState(false)
  const [aiStatus, setAiStatus] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const restoredKeyRef = useRef('')

  const selectedGuild = useMemo(
    () => guilds.find((guild) => guild.id === selectedGuildId),
    [guilds, selectedGuildId]
  )

  const speech = useSpeechToText({
    value: input,
    onChange: setInput,
    locale,
    onError: (code) => {
      if (code === 'unsupported') return toast.error(t('assistant.voiceUnsupported'))
      if (code === 'not-allowed' || code === 'service-not-allowed') return toast.error(t('assistant.voiceDenied'))
      if (code === 'aborted') return
      toast.error(t('assistant.voiceError'))
    },
  })
  const speechActive = speech.isListening || speech.isRequestingPermission || speech.isProcessing

  useEffect(() => {
    aiAPI.status().then((response) => setAiStatus(response.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (restoredKeyRef.current === storageKey) return
    restoredKeyRef.current = storageKey
    setMessages(readStoredConversation(storageKey, t('assistant.welcome')))
  }, [storageKey, t])

  useEffect(() => {
    if (typeof window === 'undefined' || !storageKey) return
    window.localStorage.setItem(storageKey, JSON.stringify(sanitizeMessagesForStorage(messages)))
  }, [messages, storageKey])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const conversationMessageCount = useMemo(
    () => messages.filter((message) => !message.isWelcome && (message.role === 'user' || message.role === 'assistant')).length,
    [messages]
  )
  const limitReached = conversationMessageCount >= ASSISTANT_MESSAGE_LIMIT

  const appendAssistantPayload = (payload) => {
    setMessages((prev) => [
      ...prev,
      {
        role: 'assistant',
        content: payload?.message || t('assistant.unavailable'),
        actionExecuted: payload?.actionExecuted || null,
        generatedImage: payload?.generatedImage || null,
        requiresDiscordLink: Boolean(payload?.requiresDiscordLink),
        pendingAction: payload?.pendingAction || null,
        ts: Date.now(),
      },
    ])
  }

  const send = async (text) => {
    if (loading || limitReached) {
      if (limitReached) toast.error('Conversation pleine. Lance une nouvelle conversation.')
      return
    }

    const resolvedText = typeof text === 'string' && text.trim()
      ? text.trim()
      : (speechActive ? await speech.stop() : input.trim())
    const messageText = String(resolvedText || '').trim()
    if (!messageText || loading) return

    const userMessage = { role: 'user', content: messageText, ts: Date.now() }
    const history = buildHistory([...messages, userMessage])

    setInput('')
    setLoading(true)
    setMessages((prev) => [...prev, userMessage])

    try {
      const response = await aiAPI.chat({
        message: messageText,
        guild_id: selectedGuildId || undefined,
        conversation_history: history,
      })
      appendAssistantPayload(response.data)
    } catch (error) {
      appendAssistantPayload({
        message: `⚠️ ${getAssistantErrorMessage(error, t('assistant.unavailable'))}`,
      })
    } finally {
      setLoading(false)
    }
  }

  const continuePendingAction = async (pendingAction) => {
    if (!pendingAction || linkingDiscord || limitReached) return

    try {
      setLinkingDiscord(true)

      if (!user?.discord_id) {
        const returnTo = `${window.location.pathname}${window.location.search}`
        const response = await authAPI.createDiscordLink({ return_to: returnTo, mode: 'popup' })
        const nextUrl = response?.data?.url
        if (!nextUrl) throw new Error('Lien Discord indisponible')
        await openDiscordLinkPopup(nextUrl)
        await fetchMe()
      }

      const response = await aiAPI.continueAction({
        guild_id: selectedGuildId || undefined,
        pending_action: pendingAction,
      })
      appendAssistantPayload(response.data)
    } catch (error) {
      toast.error(getAssistantErrorMessage(error, 'Liaison Discord impossible'))
    } finally {
      setLinkingDiscord(false)
    }
  }

  const stopDictation = async () => {
    await speech.stop()
    inputRef.current?.focus()
  }

  const sendDictation = async () => {
    if (limitReached) {
      toast.error('Conversation pleine. Lance une nouvelle conversation.')
      return
    }
    const transcript = await speech.stop()
    await send(transcript)
  }

  const resetConversation = () => {
    const nextMessages = [createWelcomeMessage(t('assistant.welcome'))]
    setMessages(nextMessages)
    setInput('')
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey)
    }
  }

  const handleDownloadImage = (image) => {
    if (!image?.dataUrl) return
    const anchor = document.createElement('a')
    anchor.href = image.dataUrl
    anchor.download = `discordforger-${Date.now()}.${String(image.mimeType || 'image/png').split('/')[1] || 'png'}`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  }

  const handleCopyImage = async (image) => {
    if (!image?.dataUrl) return

    try {
      const response = await fetch(image.dataUrl)
      const blob = await response.blob()

      if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            [blob.type]: blob,
          }),
        ])
        toast.success('Image copiee')
        return
      }

      await navigator.clipboard.writeText(image.dataUrl)
      toast.success('Image copiee')
    } catch {
      toast.error('Copie impossible')
    }
  }

  return (
    <div className="flex h-full max-h-screen flex-col overflow-x-hidden">
      <div className="shrink-0 border-b border-white/[0.06] p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-neon-violet/30 bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20">
              <Sparkles className="h-5 w-5 text-neon-violet" />
            </div>
            <div>
              <h1 className="font-display text-lg font-700 text-white">{t('assistant.title')}</h1>
              <p className="text-xs text-white/40">
                {aiStatus?.configured ? (
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {t('assistant.ready')}
                  </span>
                ) : (
                  <span className="text-amber-400">{t('assistant.notConfigured')}</span>
                )}
              </p>
            </div>
          </div>

          {selectedGuild && (
            <div className="hidden items-center gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-1.5 font-mono text-xs text-white/40 sm:flex">
              <Server className="h-3 w-3" />
              {selectedGuild.name}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden p-4 scrollbar-none sm:p-6">
        {limitReached && (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>Conversation pleine. Lance une nouvelle conversation pour continuer.</span>
              <button
                type="button"
                onClick={resetConversation}
                className="feature-chip text-white/85 hover:text-white"
              >
                Nouvelle conversation
              </button>
            </div>
          </div>
        )}

        {messages.length <= 1 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => send('Help me understand everything you can do on DiscordForger for the current server.')}
              className="feature-chip text-white/75 hover:text-white"
            >
              <HelpCircle className="h-3.5 w-3.5" />
              Help
            </button>
          </div>
        )}

        <AnimatePresence>
          {messages.map((message, index) => (
            <Message
              key={`${message.ts}-${index}`}
              msg={message}
              locale={locale}
              actionLabel={t('assistant.actionLabel')}
              onLinkDiscord={continuePendingAction}
              onDownloadImage={handleDownloadImage}
              onCopyImage={handleCopyImage}
              linkingDiscord={linkingDiscord}
            />
          ))}
        </AnimatePresence>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-neon-violet/20 bg-neon-violet/10">
              <Bot className="h-4 w-4 text-neon-violet" />
            </div>
            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3">
              <div className="flex items-center gap-1.5 py-1">
                {[0, 1, 2].map((dot) => (
                  <motion.div
                    key={dot}
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 0.6, repeat: Infinity, delay: dot * 0.15 }}
                    className="h-1.5 w-1.5 rounded-full bg-neon-violet/60"
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="shrink-0 border-t border-white/[0.06] p-3 sm:p-4">
        <div className="relative">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
            placeholder={t('assistant.placeholder')}
            className="input-field min-h-[56px] max-h-36 resize-none py-3 pr-[120px] font-body sm:pr-[148px]"
            rows={1}
            style={{ height: 'auto' }}
          />

          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            {speechActive ? (
              <>
                <motion.button
                  type="button"
                  onClick={stopDictation}
                  disabled={speech.isRequestingPermission || loading || limitReached}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/88 transition-all disabled:opacity-55"
                  title={voiceUi.stop}
                >
                  <Square className="h-4 w-4 fill-current" />
                </motion.button>
                <motion.button
                  type="button"
                  onClick={sendDictation}
                  disabled={speech.isRequestingPermission || loading || limitReached}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan text-white shadow-neon-violet transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
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
                  disabled={speech.isRequestingPermission || limitReached}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/12 bg-white/[0.06] text-white/85 transition-all hover:border-neon-violet/35 hover:bg-neon-violet/10 hover:text-neon-violet disabled:opacity-70"
                  title={t('assistant.voiceStart')}
                >
                  <Mic className="h-4 w-4" />
                </motion.button>
                <motion.button
                  type="button"
                  onClick={() => send()}
                  disabled={!input.trim() || loading || limitReached}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-neon-violet to-neon-cyan text-white shadow-neon-violet transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </motion.button>
              </>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-white/35">
          <span className="feature-chip">
            <ImageIcon className="h-3 w-3" />
            Image IA
          </span>
          <span className="feature-chip">
            <Link2 className="h-3 w-3" />
            Liaison Discord auto
          </span>
        </div>
      </div>
    </div>
  )
}
