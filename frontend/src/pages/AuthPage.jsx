import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Bot, Shield, Zap, AlertCircle, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import SnowCanvas from '../components/SnowCanvas'
import { authAPI } from '../services/api'
import { useAuthStore } from '../stores'
import { useI18n } from '../i18n'

function DiscordMark(props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M20.317 4.369A19.791 19.791 0 0 0 15.885 3c-.191.335-.403.78-.554 1.135a18.27 18.27 0 0 0-5.098 0A12.64 12.64 0 0 0 9.677 3a19.736 19.736 0 0 0-4.434 1.37C2.44 8.603 1.681 12.73 2.06 16.8a19.9 19.9 0 0 0 5.433 2.73c.437-.59.826-1.214 1.16-1.87a12.85 12.85 0 0 1-1.826-.873c.154-.113.305-.23.45-.35 3.52 1.65 7.34 1.65 10.819 0 .148.12.299.237.45.35-.58.34-1.192.633-1.829.874.335.654.724 1.279 1.162 1.868a19.867 19.867 0 0 0 5.435-2.73c.445-4.716-.76-8.805-3.562-12.43ZM9.05 14.595c-1.057 0-1.924-.97-1.924-2.16 0-1.19.847-2.16 1.922-2.16 1.084 0 1.94.98 1.923 2.16 0 1.19-.848 2.16-1.922 2.16Zm5.906 0c-1.058 0-1.923-.97-1.923-2.16 0-1.19.846-2.16 1.923-2.16 1.083 0 1.939.98 1.922 2.16 0 1.19-.847 2.16-1.922 2.16Z" />
    </svg>
  )
}

function GoogleMark(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path fill="#EA4335" d="M12.24 10.285v3.955h5.496c-.242 1.272-.967 2.35-2.059 3.075l3.327 2.583c1.94-1.787 3.058-4.42 3.058-7.553 0-.725-.065-1.421-.185-2.06H12.24Z" />
      <path fill="#34A853" d="M12 22c2.76 0 5.078-.913 6.77-2.47l-3.327-2.583c-.924.62-2.103.988-3.443.988-2.647 0-4.89-1.786-5.69-4.19H2.87v2.666A9.997 9.997 0 0 0 12 22Z" />
      <path fill="#4A90E2" d="M6.31 13.745A5.996 5.996 0 0 1 6 11.82c0-.668.114-1.318.31-1.925V7.229H2.87A9.997 9.997 0 0 0 2 11.82c0 1.61.386 3.134.87 4.591l3.44-2.666Z" />
      <path fill="#FBBC05" d="M12 5.706c1.5 0 2.847.516 3.907 1.529l2.928-2.928C17.073 2.668 14.755 1.64 12 1.64a9.997 9.997 0 0 0-9.13 5.589l3.44 2.666c.8-2.404 3.043-4.19 5.69-4.19Z" />
    </svg>
  )
}

export default function AuthPage() {
  const { t } = useI18n()
  const [mode, setMode] = useState('login')
  const [showPass, setShowPass] = useState(false)
  const [activeFeature, setActiveFeature] = useState('secure')
  const [form, setForm] = useState({ email: '', username: '', password: '' })
  const [error, setError] = useState('')
  const [accessChecked, setAccessChecked] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [oauthProviders, setOauthProviders] = useState({ discord: false, google: false })
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register, isLoading } = useAuthStore()
  const blockedHint = useMemo(() => new URLSearchParams(location.search).get('blocked') === '1', [location.search])

  const featureCards = [
    {
      key: 'secure',
      icon: Shield,
      label: t('auth.features.secure'),
      description: t('auth.features.secureDesc', 'Connexion protégée et accès verrouillé en toute sécurité.'),
      iconClass: 'text-neon-cyan',
      iconBgClass: 'border-neon-cyan/20 bg-neon-cyan/10',
      activeClass: 'border-neon-cyan/30 bg-gradient-to-br from-neon-cyan/16 to-neon-cyan/4 shadow-[0_0_30px_rgba(0,229,255,0.14)]',
      lineClass: 'from-neon-cyan/0 via-neon-cyan/70 to-neon-cyan/0',
    },
    {
      key: 'realtime',
      icon: Zap,
      label: t('auth.features.realtime'),
      description: t('auth.features.realtimeDesc', 'Statuts, synchronisation et actions instantanées sur ton bot.'),
      iconClass: 'text-neon-violet',
      iconBgClass: 'border-neon-violet/20 bg-neon-violet/10',
      activeClass: 'border-neon-violet/30 bg-gradient-to-br from-neon-violet/16 to-neon-violet/4 shadow-[0_0_30px_rgba(176,78,255,0.14)]',
      lineClass: 'from-neon-violet/0 via-neon-violet/70 to-neon-violet/0',
    },
    {
      key: 'ai',
      icon: Bot,
      label: t('auth.features.ai'),
      description: t('auth.features.aiDesc', 'Assistant intégré pour configurer et piloter ton site plus vite.'),
      iconClass: 'text-green-400',
      iconBgClass: 'border-green-400/20 bg-green-400/10',
      activeClass: 'border-green-400/25 bg-gradient-to-br from-green-400/16 to-green-400/4 shadow-[0_0_30px_rgba(74,222,128,0.14)]',
      lineClass: 'from-green-400/0 via-green-400/70 to-green-400/0',
    },
  ]
  const activeFeatureCard = featureCards.find((feature) => feature.key === activeFeature) || featureCards[0]

  useEffect(() => {
    let cancelled = false

    const checkAccess = async () => {
      try {
        const res = await authAPI.accessStatus()
        if (cancelled) return

        const isBlocked = !!res.data?.blocked
        setBlocked(isBlocked)
        setAccessChecked(true)

        if (!isBlocked && blockedHint) {
          const token = localStorage.getItem('token')
          window.location.replace(token ? '/dashboard' : '/auth')
        }
      } catch (err) {
        if (cancelled) return

        const isBlocked = err?.response?.data?.code === 'ACCESS_BLOCKED'
        setBlocked(isBlocked || blockedHint)
        setAccessChecked(true)
      }
    }

    checkAccess()
    const intervalId = window.setInterval(checkAccess, 5000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [blockedHint])

  useEffect(() => {
    let cancelled = false

    authAPI.providers().then((res) => {
      if (!cancelled) {
        setOauthProviders({
          discord: !!res.data?.discord,
          google: !!res.data?.google,
        })
      }
    }).catch(() => {
      if (!cancelled) {
        setOauthProviders({ discord: false, google: false })
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const set = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }))
    setError('')
  }

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    const normalizedEmail = form.email.trim().toLowerCase()
    const data = mode === 'login'
      ? { email: normalizedEmail, password: form.password }
      : { email: normalizedEmail, username: form.username.trim(), password: form.password }
    const fn = mode === 'login' ? login : register
    const response = await fn(data)

    if (response.success) {
      toast.success(mode === 'login' ? t('auth.loginSuccess') : t('auth.registerSuccess'))
      navigate('/dashboard')
    } else {
      setError(response.error || t('auth.unexpectedError'))
    }
  }

  const startDiscordLogin = () => {
    window.location.href = '/api/v1/auth/discord'
  }

  const startGoogleLogin = () => {
    window.location.href = '/api/v1/auth/google'
  }

  const oauthButtons = [
    oauthProviders.discord ? {
      key: 'discord',
      label: t('auth.discordButton', 'Discord'),
      onClick: startDiscordLogin,
      className: 'bg-[#5865F2] hover:bg-[#6773f6] shadow-[0_12px_30px_rgba(88,101,242,0.28)]',
      icon: DiscordMark,
    } : null,
    oauthProviders.google ? {
      key: 'google',
      label: t('auth.googleButton', 'Google'),
      onClick: startGoogleLogin,
      className: 'bg-white text-[#111827] hover:bg-white/90 shadow-[0_12px_30px_rgba(255,255,255,0.12)]',
      icon: GoogleMark,
    } : null,
  ].filter(Boolean)

  return (
    <div className="min-h-screen bg-surface-0 relative overflow-x-hidden p-4 md:px-6 md:py-8">
      <SnowCanvas />
      <div className="absolute top-1/3 left-1/4 w-96 h-96 bg-neon-cyan/5 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-neon-violet/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-center gap-8 md:gap-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="w-full max-w-md pt-6 md:pt-10"
        >
          <div className="text-center mb-8">
            <motion.div
              animate={{ rotate: [0, 1.5, -1.5, 0] }}
              transition={{ duration: 5, repeat: Infinity }}
              className="mx-auto mb-4 w-full max-w-[440px]"
            >
              <img src="/discordforger-logo-full.png" className="w-full h-auto object-contain drop-shadow-[0_24px_60px_rgba(68,118,255,0.22)]" alt="DiscordForger" />
            </motion.div>
            <p className="text-white/40 text-sm">{t('auth.tagline')}</p>
          </div>

          {!accessChecked ? (
            <div className="gradient-border">
              <div className="bg-surface-1 rounded-2xl p-8 text-center space-y-4">
                <div className="mx-auto w-10 h-10 border-2 border-white/15 border-t-neon-cyan rounded-full animate-spin" />
                <p className="text-sm text-white/45 font-mono">
                  {t('auth.blockedChecking', 'Verification de l acces...')}
                </p>
              </div>
            </div>
          ) : (blocked || blockedHint) ? (
            <div className="gradient-border">
              <div className="bg-surface-1 rounded-2xl p-8 text-center space-y-5">
                <div className="mx-auto w-16 h-16 rounded-2xl border border-red-500/25 bg-red-500/10 text-red-400 flex items-center justify-center shadow-[0_0_30px_rgba(248,113,113,0.12)]">
                  <Ban className="w-8 h-8" />
                </div>
                <div>
                  <h2 className="font-display font-700 text-2xl text-white">{t('auth.blockedTitle', 'Acces bloque')}</h2>
                  <p className="text-white/45 text-sm mt-2">
                    {t('auth.blockedBody', 'Ton acces au site est actuellement bloque. Tant que le staff ne retablit pas l acces, tu ne peux pas utiliser le site ni te connecter.')}
                  </p>
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
                  <p className="text-xs font-mono text-white/45">
                    {t('auth.blockedAutoRefresh', 'Verification automatique toutes les 5 secondes. Des que l acces est retabli, le site revient automatiquement.')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
          <div className="gradient-border">
            <div className="bg-surface-1 rounded-2xl p-8">
              <div className="flex bg-white/[0.04] rounded-xl p-1 mb-6 border border-white/[0.06]">
                {[
                  ['login', t('auth.tabs.login')],
                  ['register', t('auth.tabs.register')],
                ].map(([currentMode, label]) => (
                  <button
                    key={currentMode}
                    onClick={() => { setMode(currentMode); setError('') }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-display font-600 transition-all duration-200 ${
                      mode === currentMode
                        ? 'bg-gradient-to-r from-neon-cyan/20 to-neon-violet/20 text-white border border-neon-cyan/30'
                        : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4" autoComplete="on">
                <AnimatePresence mode="wait">
                  {mode === 'register' && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                      <label className="block text-xs font-mono text-white/40 mb-1.5 uppercase tracking-wider">{t('auth.username')}</label>
                      <input
                        className="input-field"
                        placeholder={t('auth.usernamePlaceholder')}
                        value={form.username}
                        onChange={(event) => set('username', event.target.value)}
                        required
                        minLength={2}
                        maxLength={32}
                        name="username"
                        autoComplete="nickname"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <div>
                  <label className="block text-xs font-mono text-white/40 mb-1.5 uppercase tracking-wider">{t('auth.email')}</label>
                  <input
                    type="email"
                    className="input-field"
                    placeholder={t('auth.emailPlaceholder')}
                    value={form.email}
                    onChange={(event) => set('email', event.target.value)}
                    required
                    name="email"
                    autoComplete={mode === 'login' ? 'username' : 'email'}
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-white/40 mb-1.5 uppercase tracking-wider">{t('auth.password')}</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      className="input-field pr-12"
                      placeholder={mode === 'register' ? t('auth.registerPasswordPlaceholder') : '........'}
                      value={form.password}
                      onChange={(event) => set('password', event.target.value)}
                      required
                      name={mode === 'login' ? 'account-password' : 'new-account-password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm"
                    >
                      <AlertCircle className="w-4 h-4 shrink-0" />{error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-3 rounded-xl font-display font-600 text-sm bg-gradient-to-r from-neon-cyan to-neon-violet text-white transition-all duration-200 shadow-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                      {mode === 'login' ? t('auth.loginLoading') : t('auth.registerLoading')}
                    </span>
                  ) : mode === 'login' ? t('auth.loginSubmit') : t('auth.registerSubmit')}
                </button>

                {oauthButtons.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-white/[0.08]" />
                      <span className="text-[11px] font-mono uppercase tracking-[0.24em] text-white/30">
                        {t('auth.oauthDivider', 'Ou')}
                      </span>
                      <div className="h-px flex-1 bg-white/[0.08]" />
                    </div>

                    <div className={`grid gap-3 ${oauthButtons.length > 1 ? 'sm:grid-cols-2' : 'grid-cols-1'}`}>
                      {oauthButtons.map((provider) => {
                        const Icon = provider.icon
                        return (
                          <button
                            key={provider.key}
                            type="button"
                            onClick={provider.onClick}
                            className={`w-full py-3 rounded-xl font-display font-600 text-sm transition-all duration-200 flex items-center justify-center gap-2 ${provider.className}`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            {provider.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </form>

              <div className="mt-6 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {featureCards.map((feature) => {
                    const active = feature.key === activeFeature
                    const Icon = feature.icon

                    return (
                      <motion.button
                        key={feature.key}
                        type="button"
                        onMouseEnter={() => setActiveFeature(feature.key)}
                        onFocus={() => setActiveFeature(feature.key)}
                        onClick={() => setActiveFeature(feature.key)}
                        whileHover={{ y: -3, scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        className={`group relative overflow-hidden rounded-xl border px-3 py-3.5 text-left transition-all duration-300 ${
                          active
                            ? feature.activeClass
                            : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.05]'
                        }`}
                      >
                        <div className={`absolute inset-x-3 top-0 h-px bg-gradient-to-r ${feature.lineClass} ${active ? 'opacity-100' : 'opacity-0 group-hover:opacity-60'} transition-opacity`} />
                        <div className="flex flex-col items-center gap-2 text-center">
                          <motion.div
                            animate={active ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                            transition={{ duration: 0.35 }}
                            className={`flex h-9 w-9 items-center justify-center rounded-xl border transition-all ${
                              active ? feature.iconBgClass : 'border-white/[0.06] bg-white/[0.03]'
                            }`}
                          >
                            <Icon className={`w-4 h-4 ${feature.iconClass}`} />
                          </motion.div>
                          <span className={`text-xs font-mono transition-colors ${active ? 'text-white' : 'text-white/35 group-hover:text-white/65'}`}>
                            {feature.label}
                          </span>
                        </div>
                      </motion.button>
                    )
                  })}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeFeatureCard.key}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <activeFeatureCard.icon className={`w-4 h-4 ${activeFeatureCard.iconClass}`} />
                      <span className="text-sm font-display font-600 text-white">{activeFeatureCard.label}</span>
                    </div>
                    <p className="text-xs text-white/45 leading-relaxed">{activeFeatureCard.description}</p>
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>
          </div>
          )}
        </motion.div>

      </div>
    </div>
  )
}
