import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bot, Key, ExternalLink, CheckCircle, AlertCircle, ArrowRight } from 'lucide-react'
import { authAPI } from '../services/api'
import { useAuthStore } from '../stores'
import AuthSnowBackdrop from '../components/AuthSnowBackdrop'
import { getQuickBotToken, setQuickBotToken } from '../utils/quickBotToken'
import { useI18n } from '../i18n'

function getErrorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function getMaskedQuickToken(token) {
  if (!token) return ''
  return '••••••••••••••••••••••••'
}

export default function SetupPage() {
  const { t } = useI18n()
  const [token, setToken] = useState('')
  const [quickToken, setSavedQuickToken] = useState('')
  const [status, setStatus] = useState(null)
  const [botInfo, setBotInfo] = useState(null)
  const [error, setError] = useState('')
  const { user, fetchMe } = useAuthStore()
  const navigate = useNavigate()
  const quickTokenOwner = { id: user?.id, email: user?.email }
  const steps = t('setup.steps', [])
  const stepResources = [
    {
      href: 'https://discord.com/developers/applications?new_application=true',
      hint: t('setup.stepGuides.createApp'),
    },
    {
      href: 'https://discord.com/developers/applications/select/bot',
      hint: t('setup.stepGuides.createBot'),
    },
    {
      href: 'https://discord.com/developers/applications/select/bot',
      hint: t('setup.stepGuides.enableIntents'),
    },
    {
      href: 'https://discord.com/developers/applications/select/bot',
      hint: t('setup.stepGuides.copyToken'),
    },
  ]

  useEffect(() => {
    let active = true

    const loadQuickToken = async () => {
      const savedToken = await getQuickBotToken(quickTokenOwner)
      if (!active) return
      setSavedQuickToken(savedToken)
      setToken((currentToken) => currentToken || savedToken)
    }

    loadQuickToken()

    return () => {
      active = false
    }
  }, [quickTokenOwner])

  const submit = async (event) => {
    event.preventDefault()
    if (!token.trim()) return
    setStatus('loading')
    setError('')
    try {
      const normalizedToken = token.trim()
      const response = await authAPI.setBotToken(normalizedToken)
      await setQuickBotToken(quickTokenOwner, normalizedToken)
      setSavedQuickToken(normalizedToken)
      setToken('')
      setBotInfo(response.data.bot)
      setStatus('success')
      await fetchMe()
    } catch (err) {
      setStatus('error')
      setError(getErrorMessage(err, t('setup.invalidToken')))
    }
  }

  return (
    <div className="app-screen-scroll setup-mobile-shell bg-surface-0 flex items-center justify-center relative p-4">
      <AuthSnowBackdrop className="z-0" />

      <div className="setup-mobile-card relative z-10 w-full max-w-2xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20 border border-neon-violet/30 mb-4 shadow-neon-violet">
              <Key className="w-7 h-7 text-neon-violet" />
            </div>
            <h1 className="font-display font-800 text-2xl text-white mb-1">{t('setup.title')}</h1>
            <p className="text-white/40 text-sm">{t('setup.subtitle')}</p>
          </div>

          <div className="setup-mobile-guide grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {steps.map(({ title, desc }, index) => (
              <div key={`${index}-${title}`} className="glass-card p-3.5 sm:p-4 flex items-start gap-3 min-w-0">
                <span className="font-mono text-xs text-neon-cyan/60 mt-0.5 shrink-0">{String(index + 1).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-1.5 mb-0.5 min-w-0">
                    <p className="text-sm font-display font-600 text-white break-words min-w-0 flex-1">{title}</p>
                    {stepResources[index]?.href && (
                      <a
                        href={stepResources[index].href}
                        target="_blank"
                        rel="noreferrer"
                        title={stepResources[index].hint}
                        aria-label={stepResources[index].hint}
                        className="text-neon-cyan/50 hover:text-neon-cyan transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <p className="text-xs text-white/40 break-words">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="gradient-border p-px rounded-2xl">
            <div className="bg-surface-1 rounded-2xl p-6">
              {status === 'success' && botInfo ? (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="text-center py-4">
                  <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
                  <p className="font-display font-600 text-lg text-white mb-1">{t('setup.connected')}</p>
                  <div className="flex items-center justify-center gap-2 mb-4">
                    {botInfo.avatarUrl && <img src={botInfo.avatarUrl} className="w-8 h-8 rounded-full" alt="" />}
                    <span className="font-mono text-neon-cyan">{botInfo.username}</span>
                    <span className="text-white/30 text-sm">#{botInfo.discriminator}</span>
                  </div>
                  <button onClick={() => navigate('/dashboard/servers')} className="btn-primary inline-flex items-center gap-2">
                    {t('setup.goServers', 'Choisir un serveur')} <ArrowRight className="w-4 h-4" />
                  </button>
                </motion.div>
              ) : (
                <form onSubmit={submit} className="space-y-4" autoComplete="off">
                  <div>
                    <label className="block text-xs font-mono text-white/40 mb-2 uppercase tracking-wider">{t('settings.quickTokenTitle')}</label>
                    {quickToken ? (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          className="input-field secret-field sm:flex-1"
                          value={getMaskedQuickToken(quickToken)}
                          readOnly
                          name="saved-bot-secret-preview"
                          autoComplete="one-time-code"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                          inputMode="text"
                          data-lpignore="true"
                          data-1p-ignore="true"
                          data-bwignore="true"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            setToken(quickToken)
                            setError('')
                            setStatus(null)
                          }}
                          className="px-4 py-3 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.06] transition-all"
                        >
                          {t('settings.quickTokenUse')}
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-3 text-xs text-white/35">
                        {t('settings.quickTokenEmpty')}
                      </div>
                    )}
                    <p className="mt-2 text-xs text-white/30">{t('settings.quickTokenHint')}</p>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-white/40 mb-2 uppercase tracking-wider">{t('settings.botTokenTitle')}</label>
                    <div className="relative">
                      <Bot className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
                      <input
                        type="text"
                        className="input-field secret-field pl-10"
                        placeholder={t('settings.botTokenPlaceholder')}
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                        name="bot-secret-entry"
                        autoComplete="one-time-code"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        inputMode="text"
                        data-lpignore="true"
                        data-1p-ignore="true"
                        data-bwignore="true"
                        required
                      />
                    </div>
                    {status === 'error' && (
                      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-1.5 mt-2 text-red-400 text-sm">
                        <AlertCircle className="w-3.5 h-3.5" /> {error}
                      </motion.p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                    <p className="text-xs text-amber-400/80">{t('setup.encrypted')}</p>
                  </div>

                  <motion.button
                    type="submit"
                    disabled={status === 'loading'}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                    className="w-full py-3 rounded-xl font-display font-600 bg-gradient-to-r from-neon-violet/80 to-neon-cyan/80 hover:from-neon-violet hover:to-neon-cyan text-white transition-all duration-200 disabled:opacity-50"
                  >
                    {status === 'loading' ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {t('setup.validating')}
                      </span>
                    ) : t('setup.validateConnect')}
                  </motion.button>
                </form>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
