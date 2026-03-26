import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Key, User, Lock, Languages, ImagePlus, Trash2 } from 'lucide-react'
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

export default function SettingsPage() {
  const { user, fetchMe, setUser, logout } = useAuthStore()
  const { fetchStatus: refreshBotStatus } = useBotStore()
  const { t, locale } = useI18n()
  const navigate = useNavigate()
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
    setPreferences({
      site_language: normalizePreference(user?.site_language),
      ai_language: normalizePreference(user?.ai_language),
    })
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
  }, [user?.id, user?.username, user?.email, user?.avatar_url, user?.site_language, user?.ai_language, user?.role, quickTokenOwner])

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

  const savePreferences = async () => {
    setSaving('preferences')
    try {
      const res = await authAPI.updatePreferences(preferences)
      if (res.data?.user) {
        setUser(res.data.user)
      } else {
        await fetchMe()
      }
      toast.success(t('settings.preferencesSaved'))
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
    <div className="px-4 py-5 sm:p-6 max-w-2xl mx-auto space-y-5">
      <h1 className="font-display font-800 text-2xl text-white">{t('settings.title')}</h1>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <User className="w-4 h-4 text-neon-cyan" />
          <p className="font-display font-600 text-white/60 text-sm uppercase tracking-wider">{t('settings.profile')}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-neon-cyan to-neon-violet flex items-center justify-center font-display font-800 text-2xl text-white shrink-0">
            {avatarDraft ? <img src={avatarDraft} className="w-full h-full rounded-2xl object-cover" alt="" /> : user?.username?.[0]?.toUpperCase()}
          </div>
          <div>
            <p className="font-display font-600 text-white">{user?.username}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm text-white/40">{displayedEmail}</p>
              {canRevealPrimaryEmail && (
                <button
                  type="button"
                  onClick={togglePrivateEmail}
                  disabled={loadingPrivateEmail}
                  title={showPrivateEmail ? t('settings.hidePrivateEmail') : t('settings.showPrivateEmail')}
                  className="w-5 h-5 rounded-full border border-white/10 bg-white/[0.04] text-[10px] leading-none font-mono text-white/60 hover:text-white hover:bg-white/[0.08] transition-all disabled:opacity-40"
                >
                  *
                </button>
              )}
            </div>
            {canRevealPrimaryEmail && (
              <p className="text-[11px] text-white/25 font-mono mt-1">{t('settings.privateEmailHint')}</p>
            )}
            <span className={`badge mt-1 capitalize ${roleBadgeClass}`}>{getRoleLabel(t, user?.role)}</span>
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
            <button onClick={() => fileInputRef.current?.click()} type="button" className="px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.08] transition-all">
              <span className="inline-flex items-center gap-2">
                <ImagePlus className="w-4 h-4" />
                {isPreparingAvatar ? t('settings.avatarProcessing') : t('settings.avatarChoose')}
              </span>
            </button>
            <button onClick={saveAvatar} disabled={saving==='avatar' || isPreparingAvatar || avatarDraft === (user?.avatar_url || '')} type="button" className="px-4 py-2 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40">
              {saving==='avatar' ? t('settings.saving') : t('settings.avatarSave')}
            </button>
            <button onClick={() => { setAvatarDraft(''); setAvatarFileName('') }} disabled={!avatarDraft} type="button" className="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono hover:bg-red-500/20 transition-all disabled:opacity-40">
              <span className="inline-flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                {t('settings.avatarRemove')}
              </span>
            </button>
          </div>
          {avatarFileName && <p className="text-xs text-white/35 font-mono">{avatarFileName}</p>}
          <p className="text-xs text-white/35">{t('settings.avatarHint')}</p>
        </div>
        <div className="flex gap-3">
          <input className="input-field" value={username} onChange={e => setUsername(e.target.value)} placeholder={t('settings.usernamePlaceholder')} />
          <button onClick={saveUsername} disabled={saving==='username' || !username.trim()} className="px-5 py-2 rounded-xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono whitespace-nowrap hover:bg-neon-cyan/20 transition-all disabled:opacity-40">
            {saving==='username' ? t('settings.saving') : <Save className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Languages className="w-4 h-4 text-green-400" />
          <p className="font-display font-600 text-white/60 text-sm uppercase tracking-wider">{t('settings.preferences')}</p>
        </div>
        <p className="text-xs text-white/40">{t('settings.preferencesHint')}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono text-white/40 mb-1.5 block">{t('settings.siteLanguage')}</label>
            <select className="select-field" value={preferences.site_language} onChange={e => setPreferences((prev) => ({ ...prev, site_language: e.target.value }))}>
              {SITE_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{getOptionLabel(option, locale)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-mono text-white/40 mb-1.5 block">{t('settings.aiLanguage')}</label>
            <select className="select-field" value={preferences.ai_language} onChange={e => setPreferences((prev) => ({ ...prev, ai_language: e.target.value }))}>
              {AI_LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{getOptionLabel(option, locale)}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-green-400/70">{t('settings.aiLanguageHelp')}</p>
        <button onClick={savePreferences} disabled={saving==='preferences'} className="px-5 py-2 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-mono hover:bg-green-500/20 transition-all disabled:opacity-40">
          {saving==='preferences' ? t('settings.saving') : t('settings.save')}
        </button>
      </div>

      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-neon-violet" />
          <p className="font-display font-600 text-white/60 text-sm uppercase tracking-wider">{t('settings.passwordTitle')}</p>
        </div>
        <input type="password" className="input-field" placeholder={t('settings.currentPassword')} value={passwords.currentPassword} onChange={e => setPasswords({...passwords, currentPassword:e.target.value})} autoComplete="current-password" />
        <input type="password" className="input-field" placeholder={t('settings.newPassword')} value={passwords.newPassword} onChange={e => setPasswords({...passwords, newPassword:e.target.value})} autoComplete="new-password" />
        <button onClick={savePassword} disabled={saving==='password' || !passwords.currentPassword || !passwords.newPassword} className="px-5 py-2 rounded-xl bg-neon-violet/10 border border-neon-violet/30 text-neon-violet text-sm font-mono hover:bg-neon-violet/20 transition-all disabled:opacity-40">
          {saving==='password' ? t('settings.saving') : t('settings.update')}
        </button>
      </div>

      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Key className="w-4 h-4 text-amber-400" />
          <p className="font-display font-600 text-white/60 text-sm uppercase tracking-wider">{t('settings.botTokenTitle')}</p>
        </div>
        <p className="text-xs text-amber-400/70">{t('settings.botTokenHint')}</p>
        <div className="space-y-2">
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
        <button onClick={saveToken} disabled={!botToken || saving==='token'} className="px-5 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm font-mono hover:bg-amber-500/20 transition-all disabled:opacity-40">
          {saving==='token' ? t('settings.updatingToken') : t('settings.updateToken')}
        </button>
      </div>

      <div className="glass-card p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-white/60" />
          <p className="font-display font-600 text-white/60 text-sm uppercase tracking-wider">
            {t('settings.reconnectTitle', 'Connexion')}
          </p>
        </div>
        <p className="text-xs text-white/40">
          {t('settings.reconnectHint', 'Reviens a la page de connexion pour te reconnecter avec une autre adresse mail si tu veux.')}
        </p>
        <button
          type="button"
          onClick={backToLogin}
          className="px-5 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-mono hover:bg-red-500/20 transition-all"
        >
          {t('settings.backToLogin', 'Retour connexion')}
        </button>
      </div>
    </div>
  )
}
