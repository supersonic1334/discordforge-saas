import { useEffect, useMemo, useState, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Eye, EyeOff, Bot, Shield, Zap, AlertCircle, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
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

function buildSnowLayer(count, options) {
  return Array.from({ length: count }, (_, index) => ({
    id: `${options.key}-${index}`,
    left: Math.random() * 100,
    top: -18 - Math.random() * 92,
    size: options.minSize + Math.random() * (options.maxSize - options.minSize),
    duration: options.minDuration + Math.random() * (options.maxDuration - options.minDuration),
    delay: Math.random() * options.maxDelay,
    drift: (Math.random() - 0.5) * options.maxDrift,
    opacity: options.minOpacity + Math.random() * (options.maxOpacity - options.minOpacity),
    blur: Math.random() * options.maxBlur,
    sway: 0.35 + Math.random() * 0.85,
    rotate: (Math.random() - 0.5) * 60,
  }))
}

function AuthSnowBackdrop({ pointerX, pointerY }) {
  const layerDriftX = useSpring(useTransform(pointerX, [0, 100], [-24, 24]), { stiffness: 120, damping: 18, mass: 0.7 })
  const layerDriftY = useSpring(useTransform(pointerY, [0, 100], [-14, 14]), { stiffness: 120, damping: 18, mass: 0.72 })
  const backFlakes = useMemo(() => buildSnowLayer(78, {
    key: 'back',
    minSize: 0.8,
    maxSize: 2.4,
    minDuration: 18,
    maxDuration: 31,
    maxDelay: 18,
    maxDrift: 28,
    minOpacity: 0.1,
    maxOpacity: 0.28,
    maxBlur: 1.4,
  }), [])
  const midFlakes = useMemo(() => buildSnowLayer(56, {
    key: 'mid',
    minSize: 1.1,
    maxSize: 3.8,
    minDuration: 13,
    maxDuration: 23,
    maxDelay: 16,
    maxDrift: 40,
    minOpacity: 0.16,
    maxOpacity: 0.46,
    maxBlur: 0.9,
  }), [])
  const frontFlakes = useMemo(() => buildSnowLayer(52, {
    key: 'front',
    minSize: 1.8,
    maxSize: 5.6,
    minDuration: 9,
    maxDuration: 17,
    maxDelay: 16,
    maxDrift: 58,
    minOpacity: 0.28,
    maxOpacity: 0.8,
    maxBlur: 0.5,
  }), [])

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-black" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(38,62,84,0.22),rgba(9,16,24,0.2)_18%,rgba(0,0,0,0.9)_54%,rgba(0,0,0,1))]" />
      <div className="absolute inset-x-0 top-0 h-[42vh] bg-[linear-gradient(180deg,rgba(92,123,154,0.12),rgba(92,123,154,0.05)_36%,transparent)]" />

      <motion.div style={{ x: layerDriftX, y: layerDriftY }} className="absolute inset-[-8%]">
        {backFlakes.map((flake) => (
          <motion.span
            key={flake.id}
            className="absolute rounded-full bg-white"
            style={{
              left: `${flake.left}%`,
              top: `${flake.top}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: `blur(${flake.blur}px)`,
              boxShadow: '0 0 8px rgba(188,208,228,0.12)',
            }}
            animate={{
              x: [0, flake.drift * flake.sway, flake.drift * -0.25],
              y: ['0vh', '135vh'],
              opacity: [0, flake.opacity, flake.opacity * 0.92, 0],
            }}
            transition={{
              duration: flake.duration,
              ease: 'linear',
              repeat: Infinity,
              delay: flake.delay,
            }}
          />
        ))}

        {midFlakes.map((flake) => (
          <motion.span
            key={flake.id}
            className="absolute rounded-full bg-[radial-gradient(circle,rgba(247,251,255,0.95),rgba(208,224,239,0.24)_62%,transparent)]"
            style={{
              left: `${flake.left}%`,
              top: `${flake.top}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: `blur(${flake.blur}px)`,
              boxShadow: '0 0 12px rgba(201,220,238,0.16)',
            }}
            animate={{
              x: [0, flake.drift * 0.65, flake.drift * -0.12],
              y: ['0vh', '137vh'],
              opacity: [0, flake.opacity, flake.opacity, 0],
            }}
            transition={{
              duration: flake.duration,
              ease: 'linear',
              repeat: Infinity,
              delay: flake.delay,
            }}
          />
        ))}

        {frontFlakes.map((flake) => (
          <motion.span
            key={flake.id}
            className="absolute"
            style={{
              left: `${flake.left}%`,
              top: `${flake.top}%`,
              width: flake.size,
              height: flake.size,
              opacity: flake.opacity,
              filter: `blur(${flake.blur}px)`,
            }}
            animate={{
              x: [0, flake.drift, flake.drift * 0.38],
              y: ['0vh', '138vh'],
              rotate: [flake.rotate, flake.rotate + 18, flake.rotate - 10, flake.rotate + 8],
              opacity: [0, flake.opacity, flake.opacity * 0.94, 0],
            }}
            transition={{
              duration: flake.duration,
              ease: 'linear',
              repeat: Infinity,
              delay: flake.delay,
            }}
          >
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-white"
              style={{
                width: flake.size * 0.34,
                height: flake.size * 0.34,
                marginLeft: -(flake.size * 0.17),
                marginTop: -(flake.size * 0.17),
                boxShadow: '0 0 10px rgba(214,230,245,0.22)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.95),rgba(214,236,255,0.18))]"
              style={{
                width: Math.max(1, flake.size * 0.12),
                height: flake.size,
                marginLeft: -(Math.max(1, flake.size * 0.12) / 2),
                marginTop: -(flake.size / 2),
                boxShadow: '0 0 8px rgba(214,230,245,0.16)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(90deg,rgba(255,255,255,0.95),rgba(214,236,255,0.18))]"
              style={{
                width: flake.size,
                height: Math.max(1, flake.size * 0.12),
                marginLeft: -(flake.size / 2),
                marginTop: -(Math.max(1, flake.size * 0.12) / 2),
                boxShadow: '0 0 8px rgba(214,230,245,0.16)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(45deg,rgba(255,255,255,0.84),rgba(214,236,255,0.12))]"
              style={{
                width: flake.size * 0.82,
                height: Math.max(1, flake.size * 0.1),
                marginLeft: -(flake.size * 0.41),
                marginTop: -(Math.max(1, flake.size * 0.1) / 2),
                transform: 'rotate(45deg)',
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 rounded-full bg-[linear-gradient(135deg,rgba(255,255,255,0.84),rgba(214,236,255,0.12))]"
              style={{
                width: flake.size * 0.82,
                height: Math.max(1, flake.size * 0.1),
                marginLeft: -(flake.size * 0.41),
                marginTop: -(Math.max(1, flake.size * 0.1) / 2),
                transform: 'rotate(-45deg)',
              }}
            />
          </motion.span>
        ))}
      </motion.div>

      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  )
}

export default function AuthPage() {
  const { t } = useI18n()
  const [mode, setMode] = useState('login')
  const [showPass, setShowPass] = useState(false)
  const [activeFeature, setActiveFeature] = useState('secure')
  const [form, setForm] = useState({ email: '', username: '', password: '', captchaAnswer: '' })
  const [error, setError] = useState('')
  const [pendingNotice, setPendingNotice] = useState('')
  const [registerCaptcha, setRegisterCaptcha] = useState(null)
  const [captchaLoading, setCaptchaLoading] = useState(false)
  const [accessChecked, setAccessChecked] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [oauthProviders, setOauthProviders] = useState({ discord: false, google: false })
  const navigate = useNavigate()
  const location = useLocation()
  const { login, register, isLoading } = useAuthStore()
  const blockedHint = useMemo(() => new URLSearchParams(location.search).get('blocked') === '1', [location.search])
  const formRef = useRef(null)
  const shellRef = useRef(null)
  const pointerX = useMotionValue(50)
  const pointerY = useMotionValue(24)
  const isRegister = mode === 'register'
  const registerCaptchaReady = !isRegister || (!!registerCaptcha?.token && !captchaLoading)
  const authLayoutTransition = { type: 'spring', stiffness: 260, damping: 28, mass: 0.82 }

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

  // Auto-rotate features
  useEffect(() => {
    const keys = featureCards.map((f) => f.key)
    let idx = keys.indexOf(activeFeature)
    const interval = window.setInterval(() => {
      idx = (idx + 1) % keys.length
      setActiveFeature(keys[idx])
    }, 5000)
    return () => window.clearInterval(interval)
  }, [activeFeature])

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
    setPendingNotice('')
  }

  const loadRegisterCaptcha = async (options = {}) => {
    if (!isRegister && !options.force) return
    setCaptchaLoading(true)
    try {
      const res = await authAPI.registerChallenge()
      setRegisterCaptcha(res.data || null)
      setForm((previous) => ({ ...previous, captchaAnswer: '' }))
    } catch {
      setRegisterCaptcha(null)
      setError('CAPTCHA indisponible. Recharge la page et reessaie.')
    } finally {
      setCaptchaLoading(false)
    }
  }

  useEffect(() => {
    if (isRegister && !registerCaptcha && !captchaLoading) {
      loadRegisterCaptcha({ force: true })
    }
  }, [isRegister, registerCaptcha, captchaLoading])

  useEffect(() => {
    if (!shellRef.current) return
    shellRef.current.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [mode])

  const submit = async (event) => {
    event.preventDefault()
    setError('')
    setPendingNotice('')

    const normalizedEmail = form.email.trim().toLowerCase()
    const data = mode === 'login'
      ? { email: normalizedEmail, password: form.password }
      : {
          email: normalizedEmail,
          username: form.username.trim(),
          password: form.password,
          captcha_token: registerCaptcha?.token || '',
          captcha_answer: form.captchaAnswer,
        }
    const fn = mode === 'login' ? login : register
    const response = await fn(data)

    if (response.success) {
      if (response.requiresVerification) {
        const message = response.emailMasked
          ? `Verification envoyee a ${response.emailMasked}. Clique sur le lien dans ton e-mail pour activer l acces.`
          : 'Verification envoyee. Clique sur le lien dans ton e-mail pour activer l acces.'
        setPendingNotice(message)
        toast.success('Verification e-mail envoyee')
        setMode('login')
        return
      }

      if (response.requiresLoginApproval) {
        const message = response.emailMasked
          ? `Connexion en attente. Autorise cette tentative depuis ${response.emailMasked}.`
          : 'Connexion en attente. Autorise cette tentative depuis ton e-mail.'
        setPendingNotice(message)
        toast.success('Validation de connexion envoyee')
        return
      }

      toast.success(mode === 'login' ? t('auth.loginSuccess') : t('auth.registerSuccess'))
      navigate('/dashboard')
    } else {
      setError(response.error || t('auth.unexpectedError'))
      if (mode === 'register') {
        loadRegisterCaptcha({ force: true })
      }
    }
  }

  const startDiscordLogin = () => {
    window.location.href = '/api/v1/auth/discord'
  }

  const startGoogleLogin = () => {
    window.location.href = '/api/v1/auth/google'
  }

  const handleAuthPointerMove = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return

    pointerX.set(((event.clientX - bounds.left) / bounds.width) * 100)
    pointerY.set(((event.clientY - bounds.top) / bounds.height) * 100)
  }

  const resetAuthPointer = () => {
    pointerX.set(50)
    pointerY.set(24)
  }

  const oauthButtons = [
    oauthProviders.discord ? {
      key: 'discord',
      label: t('auth.discordButton', 'Discord'),
      onClick: startDiscordLogin,
      className: 'bg-[#5865F2] hover:bg-[#6773f6] shadow-[0_12px_30px_rgba(88,101,242,0.28)] hover:shadow-[0_16px_38px_rgba(88,101,242,0.36)]',
      icon: DiscordMark,
    } : null,
    oauthProviders.google ? {
      key: 'google',
      label: t('auth.googleButton', 'Google'),
      onClick: startGoogleLogin,
      className: 'bg-white text-[#111827] hover:bg-white/90 shadow-[0_12px_30px_rgba(255,255,255,0.12)] hover:shadow-[0_16px_38px_rgba(255,255,255,0.18)]',
      icon: GoogleMark,
    } : null,
  ].filter(Boolean)

    return (
    <div
      ref={shellRef}
      className="auth-page-shell app-screen-scroll bg-black relative p-4 md:px-6 md:py-8"
      data-scrollable={isRegister ? 'true' : 'false'}
      onMouseMove={handleAuthPointerMove}
      onMouseLeave={resetAuthPointer}
    >
      <AuthSnowBackdrop pointerX={pointerX} pointerY={pointerY} />

      <div className="auth-page-frame auth-mobile-shell relative z-10 mx-auto flex w-full max-w-7xl flex-col items-center gap-6 md:gap-10">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="auth-mobile-panel w-full max-w-[min(42rem,100%)] pt-4 sm:pt-6 md:pt-10"
        >
          {/* Logo section */}
            <div className="auth-mobile-hero text-center mb-6 sm:mb-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.92, y: 18 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.7, ease: 'easeOut' }}
                whileHover={{ y: -5, scale: 1.01 }}
                className="auth-mobile-logo-shell relative mx-auto mb-4 sm:mb-5 w-full max-w-[min(560px,92vw)]"
              >
              <motion.div
                animate={{
                  y: [0, -10, 0, 7, 0],
                  rotate: [0, -1.8, 1.6, 0],
                  scale: [1, 1.018, 0.996, 1.01, 1],
                }}
                transition={{ duration: 7.2, repeat: Infinity, ease: 'easeInOut' }}
                className="relative"
              >
                <motion.img
                  src="/discordforger-logo-full.png"
                  alt="DiscordForger"
                  animate={{
                    filter: [
                      'drop-shadow(0 10px 22px rgba(84,114,145,0.16))',
                      'drop-shadow(0 14px 26px rgba(108,138,170,0.2))',
                      'drop-shadow(0 10px 22px rgba(84,114,145,0.16))',
                    ],
                  }}
                  transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="auth-mobile-logo relative z-10 w-full h-auto object-contain"
                  loading="eager"
                />
              </motion.div>
            </motion.div>
            <p className="text-white/40 text-sm">{t('auth.tagline')}</p>
          </div>

          {/* Access check / Blocked / Form */}
          {!accessChecked ? (
            <motion.div whileHover={{ y: -4, scale: 1.005 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} className="gradient-border">
              <div className="bg-surface-1 rounded-2xl p-6 sm:p-8 text-center space-y-4">
                <div className="mx-auto w-10 h-10 border-2 border-white/15 border-t-neon-cyan rounded-full animate-spin" />
                <p className="text-sm text-white/45 font-mono">
                  {t('auth.blockedChecking', 'Verification de l acces...')}
                </p>
              </div>
            </motion.div>
          ) : (blocked || blockedHint) ? (
            <motion.div whileHover={{ y: -4, scale: 1.005 }} transition={{ type: 'spring', stiffness: 260, damping: 22 }} className="gradient-border">
              <div className="bg-surface-1 rounded-2xl p-6 sm:p-8 text-center space-y-5">
                <motion.div
                  initial={{ scale: 0.8 }}
                  animate={{ scale: 1 }}
                  className="mx-auto w-16 h-16 rounded-2xl border border-red-500/25 bg-red-500/10 text-red-400 flex items-center justify-center shadow-[0_0_30px_rgba(248,113,113,0.12)]"
                >
                  <Ban className="w-8 h-8" />
                </motion.div>
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
            </motion.div>
          ) : (
          <motion.div
            layout
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ y: -6, scale: 1.006 }}
            className="auth-mobile-card gradient-border"
          >
            <div className="auth-card-surface bg-surface-1 rounded-2xl p-5 sm:p-8">
              {/* Tab switcher */}
              <div className="flex bg-white/[0.04] rounded-xl p-1 mb-5 sm:mb-6 border border-white/[0.06]">
                {[
                  ['login', t('auth.tabs.login')],
                  ['register', t('auth.tabs.register')],
                ].map(([currentMode, label]) => (
                  <button
                    key={currentMode}
                    onClick={() => { setMode(currentMode); setError(''); setPendingNotice('') }}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-display font-600 transition-all duration-250 ${
                      mode === currentMode
                        ? 'bg-gradient-to-r from-neon-cyan/20 to-neon-violet/20 text-white border border-neon-cyan/30 shadow-[0_0_16px_rgba(0,229,255,0.08)]'
                        : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Auth form */}
              <motion.form
                layout
                transition={{ layout: authLayoutTransition }}
                ref={formRef}
                onSubmit={submit}
                className="auth-form-stack space-y-4"
                autoComplete="on"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {isRegister && (
                    <motion.div
                      key="register-username"
                      layout
                      initial={{ opacity: 0, height: 0, y: -10 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0, y: -10 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div>
                        <label className="block text-xs font-mono text-white/40 mb-1.5 uppercase tracking-wider">{t('auth.username')}</label>
                        <input
                          className="input-field"
                          placeholder={t('auth.usernamePlaceholder')}
                          value={form.username}
                          onChange={(event) => set('username', event.target.value)}
                          required={isRegister}
                          minLength={2}
                          maxLength={32}
                          name="username"
                          autoComplete="nickname"
                          inputMode="text"
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.div layout="position">
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
                    inputMode="email"
                  />
                </motion.div>

                <motion.div layout="position">
                  <label className="block text-xs font-mono text-white/40 mb-1.5 uppercase tracking-wider">{t('auth.password')}</label>
                  <div className="relative">
                    <input
                      type={showPass ? 'text' : 'password'}
                      className="input-field pr-12"
                      placeholder={isRegister ? t('auth.registerPasswordPlaceholder') : '........'}
                      value={form.password}
                      onChange={(event) => set('password', event.target.value)}
                      required
                      name={mode === 'login' ? 'account-password' : 'new-account-password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass((value) => !value)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors p-1"
                      aria-label={showPass ? 'Hide password' : 'Show password'}
                    >
                      {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </motion.div>

                <AnimatePresence initial={false} mode="popLayout">
                  {isRegister && (
                    <motion.div
                      key="register-captcha"
                      layout
                      initial={{ opacity: 0, height: 0, y: -10 }}
                      animate={{ opacity: 1, height: 'auto', y: 0 }}
                      exit={{ opacity: 0, height: 0, y: -10 }}
                      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="space-y-3 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-3 sm:p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-mono uppercase tracking-[0.22em] text-white/35">CAPTCHA</div>
                            <div className="text-sm text-white/70">
                              {registerCaptcha?.prompt || 'Recopie le code CAPTCHA pour continuer'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => loadRegisterCaptcha({ force: true })}
                            disabled={captchaLoading}
                            className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-xs font-mono uppercase tracking-[0.18em] text-white/60 transition hover:border-neon-cyan/30 hover:text-neon-cyan disabled:opacity-50"
                          >
                            {captchaLoading ? 'Chargement...' : 'Recharger'}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => loadRegisterCaptcha({ force: true })}
                          disabled={captchaLoading}
                          className="block w-full overflow-hidden rounded-2xl border border-neon-cyan/20 bg-[#08131f] p-2 transition hover:border-neon-cyan/40 disabled:opacity-70"
                        >
                          {registerCaptcha?.image_data_url ? (
                            <img
                              src={registerCaptcha.image_data_url}
                              alt="CAPTCHA"
                              className="h-28 w-full rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-28 items-center justify-center rounded-xl border border-dashed border-white/[0.08] text-sm text-white/35">
                              {captchaLoading ? 'Generation du CAPTCHA...' : 'CAPTCHA indisponible'}
                            </div>
                          )}
                        </button>

                        <div>
                          <label className="mb-1.5 block text-xs font-mono uppercase tracking-wider text-white/40">
                            Code CAPTCHA
                          </label>
                          <input
                            className="input-field"
                            placeholder="Recopie le code CAPTCHA"
                            value={form.captchaAnswer}
                            onChange={(event) => set('captchaAnswer', event.target.value)}
                            required={isRegister}
                            autoComplete="one-time-code"
                            inputMode="numeric"
                            maxLength={8}
                          />
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

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

                <AnimatePresence>
                  {pendingNotice && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex items-start gap-2 p-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-sm"
                    >
                      <Shield className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{pendingNotice}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <motion.button
                  type="submit"
                  disabled={isLoading || !registerCaptchaReady}
                  whileTap={{ scale: 0.97 }}
                  className="w-full py-3 rounded-xl font-display font-600 text-sm bg-gradient-to-r from-neon-cyan to-neon-violet text-white transition-all duration-250 shadow-neon-cyan disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 hover:shadow-[0_0_28px_rgba(0,229,255,0.3),0_0_56px_rgba(0,229,255,0.1)]"
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />
                      {mode === 'login' ? t('auth.loginLoading') : t('auth.registerLoading')}
                    </span>
                  ) : !registerCaptchaReady ? (
                    'Chargement du captcha...'
                  ) : mode === 'login' ? t('auth.loginSubmit') : t('auth.registerSubmit')}
                </motion.button>

                {oauthButtons.length > 0 && (
                  <div className="auth-oauth-section space-y-3 pt-1">
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
                          <motion.button
                            key={provider.key}
                            type="button"
                            onClick={provider.onClick}
                            whileHover={{ y: -1 }}
                            whileTap={{ scale: 0.97 }}
                            className={`w-full py-3 rounded-xl font-display font-600 text-sm transition-all duration-250 flex items-center justify-center gap-2 ${provider.className}`}
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            {provider.label}
                          </motion.button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </motion.form>

              {/* Feature cards */}
              <div className="auth-mobile-features mt-5 sm:mt-6 space-y-3">
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
                        className={`group relative overflow-hidden rounded-xl border px-2 sm:px-3 py-3 sm:py-3.5 text-left transition-all duration-300 ${
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
                            className={`flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl border transition-all ${
                              active ? feature.iconBgClass : 'border-white/[0.06] bg-white/[0.03]'
                            }`}
                          >
                            <Icon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${feature.iconClass}`} />
                          </motion.div>
                          <span className={`text-[10px] sm:text-xs font-mono transition-colors leading-tight ${active ? 'text-white' : 'text-white/35 group-hover:text-white/65'}`}>
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
                    transition={{ duration: 0.2 }}
                    className="auth-feature-detail rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3"
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
          </motion.div>
          )}
        </motion.div>

      </div>
    </div>
  )
}
