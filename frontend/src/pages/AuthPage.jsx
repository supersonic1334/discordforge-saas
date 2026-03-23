import { Suspense, lazy, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Eye, EyeOff, Bot, Shield, Zap, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import SnowCanvas from '../components/SnowCanvas'
import { useAuthStore } from '../stores'
import { useI18n } from '../i18n'

const ProtectionShowcase3D = lazy(() => import('../components/ProtectionShowcase3D'))

export default function AuthPage() {
  const { t } = useI18n()
  const [mode, setMode] = useState('login')
  const [showPass, setShowPass] = useState(false)
  const [activeFeature, setActiveFeature] = useState('secure')
  const [form, setForm] = useState({ email: '', username: '', password: '' })
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { login, register, isLoading } = useAuthStore()

  const featureCards = [
    {
      key: 'secure',
      icon: Shield,
      label: t('auth.features.secure'),
      description: t('auth.features.secureDesc', 'Connexion protegee et acces verrouille en toute securite.'),
      iconClass: 'text-neon-cyan',
      iconBgClass: 'border-neon-cyan/20 bg-neon-cyan/10',
      activeClass: 'border-neon-cyan/30 bg-gradient-to-br from-neon-cyan/16 to-neon-cyan/4 shadow-[0_0_30px_rgba(0,229,255,0.14)]',
      lineClass: 'from-neon-cyan/0 via-neon-cyan/70 to-neon-cyan/0',
    },
    {
      key: 'realtime',
      icon: Zap,
      label: t('auth.features.realtime'),
      description: t('auth.features.realtimeDesc', 'Statuts, synchronisation et actions instantanees sur ton bot.'),
      iconClass: 'text-neon-violet',
      iconBgClass: 'border-neon-violet/20 bg-neon-violet/10',
      activeClass: 'border-neon-violet/30 bg-gradient-to-br from-neon-violet/16 to-neon-violet/4 shadow-[0_0_30px_rgba(176,78,255,0.14)]',
      lineClass: 'from-neon-violet/0 via-neon-violet/70 to-neon-violet/0',
    },
    {
      key: 'ai',
      icon: Bot,
      label: t('auth.features.ai'),
      description: t('auth.features.aiDesc', 'Assistant integre pour configurer et piloter ton site plus vite.'),
      iconClass: 'text-green-400',
      iconBgClass: 'border-green-400/20 bg-green-400/10',
      activeClass: 'border-green-400/25 bg-gradient-to-br from-green-400/16 to-green-400/4 shadow-[0_0_30px_rgba(74,222,128,0.14)]',
      lineClass: 'from-green-400/0 via-green-400/70 to-green-400/0',
    },
  ]
  const activeFeatureCard = featureCards.find((feature) => feature.key === activeFeature) || featureCards[0]

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
              animate={{ rotate: [0, 4, -4, 0] }}
              transition={{ duration: 4, repeat: Infinity }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 border border-neon-cyan/30 mb-4 shadow-neon-cyan"
            >
              <Bot className="w-8 h-8 text-neon-cyan" />
            </motion.div>
            <h1 className="font-display font-800 text-3xl neon-text mb-1">DiscordForger</h1>
            <p className="text-white/40 text-sm">{t('auth.tagline')}</p>
          </div>

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
        </motion.div>

        <Suspense
          fallback={(
            <div className="w-full rounded-[34px] border border-white/[0.08] bg-white/[0.03] min-h-[420px] md:min-h-[540px]" />
          )}
        >
          <ProtectionShowcase3D />
        </Suspense>
      </div>
    </div>
  )
}
