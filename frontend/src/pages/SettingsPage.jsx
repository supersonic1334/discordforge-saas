import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Save, Key, User, Lock, Languages, ImagePlus, Trash2, Link2, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { authAPI, teamAPI } from '../services/api'
import { useAuthStore, useBotStore, useGuildStore } from '../stores'
import { AI_LANGUAGE_OPTIONS, SITE_LANGUAGE_OPTIONS, getOptionLabel, useI18n } from '../i18n'
import { prepareAvatarDataUrl } from '../utils/avatarUpload'
import { getQuickBotToken, setQuickBotToken } from '../utils/quickBotToken'
import { openDiscordLinkPopup } from '../utils/discordLinkPopup'

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

function extractFilenameFromDisposition(header) {
  const raw = String(header || '')
  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) return decodeURIComponent(utf8Match[1])
  const classicMatch = raw.match(/filename="?([^";]+)"?/i)
  return classicMatch?.[1] || 'backup.json'
}

async function readJsonFile(file) {
  const raw = await file.text()
  return JSON.parse(raw)
}

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}

function SettingsPanel({ icon: Icon, iconTone, title, hint, children }) {
  const __unusedExportGuildBackupSafe = async () => {
    if (!selectedGuildId) return toast.error('Choisis un serveur avant de créer une sauvegarde.')
    if (!canManageGuildBackup) return toast.error('Cette sauvegarde est réservée au propriétaire principal du serveur.')

    setSaving('backup-export')
    try {
      const response = await teamAPI.exportBackup(selectedGuildId)
      const filename = extractFilenameFromDisposition(response.headers?.['content-disposition'])
      downloadBlob(new Blob([response.data], { type: 'application/json' }), filename)
      toast.success('Sauvegarde téléchargée')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Impossible de télécharger la sauvegarde.'))
    }
    setSaving(null)
  }

  const __unusedHandleBackupFileChangeSafe = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const parsed = await readJsonFile(file)
      const payload = parsed?.backup || parsed?.payload || parsed
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Fichier de sauvegarde invalide.')
      }

      setBackupFile(payload)
      setBackupFileMeta({
        name: file.name,
        guildName: parsed?.guild?.name || '',
        exportedAt: parsed?.exported_at || '',
      })
      toast.success('Fichier chargé')
    } catch (error) {
      setBackupFile(null)
      setBackupFileMeta(null)
      toast.error(getErrorMessage(error, 'Fichier de sauvegarde invalide.'))
    }
  }

  const __unusedImportGuildBackupSafe = async () => {
    if (!selectedGuildId) return toast.error("Choisis un serveur avant d'importer une sauvegarde.")
    if (!canManageGuildBackup) return toast.error('Cette sauvegarde est réservée au propriétaire principal du serveur.')
    if (!backupFile) return toast.error("Choisis d'abord un fichier de sauvegarde.")

    setSaving('backup-import')
    try {
      await teamAPI.importBackup(selectedGuildId, { backup: backupFile })
      setBackupFile(null)
      setBackupFileMeta(null)
      toast.success('Sauvegarde importée')
    } catch (error) {
      toast.error(getErrorMessage(error, "Impossible d'importer cette sauvegarde."))
    }
    setSaving(null)
  }

  const exportGuildBackupSafe = async () => {
    if (!selectedGuildId) return toast.error('Choisis un serveur avant de créer une sauvegarde.')
    if (!canManageGuildBackup) return toast.error('Cette sauvegarde est réservée au propriétaire principal du serveur.')

    setSaving('backup-export')
    try {
      const response = await teamAPI.exportBackup(selectedGuildId)
      const filename = extractFilenameFromDisposition(response.headers?.['content-disposition'])
      downloadBlob(new Blob([response.data], { type: 'application/json' }), filename)
      toast.success('Sauvegarde téléchargée')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Impossible de télécharger la sauvegarde.'))
    }
    setSaving(null)
  }

  const handleBackupFileChangeSafe = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const parsed = await readJsonFile(file)
      const payload = parsed?.backup || parsed?.payload || parsed
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Fichier de sauvegarde invalide.')
      }

      setBackupFile(payload)
      setBackupFileMeta({
        name: file.name,
        guildName: parsed?.guild?.name || '',
        exportedAt: parsed?.exported_at || '',
      })
      toast.success('Fichier chargé')
    } catch (error) {
      setBackupFile(null)
      setBackupFileMeta(null)
      toast.error(getErrorMessage(error, 'Fichier de sauvegarde invalide.'))
    }
  }

  const importGuildBackupSafe = async () => {
    if (!selectedGuildId) return toast.error("Choisis un serveur avant d'importer une sauvegarde.")
    if (!canManageGuildBackup) return toast.error('Cette sauvegarde est réservée au propriétaire principal du serveur.')
    if (!backupFile) return toast.error("Choisis d'abord un fichier de sauvegarde.")

    setSaving('backup-import')
    try {
      await teamAPI.importBackup(selectedGuildId, { backup: backupFile })
      setBackupFile(null)
      setBackupFileMeta(null)
      toast.success('Sauvegarde importée')
    } catch (error) {
      toast.error(getErrorMessage(error, "Impossible d'importer cette sauvegarde."))
    }
    setSaving(null)
  }

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
  return (
    <div className="space-y-2">
      <label className="text-xs font-mono text-white/40 block">{label}</label>
      <select
        className={`select-field ${accent === 'violet' ? 'focus:border-neon-violet/50' : 'focus:border-neon-cyan/50'}`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {getOptionLabel(option, locale)}
          </option>
        ))}
      </select>
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
  const { guilds, selectedGuildId, selectGuild, fetchGuilds } = useGuildStore()
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
  const backupInputRef = useRef(null)
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
  const [backupFile, setBackupFile] = useState(null)
  const [backupFileMeta, setBackupFileMeta] = useState(null)
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
  const profileAvatarPreview = avatarDraft || user?.display_avatar_url || user?.avatar_url || ''
  const selectedGuild = useMemo(
    () => guilds.find((entry) => String(entry.id) === String(selectedGuildId || '')) || null,
    [guilds, selectedGuildId],
  )
  const canManageGuildBackup = Boolean(
    selectedGuildId && (
      selectedGuild?.is_owner
      || selectedGuild?.access_role === 'owner'
      || selectedGuild?.user_id === user?.id
    ),
  )

  useEffect(() => {
    fetchMe().catch(() => {})
  }, [fetchMe])

  useEffect(() => {
    if (guilds.length === 0) {
      fetchGuilds().catch(() => {})
    }
  }, [fetchGuilds, guilds.length])

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
    const normalizedAvatar = typeof nextAvatar === 'string'
      ? nextAvatar
      : avatarDraft

    setSaving('avatar')
    try {
      const res = await authAPI.updateAvatar(normalizedAvatar || '')
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

  const reconnectDiscord = async () => {
    setSaving('discord-link')
    try {
      const response = await authAPI.createDiscordLink({
        return_to: '/dashboard/settings',
        mode: 'popup',
        force_prompt: true,
      })
      const nextUrl = response?.data?.url
      if (!nextUrl) throw new Error('Lien Discord indisponible')

      const linkResult = await openDiscordLinkPopup(nextUrl)
      if (linkResult?.status !== 'success') {
        throw new Error(linkResult?.error || 'Liaison Discord impossible')
      }

      setUser({
        ...(useAuthStore.getState().user || {}),
        discord_id: String(linkResult?.linkedDiscordId || '').trim() || null,
        discord_username: String(linkResult?.linkedDiscordUsername || '').trim() || null,
        discord_global_name: String(linkResult?.linkedDiscordGlobalName || '').trim() || null,
        discord_avatar_url: String(linkResult?.linkedDiscordAvatarUrl || '').trim() || null,
      })

      await fetchMe()
      await fetchGuilds({ force: true })
      toast.success(user?.discord_id ? 'Compte Discord mis a jour' : 'Compte Discord lie')
    } catch (e) {
      if (String(e?.message || '') !== 'Popup fermee') {
        toast.error(getErrorMessage(e, 'Impossible de changer le compte Discord.'))
      }
    }
    setSaving(null)
  }

  const exportGuildBackup = async () => {
    if (!selectedGuildId) return toast.error('Choisis un serveur avant de créer une sauvegarde.')
    if (!canManageGuildBackup) return toast.error('Cette sauvegarde est réservée au propriétaire principal du serveur.')

    setSaving('backup-export')
    try {
      const response = await teamAPI.exportBackup(selectedGuildId)
      const filename = extractFilenameFromDisposition(response.headers?.['content-disposition'])
      downloadBlob(new Blob([response.data], { type: 'application/json' }), filename)
      toast.success('Sauvegarde téléchargée')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Impossible de télécharger la sauvegarde.'))
    }
    setSaving(null)
  }

  const handleBackupFileChange = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const parsed = await readJsonFile(file)
      const payload = parsed?.backup || parsed?.payload || parsed
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('Fichier de sauvegarde invalide.')
      }

      setBackupFile(parsed)
      setBackupFileMeta({
        name: file.name,
        guildName: parsed?.guild?.name || '',
        exportedAt: parsed?.exported_at || '',
      })
      toast.success('Fichier chargé')
    } catch (error) {
      setBackupFile(null)
      setBackupFileMeta(null)
      toast.error(getErrorMessage(error, 'Fichier de sauvegarde invalide.'))
    }
  }

  const importGuildBackup = async () => {
    if (!selectedGuildId) return toast.error("Choisis un serveur avant d'importer une sauvegarde.")
    if (!canManageGuildBackup) return toast.error('Cette sauvegarde est réservée au propriétaire principal du serveur.')
    if (!backupFile) return toast.error("Choisis d'abord un fichier de sauvegarde.")

    setSaving('backup-import')
    try {
      await teamAPI.importBackup(selectedGuildId, { backup: backupFile })
      setBackupFile(null)
      setBackupFileMeta(null)
      toast.success('Sauvegarde importée')
    } catch (error) {
      toast.error(getErrorMessage(error, "Impossible d'importer cette sauvegarde."))
    }
    setSaving(null)
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
                {profileAvatarPreview ? <img src={profileAvatarPreview} className="w-full h-full object-cover" alt="" /> : user?.username?.[0]?.toUpperCase()}
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
                <button onClick={() => saveAvatar()} disabled={saving==='avatar' || isPreparingAvatar || avatarDraft === (user?.avatar_url || '')} type="button" className="px-4 py-2.5 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40">
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
            icon={Link2}
            iconTone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan"
            title="Compte Discord lie"
            hint="Choisis ici le compte Discord utilise pour les actions rapides, le scan et l assistant IA."
          >
            <div className="rounded-2xl border border-white/8 bg-black/15 p-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-[20px] border border-white/10 bg-white/[0.04] overflow-hidden shrink-0 flex items-center justify-center text-white/45 font-display font-700">
                  {user?.discord_avatar_url ? (
                    <img src={user.discord_avatar_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (user?.discord_global_name || user?.discord_username || '?').slice(0, 1).toUpperCase()
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display font-700 text-white truncate">
                    {user?.discord_global_name || user?.discord_username || 'Aucun compte Discord lie'}
                  </p>
                  <p className="mt-1 text-sm text-white/40 break-all">
                    {user?.discord_username ? `@${user.discord_username}` : 'Lie un compte Discord pour utiliser les actions staff securisees.'}
                  </p>
                  {user?.discord_id && (
                    <p className="mt-1 text-[11px] font-mono text-white/28 break-all">ID Discord: {user.discord_id}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={reconnectDiscord}
                disabled={saving === 'discord-link'}
                className="px-5 py-3 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40"
              >
                {saving === 'discord-link'
                  ? 'Connexion...'
                  : (user?.discord_id ? 'Changer le compte Discord' : 'Lier mon compte Discord')}
              </button>
              <p className="self-center text-xs text-white/30">
                Si Discord ouvre le mauvais compte, clique sur le changement de compte dans la popup puis reconnecte-toi.
              </p>
            </div>
          </SettingsPanel>

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
            icon={Save}
            iconTone="border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan"
            title="Sauvegarde serveur"
            hint="Télécharge un fichier complet puis réimporte-le en un clic pour restaurer ta configuration."
          >
            <div className="space-y-3">
              <div className="space-y-2">
                <label className="text-xs font-mono text-white/40 block">Serveur ciblé</label>
                <select
                  className="select-field"
                  value={selectedGuildId || ''}
                  onChange={(event) => selectGuild(event.target.value || null)}
                >
                  <option value="">Choisir un serveur</option>
                  {guilds.map((guild) => (
                    <option key={guild.id} value={guild.id}>
                      {guild.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-2xl border border-white/8 bg-black/15 px-4 py-4 text-sm leading-6 text-white/60">
                La sauvegarde inclut les protections, les commandes, les tickets, les notifications et les réglages de logs du serveur sélectionné.
              </div>

              {!selectedGuildId ? (
                <div className="rounded-2xl border border-amber-400/15 bg-amber-400/10 px-4 py-3 text-sm text-amber-100/80">
                  Sélectionne un serveur pour créer ou importer une sauvegarde.
                </div>
              ) : !canManageGuildBackup ? (
                <div className="rounded-2xl border border-red-400/15 bg-red-500/10 px-4 py-3 text-sm text-red-100/80">
                  Seul le propriétaire principal peut exporter ou importer une sauvegarde privée.
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={exportGuildBackupSafe}
                  disabled={!selectedGuildId || !canManageGuildBackup || saving === 'backup-export'}
                  className="px-5 py-3 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40"
                >
                  {saving === 'backup-export' ? 'Téléchargement...' : 'Télécharger la sauvegarde'}
                </button>

                <button
                  type="button"
                  onClick={() => backupInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-white/70 text-sm font-mono hover:bg-white/[0.08] transition-all"
                >
                  <Upload className="w-4 h-4" />
                  Choisir un fichier
                </button>

                <button
                  type="button"
                  onClick={importGuildBackupSafe}
                  disabled={!selectedGuildId || !canManageGuildBackup || !backupFile || saving === 'backup-import'}
                  className="px-5 py-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm font-mono hover:bg-emerald-500/20 transition-all disabled:opacity-40"
                >
                  {saving === 'backup-import' ? 'Import...' : 'Importer'}
                </button>
              </div>

              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleBackupFileChangeSafe}
              />

              {backupFileMeta ? (
                <div className="rounded-2xl border border-white/8 bg-black/15 px-4 py-4 text-sm text-white/65">
                  <p className="font-display font-700 text-white">{backupFileMeta.name}</p>
                  {backupFileMeta.guildName ? <p className="mt-1">Serveur source : {backupFileMeta.guildName}</p> : null}
                  {backupFileMeta.exportedAt ? <p className="mt-1">Exporté le : {new Date(backupFileMeta.exportedAt).toLocaleString('fr-FR')}</p> : null}
                </div>
              ) : null}
            </div>
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
