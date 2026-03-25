import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Bot, User, CheckCircle, AlertCircle, Sparkles, Mic } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import toast from 'react-hot-toast'
import { aiAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'
import { useSpeechToText } from '../hooks/useSpeechToText'
import VoiceMeter from '../components/VoiceMeter'

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
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20 border border-neon-violet/30 flex items-center justify-center shrink-0 mt-0.5">
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
                li: ({ children }) => <li className="text-sm">{children}</li>,
                strong: ({ children }) => <strong className="text-white font-600">{children}</strong>,
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
            className={`flex items-center gap-2 mt-2 px-3 py-1.5 rounded-lg text-xs font-mono ${
              msg.actionExecuted.result?.error
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : 'bg-green-500/10 border border-green-500/20 text-green-400'
            }`}
          >
            {msg.actionExecuted.result?.error
              ? <AlertCircle className="w-3 h-3" />
              : <CheckCircle className="w-3 h-3" />}
            <span className="opacity-60">{actionLabel}:</span> {msg.actionExecuted.action}
            {msg.actionExecuted.result?.error && <span className="text-red-400/80"> - {msg.actionExecuted.result.error}</span>}
          </motion.div>
        )}

        <p className="text-xs text-white/20 font-mono mt-1 px-1">
          {new Date(msg.ts).toLocaleTimeString(locale)}
        </p>
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20 flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-4 h-4 text-neon-cyan" />
        </div>
      )}
    </motion.div>
  )
}

export default function AIAssistant() {
  const { t, locale } = useI18n()
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
  const { selectedGuildId } = useGuildStore()
  const suggestions = t('assistant.suggestions', [])
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

  useEffect(() => {
    aiAPI.status().then((r) => setAiStatus(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (text) => {
    const msg = text || input.trim()
    if (!msg || loading) return
    if (speech.isListening) speech.stop()
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
        content: 'X ' + getAssistantErrorMessage(err, t('assistant.unavailable')),
        ts: Date.now(),
      }])
    }

    setLoading(false)
  }

  return (
    <div className="flex flex-col h-full max-h-screen overflow-x-hidden">
      <div className="flex items-center gap-3 p-4 sm:p-6 border-b border-white/[0.06] shrink-0">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20 border border-neon-violet/30 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-neon-violet" />
        </div>
        <div>
          <h1 className="font-display font-700 text-lg text-white">{t('assistant.title')}</h1>
          <p className="text-xs text-white/40">
            {aiStatus?.configured
              ? <span className="text-green-400">● {t('assistant.ready')}</span>
              : <span className="text-amber-400">! {t('assistant.notConfigured')}</span>}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-none p-4 sm:p-6 space-y-4">
        <AnimatePresence>
          {messages.map((msg, index) => <Message key={index} msg={msg} locale={locale} actionLabel={t('assistant.actionLabel')} />)}
        </AnimatePresence>

        {loading && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-neon-violet/10 border border-neon-violet/20 flex items-center justify-center shrink-0">
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
        <div className="px-4 sm:px-6 pb-2 flex gap-2 flex-wrap">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => send(suggestion)}
              className="px-3 py-1.5 rounded-lg text-xs font-mono text-neon-cyan/60 hover:text-neon-cyan border border-neon-cyan/10 hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-all duration-200"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      <div className="p-3 sm:p-4 border-t border-white/[0.06] shrink-0">
        <div className="space-y-2">
          {(speech.isListening || speech.isRequestingPermission) && (
            <p className={`text-xs font-mono ${speech.isRequestingPermission ? 'text-amber-300/80' : 'text-neon-cyan/70'}`}>
              {speech.isRequestingPermission ? t('assistant.voicePreparing') : t('assistant.voiceListening')}
            </p>
          )}

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
              {(speech.isListening || speech.isRequestingPermission) && (
                <VoiceMeter
                  bars={speech.audioBars}
                  active={speech.isListening}
                  accent={speech.isRequestingPermission ? 'amber' : 'violet'}
                />
              )}
              <motion.button
                type="button"
                onClick={() => (speech.isListening ? speech.stop() : speech.start())}
                disabled={speech.isRequestingPermission}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className={`h-11 w-11 rounded-full border flex items-center justify-center transition-all shrink-0 disabled:opacity-70 ${
                  speech.isListening
                    ? 'border-red-500/35 bg-red-500/14 text-red-200 shadow-[0_0_20px_rgba(248,113,113,0.2)]'
                    : speech.isRequestingPermission
                      ? 'border-amber-400/35 bg-amber-400/12 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.18)]'
                      : 'border-white/12 bg-white/[0.06] text-white/85 hover:border-neon-cyan/35 hover:bg-neon-cyan/10 hover:text-neon-cyan'
                }`}
                title={speech.isListening ? t('assistant.voiceStop') : t('assistant.voiceStart')}
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
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
