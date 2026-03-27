import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Key, User, Lock, Languages, ImagePlus, Trash2, ChevronDown, Check } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { authAPI } from '../services/api'
import { useAuthStore, useBotStore } from '../stores'
import { AI_LANGUAGE_OPTIONS, SITE_LANGUAGE_OPTIONS, getOptionLabel, useI18n } from '../i18n'
import { prepareAvatarDataUrl } from '../utils/avatarUpload'
import { getQuickBotToken, setQuickBotToken } from '../utils/quickBotToken'

function normalizePreference(value, fallback = 'auto') {
  return ['auto', 'fr', 'en', 'es'].includes(value) ? value : fallback
}

function getRoleLabel(t, role) {
  if (role === 'api_provider') return t('admin.roles.api_provider', 'fournisseur API')
  return t(`admin.roles.${role}`, role || '')
}

function getMaskedQuickToken(token) {
  if (!token) return ''
  return '••••••••••••••••••••••••'
}

function getErrorMessage(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function SettingsPanel({ icon: Icon, iconTone, title, hint, children }) {
  return (
    <div className="spotlight-card p-5 sm:p-6">
      <div className="relative z-[1] space-y-4">
        <div className="flex items-start gap-3">
          <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center shrink-0 ${iconTone}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-display font-700 text-white">{title}</p>
            {hint ? <p className="mt-1 text-sm leading-6 text-white/45">{hint}</p> : null}
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

function PreferenceSelect({ label, value, options, locale, accent = 'cyan', onChange }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const selectedOption = options.find((option) => option.value === value) || options[0]
  const autoDetectLabel = locale === 'fr' ? 'Detection auto' : locale === 'es' ? 'Deteccion auto' : 'Auto detect'
  const accentTone = accent === 'violet'
    ? {
        frame: 'border-neon-violet/25 bg-[linear-gradient(135deg,rgba(140,92,255,0.18),rgba(255,255,255,0.03))] shadow-[0_22px_46px_rgba(118,91,255,0.18)]',
        panel: 'border-neon-violet/20 bg-[linear-gradient(180deg,rgba(20,18,34,0.98),rgba(10,9,18,0.98))] shadow-[0_26px_80px_rgba(107,72,255,0.28)]',
        chip: 'border-neon-violet/25 bg-neon-violet/12 text-neon-violet',
        active: 'border-neon-violet/35 bg-neon-violet/14',
        hover: 'hover:border-neon-violet/25 hover:bg-neon-violet/10',
        dot: 'bg-neon-violet',
        text: 'text-neon-violet',
      }
    : {
        frame: 'border-neon-cyan/25 bg-[linear-gradient(135deg,rgba(0,224,255,0.16),rgba(255,255,255,0.03))] shadow-[0_22px_46px_rgba(0,224,255,0.16)]',
        panel: 'border-neon-cyan/20 bg-[linear-gradient(180deg,rgba(13,22,28,0.98),rgba(8,12,17,0.98))] shadow-[0_26px_80px_rgba(0,214,255,0.24)]',
        chip: 'border-neon-cyan/25 bg-neon-cyan/12 text-neon-cyan',
        active: 'border-neon-cyan/35 bg-neon-cyan/14',
        hover: 'hover:border-neon-cyan/25 hover:bg-neon-cyan/10',
        dot: 'bg-neon-cyan',
        text: 'text-neon-cyan',
      }

  useEffect(() => {
    if (!open) return undefined

    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }

    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className="space-y-2">
      <label className="text-xs font-mono text-white/40 block">{label}</label>

      <div className="relative">
        <motion.button
          type="button"
          whileHover={{ y: -2, scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          onClick={() => setOpen((current) => !current)}
          className={`group relative flex w-full items-center justify-between overflow-hidden rounded-[24px] border px-4 py-3.5 text-left transition-all duration-300 ${accentTone.frame}`}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.14),transparent_48%)] opacity-60 transition-opacity duration-300 group-hover:opacity-90" />
          <div className="relative z-[1] min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full shadow-[0_0_16px_currentColor] ${accentTone.dot}`} />
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.22em] ${accentTone.chip}`}>
                {selectedOption.value === 'auto' ? 'AUTO' : selectedOption.value.toUpperCase()}
              </span>
            </div>
            <p className="mt-2 truncate font-display text-base font-700 text-white">
              {getOptionLabel(selectedOption, locale)}
            </p>
          </div>

          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className={`relative z-[1] ml-4 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.06] ${accentTone.text}`}
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </motion.button>

        <AnimatePresence>
          {open ? (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={`absolute left-0 right-0 z-30 mt-3 overflow-hidden rounded-[28px] border p-2 backdrop-blur-xl ${accentTone.panel}`}
            >
              <div className="space-y-2">
                {options.map((option) => {
                  const active = option.value === value

                  return (
                    <motion.button
                      key={option.value}
                      type="button"
                      whileHover={{ x: 4 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                      className={`group flex w-full items-center justify-between rounded-[22px] border px-4 py-3 text-left transition-all duration-200 ${active ? accentTone.active : 'border-white/8 bg-white/[0.03]'} ${accentTone.hover}`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${active ? accentTone.dot : 'bg-white/20'}`} />
                          <span className="truncate font-display text-sm font-700 text-white">
                            {getOptionLabel(option, locale)}
                          </span>
                        </div>
                        <p className="mt-1 pl-4 text-[11px] font-mono uppercase tracking-[0.2em] text-white/32">
                          {option.value === 'auto' ? autoDetectLabel : option.value.toUpperCase()}
                        </p>
                      </div>

                      <span className={`ml-4 flex h-9 w-9 items-center justify-center rounded-2xl border transition-all ${active ? `border-white/12 bg-white/[0.08] ${accentTone.text}` : 'border-white/8 bg-white/[0.03] text-white/28 group-hover:text-white/60'}`}>
                        <Check className="h-4 w-4" />
                      </span>
                    </motion.button>
                  )
                })}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  )
}

function SettingsMetric({ label, value, tone }) {
  return (
    <div className={`feature-metric border ${tone}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.2em] opacity-70">{label}</p>
      <p className="mt-2 font-display text-xl font-800 text-white">{value}</p>
    </div>
  )
}

export default function SettingsPage() {
  const { user, fetchMe, setUser, logout } = useAuthStore()
  const { fetchStatus: refreshBotStatus } = useBotStore()
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const preferencesReadyRef = useRef(false)
  const lastSavedPreferencesRef = useRef({
    site_language: normalizePreference(user?.site_language),
    ai_language: normalizePreference(user?.ai_language),
  })
  const preferencesRequestRef = useRef(0)
  const quickTokenOwner = useMemo(() => ({
    id: user?.id || null,
    email: user?.email || null,
  }), [user?.id, user?.email])
  const fileInputRef = useRef(null)
  const [username, setUsername] = useState(user?.username || '')
  const [avatarDraft, setAvatarDraft] = useState(user?.avatar_url || '')
  const [avatarFileName, setAvatarFileName] = useState('')
  const [isPreparingAvatar, setIsPreparingAvatar] = useState(false)
  const [passwords, setPasswords] = useState({ currentPassword:'', newPassword:'' })
  const [botToken, setBotToken] = useState('')
  const [quickToken, setSavedQuickToken] = useState('')
  const [privateEmail, setPrivateEmail] = useState('')
  const [showPrivateEmail, setShowPrivateEmail] = useState(false)
  const [loadingPrivateEmail, setLoadingPrivateEmail] = useState(false)
  const [preferences, setPreferences] = useState({
    site_language: normalizePreference(user?.site_language),
    ai_language: normalizePreference(user?.ai_language),
  })
  const [saving, setSaving] = useState(null)
  const canRevealPrimaryEmail = !!(
    user?.is_primary_founder
    || (user?.role === 'founder' && user?.email === '********@********.***')
  )
  const displayedEmail = canRevealPrimaryEmail && showPrivateEmail && privateEmail
    ? privateEmail
    : user?.email
  const roleBadgeClass = user?.role === 'founder'
    ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
    : user?.role === 'admin'
    ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20'
    : user?.role === 'api_provider'
    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
    : 'bg-white/5 text-white/40 border border-white/10'

  useEffect(() => {
    fetchMe().catch(() => {})
  }, [fetchMe])

  useEffect(() => {
    let active = true

    setUsername(user?.username || '')
    setAvatarDraft(user?.avatar_url || '')
    setAvatarFileName('')
    const nextPreferences = {
      site_language: normalizePreference(user?.site_language),
      ai_language: normalizePreference(user?.ai_language),
    }
    setPreferences(nextPreferences)
    lastSavedPreferencesRef.current = nextPreferences
    preferencesReadyRef.current = true
    setPrivateEmail('')
    setShowPrivateEmail(false)

    const loadQuickToken = async () => {
      const savedToken = await getQuickBotToken(quickTokenOwner)
      if (!active) return
      setSavedQuickToken(savedToken)
      setBotToken((currentToken) => currentToken || savedToken)
    }

    loadQuickToken()

    return () => {
      active = false
    }
  }, [user?.id, user?.username, user?.email, user?.avatar_url, user?.role, quickTokenOwner])

  useEffect(() => {
    if (!preferencesReadyRef.current || !user?.id) return undefined

    const nextPreferences = {
      site_language: normalizePreference(preferences.site_language),
      ai_language: normalizePreference(preferences.ai_language),
    }
    const lastSavedPreferences = lastSavedPreferencesRef.current

    if (
      nextPreferences.site_language === lastSavedPreferences.site_language
      && nextPreferences.ai_language === lastSavedPreferences.ai_language
    ) {
      return undefined
    }

    const requestId = preferencesRequestRef.current + 1
    preferencesRequestRef.current = requestId
    const previousUser = user
    const timer = window.setTimeout(async () => {
      setSaving('preferences')
      setUser({ ...previousUser, ...nextPreferences })

      try {
        const res = await authAPI.updatePreferences(nextPreferences)
        if (preferencesRequestRef.current !== requestId) return

        lastSavedPreferencesRef.current = nextPreferences
        if (res.data?.user) {
          setUser(res.data.user)
        } else {
          await fetchMe()
        }
      } catch (e) {
        if (preferencesRequestRef.current !== requestId) return
        setPreferences(lastSavedPreferences)
        setUser(previousUser)
        toast.error(getErrorMessage(e, 'Impossible de mettre a jour la langue.'))
      } finally {
        if (preferencesRequestRef.current === requestId) {
          setSaving((current) => (current === 'preferences' ? null : current))
        }
      }
    }, 260)

    return () => window.clearTimeout(timer)
  }, [preferences.site_language, preferences.ai_language, user?.id, fetchMe, setUser])

  const togglePrivateEmail = async () => {
    if (!canRevealPrimaryEmail) return

    if (showPrivateEmail) {
      setShowPrivateEmail(false)
      return
    }

    if (privateEmail) {
      setShowPrivateEmail(true)
      return
    }

    setLoadingPrivateEmail(true)
    try {
      const res = await authAPI.getPrivateEmail()
      setPrivateEmail(res.data.email || '')
      setShowPrivateEmail(true)
    } catch (e) {
      toast.error(e?.response?.data?.error || e.message || 'Redemarre le backend pour charger cette protection.')
    }
    setLoadingPrivateEmail(false)
  }

  const saveAvatar = async (nextAvatar = avatarDraft) => {
    setSaving('avatar')
    try {
      const res = await authAPI.updateAvatar(nextAvatar || '')
      if (res.data?.user) {
        setUser(res.data.user)
        setAvatarDraft(res.data.user.avatar_url || '')
      }
      await fetchMe()
      setAvatarFileName('')
      toast.success(t('settings.avatarSaved'))
    } catch (e) {
      toast.error(getErrorMessage(e, 'Impossible d enregistrer cette photo.'))
    }
    setSaving(null)
  }

  const onAvatarChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setIsPreparingAvatar(true)
    try {
      const nextAvatar = await prepareAvatarDataUrl(file)
      setAvatarDraft(nextAvatar)
      setAvatarFileName(file.name)
      await saveAvatar(nextAvatar)
    } catch (e) {
      toast.error(getErrorMessage(e, 'Impossible de mettre cette photo.'))
    }
    setIsPreparingAvatar(false)
  }

  const saveUsername = async () => {
    setSaving('username')
    try {
      await authAPI.changeUsername(username)
      await fetchMe()
      toast.success(t('settings.usernameSaved'))
    } catch (e) {
      toast.error(e.message)
    }
    setSaving(null)
  }

  const savePassword = async () => {
    setSaving('password')
    try {
      await authAPI.changePassword(passwords)
      toast.success(t('settings.passwordSaved'))
      setPasswords({ currentPassword:'', newPassword:'' })
    } catch (e) {
      toast.error(e.message)
    }
    setSaving(null)
  }

  const saveToken = async () => {
    if (!botToken.trim()) return toast.error(t('settings.tokenRequired'))
    setSaving('token')
    try {
      const normalizedToken = botToken.trim()
      await authAPI.setBotToken(normalizedToken)
      await setQuickBotToken(quickTokenOwner, normalizedToken)
      setSavedQuickToken(normalizedToken)
      await fetchMe()
      await refreshBotStatus()
      toast.success(t('settings.tokenSaved'))
      setBotToken('')
    } catch (e) {
      toast.error(e.message)
    }
    setSaving(null)
  }

  const backToLogin = () => {
    logout()
    navigate('/auth')
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] space-y-5">
          <div className="space-y-3">
            <span className="feature-chip">
              <Save className="w-3.5 h-3.5" />
              {t('settings.heroChip')}
            </span>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">{t('settings.title')}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">
                {t('settings.heroDescription')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <span className="feature-chip text-white/70">
                <User className="w-3.5 h-3.5" />
                {t('settings.accountChip')}
              </span>
              <span className="feature-chip text-white/70">
                <Languages className="w-3.5 h-3.5" />
                {t('settings.languagesChip')}
              </span>
              <span className="feature-chip text-white/70">
                <Key className="w-3.5 h-3.5" />
                {t('settings.botChip')}
              </span>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <SettingsMetric label={t('settings.roleMetric')} value={getRoleLabel(t, user?.role)} tone={roleBadgeClass} />
            <SettingsMetric label={t('settings.siteLanguage')} value={getOptionLabel(SITE_LANGUAGE_OPTIONS.find((option) => option.value === preferences.site_language) || SITE_LANGUAGE_OPTIONS[0], locale)} tone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan" />
            <SettingsMetric label={t('settings.aiLanguage')} value={getOptionLabel(AI_LANGUAGE_OPTIONS.find((option) => option.value === preferences.ai_language) || AI_LANGUAGE_OPTIONS[0], locale)} tone="border-neon-violet/20 bg-neon-violet/10 text-neon-violet" />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
        <div className="space-y-5">
          <SettingsPanel
            icon={User}
            iconTone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan"
            title={t('settings.profile')}
            hint={t('settings.profileHint')}
          >
            <div className="flex items-center gap-4 rounded-[24px] border border-white/8 bg-black/15 p-4">
              <div className="w-16 h-16 rounded-[22px] bg-gradient-to-br from-neon-cyan to-neon-violet flex items-center justify-center font-display font-800 text-2xl text-white shrink-0 overflow-hidden shadow-[0_18px_44px_rgba(0,0,0,0.28)]">
                {avatarDraft ? <img src={avatarDraft} className="w-full h-full object-cover" alt="" /> : user?.username?.[0]?.toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="font-display font-700 text-white">{user?.username}</p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm text-white/40 break-all">{displayedEmail}</p>
                  {canRevealPrimaryEmail && (
                    <button
                      type="button"
                      onClick={togglePrivateEmail}
                      disabled={loadingPrivateEmail}
                      title={showPrivateEmail ? t('settings.hidePrivateEmail') : t('settings.showPrivateEmail')}
                      className="w-6 h-6 rounded-full border border-white/10 bg-white/[0.04] text-[10px] leading-none font-mono text-white/60 hover:text-white hover:bg-white/[0.08] transition-all disabled:opacity-40"
                    >
                      *
                    </button>
                  )}
                </div>
                {canRevealPrimaryEmail && (
                  <p className="text-[11px] text-white/25 font-mono mt-1">{t('settings.privateEmailHint')}</p>
                )}
                <span className={`badge mt-2 capitalize ${roleBadgeClass}`}>{getRoleLabel(t, user?.role)}</span>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={onAvatarChange}
            />

            <div className="space-y-2">
              <div className="flex flex-wrap gap-3">
                <button onClick={() => fileInputRef.current?.click()} type="button" className="px-4 py-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.08] transition-all">
                  <span className="inline-flex items-center gap-2">
                    <ImagePlus className="w-4 h-4" />
                    {isPreparingAvatar ? t('settings.avatarProcessing') : t('settings.avatarChoose')}
                  </span>
                </button>
                <button onClick={saveAvatar} disabled={saving==='avatar' || isPreparingAvatar || avatarDraft === (user?.avatar_url || '')} type="button" className="px-4 py-2.5 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40">
                  {saving==='avatar' ? t('settings.saving') : t('settings.avatarSave')}
                </button>
                <button onClick={() => { setAvatarDraft(''); setAvatarFileName('') }} disabled={!avatarDraft} type="button" className="px-4 py-2.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono hover:bg-red-500/20 transition-all disabled:opacity-40">
                  <span className="inline-flex items-center gap-2">
                    <Trash2 className="w-4 h-4" />
                    {t('settings.avatarRemove')}
                  </span>
                </button>
              </div>
              {avatarFileName && <p className="text-xs text-white/35 font-mono">{avatarFileName}</p>}
              <p className="text-xs text-white/35">{t('settings.avatarHint')}</p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <input className="input-field" value={username} onChange={e => setUsername(e.target.value)} placeholder={t('settings.usernamePlaceholder')} />
              <button onClick={saveUsername} disabled={saving==='username' || !username.trim()} className="px-5 py-3 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono whitespace-nowrap hover:bg-neon-cyan/20 transition-all disabled:opacity-40">
                {saving==='username' ? t('settings.saving') : <Save className="w-4 h-4" />}
              </button>
            </div>
          </SettingsPanel>

          <SettingsPanel
            icon={Languages}
            iconTone="border-emerald-500/20 bg-emerald-500/10 text-emerald-400"
            title={t('settings.preferences')}
            hint={t('settings.preferencesHint')}
          >
            <div className="grid sm:grid-cols-2 gap-3">
              <PreferenceSelect
                label={t('settings.siteLanguage')}
                value={preferences.site_language}
                options={SITE_LANGUAGE_OPTIONS}
                locale={locale}
                accent="cyan"
                onChange={(nextValue) => setPreferences((prev) => ({ ...prev, site_language: normalizePreference(nextValue) }))}
              />
              <PreferenceSelect
                label={t('settings.aiLanguage')}
                value={preferences.ai_language}
                options={AI_LANGUAGE_OPTIONS}
                locale={locale}
                accent="violet"
                onChange={(nextValue) => setPreferences((prev) => ({ ...prev, ai_language: normalizePreference(nextValue) }))}
              />
            </div>
          </SettingsPanel>

          <SettingsPanel
            icon={Lock}
            iconTone="border-neon-violet/20 bg-neon-violet/10 text-neon-violet"
            title={t('settings.passwordTitle')}
            hint={t('settings.passwordHint')}
          >
            <input type="password" className="input-field" placeholder={t('settings.currentPassword')} value={passwords.currentPassword} onChange={e => setPasswords({...passwords, currentPassword:e.target.value})} autoComplete="current-password" />
            <input type="password" className="input-field" placeholder={t('settings.newPassword')} value={passwords.newPassword} onChange={e => setPasswords({...passwords, newPassword:e.target.value})} autoComplete="new-password" />
            <button onClick={savePassword} disabled={saving==='password' || !passwords.currentPassword || !passwords.newPassword} className="px-5 py-3 rounded-2xl bg-neon-violet/10 border border-neon-violet/30 text-neon-violet text-sm font-mono hover:bg-neon-violet/20 transition-all disabled:opacity-40">
              {saving==='password' ? t('settings.saving') : t('settings.update')}
            </button>
          </SettingsPanel>
        </div>

        <div className="space-y-5">
          <SettingsPanel
            icon={Key}
            iconTone="border-amber-500/20 bg-amber-500/10 text-amber-400"
            title={t('settings.botTokenTitle')}
            hint={t('settings.botTokenHint')}
          >
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4 space-y-3">
              <label className="text-xs font-mono text-white/40 block">{t('settings.quickTokenTitle')}</label>
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
                    onClick={() => setBotToken(quickToken)}
                    className="px-4 py-3 rounded-2xl bg-white/[0.03] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.06] transition-all"
                  >
                    {t('settings.quickTokenUse')}
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-3 text-xs text-white/35">
                  {t('settings.quickTokenEmpty')}
                </div>
              )}
              <p className="text-xs text-white/30">{t('settings.quickTokenHint')}</p>
            </div>

            <div className="relative">
              <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20" />
              <input
                type="text"
                className="input-field secret-field pl-10"
                placeholder={t('settings.botTokenPlaceholder')}
                value={botToken}
                onChange={e => setBotToken(e.target.value)}
                name="bot-secret-entry"
                autoComplete="one-time-code"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
              />
            </div>

            <button onClick={saveToken} disabled={!botToken || saving==='token'} className="px-5 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-mono hover:bg-amber-500/20 transition-all disabled:opacity-40">
              {saving==='token' ? t('settings.updatingToken') : t('settings.updateToken')}
            </button>
          </SettingsPanel>

          <SettingsPanel
            icon={Lock}
            iconTone="border-red-500/20 bg-red-500/10 text-red-400"
            title={t('settings.reconnectTitle')}
            hint={t('settings.reconnectHint')}
          >
            <button
              type="button"
              onClick={backToLogin}
              className="px-5 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono hover:bg-red-500/20 transition-all"
            >
              {t('settings.backToLogin')}
            </button>
          </SettingsPanel>
        </div>
      </div>
    </div>
  )
}
