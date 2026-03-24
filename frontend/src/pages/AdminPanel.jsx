import { useEffect, useMemo, useState } from 'react'
import { Crown, Users, Bot, Activity, Ban, ShieldCheck, Settings2, ChevronDown, ChevronUp, Trash2, KeyRound, RefreshCw, Eye, EyeOff, Copy, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminAPI, authAPI } from '../services/api'
import { useI18n } from '../i18n'
import { useAuthStore } from '../stores'

const DEFAULT_AI_CFG = {
  provider: 'anthropic',
  api_key: '',
  model: 'claude-sonnet-4-6',
  max_tokens: 1024,
  temperature: 0.7,
  user_quota_tokens: 4000,
  site_quota_tokens: 20000,
  quota_window_hours: 5,
  auto_mode: true,
  quota: null,
  hasApiKey: false,
  auto_tuning: null,
  active_provider_key_id: '',
  provider_keys: [],
  provider_key_source: 'admin',
  provider_key_owner: null,
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function getRoleLabel(t, role) {
  if (role === 'api_provider') return t('admin.roles.api_provider', 'fournisseur API')
  return t(`admin.roles.${role}`, role || '')
}

function getProviderStatusLabel(locale, status) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  const labels = {
    fr: {
      valid: 'valide',
      quota_exhausted: 'quota vide',
      invalid: 'invalide',
      unknown: 'a verifier',
    },
    en: {
      valid: 'valid',
      quota_exhausted: 'quota empty',
      invalid: 'invalid',
      unknown: 'to check',
    },
    es: {
      valid: 'valida',
      quota_exhausted: 'cuota vacia',
      invalid: 'invalida',
      unknown: 'por verificar',
    },
  }

  return labels[key]?.[status] || labels.fr[status] || status
}

export default function AdminPanel() {
  const { t, locale } = useI18n()
  const currentUser = useAuthStore((state) => state.user)
  const currentUserId = currentUser?.id
  const canManageUsers = currentUser?.role === 'founder'
  const [tab, setTab] = useState(() => currentUser?.role === 'admin' ? 'ai' : 'users')
  const [users, setUsers] = useState([])
  const [sysInfo, setSysInfo] = useState(null)
  const [catalog, setCatalog] = useState([])
  const [aiCfg, setAiCfg] = useState(DEFAULT_AI_CFG)
  const [providerSearch, setProviderSearch] = useState('')
  const [modelSearch, setModelSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [updatingUserId, setUpdatingUserId] = useState(null)
  const [refreshingProviderKeyId, setRefreshingProviderKeyId] = useState(null)
  const [deletingProviderKeyId, setDeletingProviderKeyId] = useState(null)
  const [loadingProviderKeySecretId, setLoadingProviderKeySecretId] = useState(null)
  const [revealedProviderKeys, setRevealedProviderKeys] = useState({})
  const [copiedProviderKeyId, setCopiedProviderKeyId] = useState(null)
  const [openAdvancedUserId, setOpenAdvancedUserId] = useState(null)
  const [privateEmail, setPrivateEmail] = useState('')
  const [showPrivateEmail, setShowPrivateEmail] = useState(false)
  const [loadingPrivateEmail, setLoadingPrivateEmail] = useState(false)

  useEffect(() => {
    let cancelled = false
    const loadSystemInfo = () => {
      adminAPI.system().then((r) => {
        if (!cancelled) setSysInfo(r.data)
      }).catch(() => {})
    }

    loadSystemInfo()
    const intervalId = aiCfg.auto_mode ? window.setInterval(loadSystemInfo, 60000) : null

    return () => {
      cancelled = true
      if (intervalId) window.clearInterval(intervalId)
    }
  }, [aiCfg.auto_mode])

  useEffect(() => {
    let cancelled = false

    if (canManageUsers) {
      adminAPI.users().then((r) => {
        if (!cancelled) setUsers(r.data.users)
      }).catch(() => {})
    } else {
      setUsers([])
      setOpenAdvancedUserId(null)
    }

    adminAPI.getAI().then((r) => {
      if (cancelled) return
      setCatalog(r.data.catalog || [])
      setAiCfg((prev) => ({
        ...prev,
        ...r.data,
        api_key: '',
        hasApiKey: r.data.hasApiKey || false,
        model: r.data.model || prev.model,
        auto_mode: r.data.auto_mode ?? prev.auto_mode,
        site_quota_tokens: r.data.site_quota_tokens ?? prev.site_quota_tokens,
        auto_tuning: r.data.auto_tuning || prev.auto_tuning,
        active_provider_key_id: r.data.active_provider_key_id || '',
        provider_keys: r.data.provider_keys || [],
        provider_key_source: r.data.provider_key_source || 'admin',
        provider_key_owner: r.data.provider_key_owner || null,
      }))
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [canManageUsers])

  useEffect(() => {
    if (!canManageUsers && tab === 'users') {
      setTab('ai')
    }
    if (!canManageProviderPool && tab === 'provider_keys') {
      setTab('ai')
    }
  }, [canManageUsers, canManageProviderPool, tab])

  const selectedProvider = useMemo(
    () => catalog.find((provider) => provider.id === aiCfg.provider) || null,
    [catalog, aiCfg.provider]
  )

  useEffect(() => {
    setProviderSearch('')
    setModelSearch('')
  }, [aiCfg.provider])

  useEffect(() => {
    if (!aiCfg.auto_mode || !aiCfg.provider || !aiCfg.model) return

    let cancelled = false
    adminAPI.getAIRecommendation({
      provider: aiCfg.provider,
      model: aiCfg.model,
      quota_window_hours: aiCfg.quota_window_hours,
    }).then((r) => {
      if (cancelled) return
      setAiCfg((prev) => ({
        ...prev,
        model: r.data.model || prev.model,
        max_tokens: r.data.max_tokens ?? prev.max_tokens,
        temperature: r.data.temperature ?? prev.temperature,
        user_quota_tokens: r.data.user_quota_tokens ?? prev.user_quota_tokens,
        site_quota_tokens: r.data.site_quota_tokens ?? prev.site_quota_tokens,
        quota_window_hours: r.data.quota_window_hours ?? prev.quota_window_hours,
        auto_tuning: r.data.auto_tuning || prev.auto_tuning,
      }))
    }).catch(() => {})

    return () => {
      cancelled = true
    }
  }, [aiCfg.auto_mode, aiCfg.provider, aiCfg.model, aiCfg.quota_window_hours, sysInfo?.users, sysInfo?.connectedUsers])

  const modelOptions = useMemo(() => {
    return selectedProvider?.models || []
  }, [selectedProvider])

  useEffect(() => {
    if (!selectedProvider?.models?.length) return
    if (selectedProvider.models.some((model) => model.id === aiCfg.model)) return

    setAiCfg((prev) => ({
      ...prev,
      model: selectedProvider.defaultModel || selectedProvider.models[0]?.id || prev.model,
    }))
  }, [selectedProvider, aiCfg.model])

  const selectedModel = modelOptions.find((model) => model.id === aiCfg.model) || null
  const providerPool = useMemo(
    () => (aiCfg.provider_keys || []).filter((entry) => entry.provider === aiCfg.provider),
    [aiCfg.provider_keys, aiCfg.provider]
  )
  const providerLabelById = useMemo(
    () => Object.fromEntries((catalog || []).map((provider) => [provider.id, provider.label])),
    [catalog]
  )

  useEffect(() => {
    if (!aiCfg.active_provider_key_id) return
    if (providerPool.some((entry) => entry.id === aiCfg.active_provider_key_id)) return
    setAiCfg((prev) => ({ ...prev, active_provider_key_id: '' }))
  }, [providerPool, aiCfg.active_provider_key_id])

  const formatCount = (value) => Number(value || 0).toLocaleString(locale)
  const visibleProviders = useMemo(() => {
    const query = providerSearch.trim().toLowerCase()
    if (!query) return catalog

    const filtered = catalog.filter((provider) => (
      provider.label.toLowerCase().includes(query)
      || provider.id.toLowerCase().includes(query)
      || String(provider.description || '').toLowerCase().includes(query)
    ))

    return filtered.length ? filtered : (selectedProvider ? [selectedProvider] : [])
  }, [catalog, providerSearch, selectedProvider])
  const visibleModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    if (!query) return modelOptions

    const filtered = modelOptions.filter((model) => (
      model.label.toLowerCase().includes(query)
      || model.id.toLowerCase().includes(query)
      || String(model.description || '').toLowerCase().includes(query)
    ))

    return filtered.length ? filtered : (selectedModel ? [selectedModel] : [])
  }, [modelOptions, modelSearch, selectedModel])
  const currentPanelUser = useMemo(
    () => users.find((user) => user.id === currentUserId) || null,
    [users, currentUserId]
  )
  const canDeleteUsers = !!currentPanelUser?.is_primary_founder
  const canManageProviderPool = !!(currentUser?.is_primary_founder || currentPanelUser?.is_primary_founder)
  const canRevealPrimaryEmail = !!(
    currentUser?.is_primary_founder
    || (currentUser?.role === 'founder' && currentUser?.email === '********@********.***')
  )
  const roleOptions = useMemo(() => ([
    { value: 'member', label: t('admin.roles.member') },
    { value: 'admin', label: t('admin.roles.admin') },
    { value: 'founder', label: t('admin.roles.founder') },
    { value: 'api_provider', label: t('admin.roles.api_provider', 'fournisseur API') },
  ]), [t])
  const tabs = useMemo(() => {
    const availableTabs = [['ai', t('admin.tabs.ai')]]
    if (canManageUsers) {
      availableTabs.unshift(['users', t('admin.tabs.users')])
    }
    if (canManageProviderPool) {
      availableTabs.push(['provider_keys', t('admin.tabs.providerKeys', 'Cl\u00e9s fournisseurs')])
    }
    return availableTabs
  }, [canManageUsers, canManageProviderPool, t])
  const validProviderKeys = useMemo(
    () => (aiCfg.provider_keys || []).filter((entry) => entry.status === 'valid'),
    [aiCfg.provider_keys]
  )
  const invalidProviderKeys = useMemo(
    () => (aiCfg.provider_keys || []).filter((entry) => entry.status !== 'valid'),
    [aiCfg.provider_keys]
  )

  const handleProviderChange = (providerId) => {
    const provider = catalog.find((entry) => entry.id === providerId)
    setAiCfg((prev) => ({
      ...prev,
      provider: providerId,
      model: provider?.models.some((model) => model.id === prev.model)
        ? prev.model
        : provider?.defaultModel || provider?.models?.[0]?.id || prev.model,
    }))
  }

  const setRole = async (userId, role) => {
    setUpdatingUserId(userId)
    try {
      await adminAPI.setRole(userId, role)
      setUsers((prev) => prev.map((user) => user.id === userId ? { ...user, role } : user))
      toast.success(t('admin.roleUpdated'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setUpdatingUserId(null)
  }

  const setAccess = async (userId, isActive) => {
    setUpdatingUserId(userId)
    try {
      await adminAPI.setStatus(userId, isActive)
      setUsers((prev) => prev.map((user) => user.id === userId ? { ...user, is_active: isActive } : user))
      toast.success(t('admin.accessUpdated'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setUpdatingUserId(null)
  }

  const setPassword = async (userId) => {
    const newPassword = window.prompt(t('admin.passwordPrompt'))
    if (!newPassword) return

    setUpdatingUserId(userId)
    try {
      await adminAPI.setPassword(userId, newPassword)
      toast.success(t('admin.passwordUpdated'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setUpdatingUserId(null)
  }

  const deleteUser = async (userId) => {
    const targetUser = users.find((user) => user.id === userId)
    const confirmMessage = [t('admin.deleteConfirm'), targetUser?.email || ''].filter(Boolean).join('\n\n')
    if (!window.confirm(confirmMessage)) return

    setUpdatingUserId(userId)
    try {
      await adminAPI.deleteUser(userId)
      setUsers((prev) => prev.filter((user) => user.id !== userId))
      setOpenAdvancedUserId((current) => current === userId ? null : current)
      toast.success(t('admin.deleted'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setUpdatingUserId(null)
  }

  const refreshProviderKey = async (keyId) => {
    setRefreshingProviderKeyId(keyId)
    try {
      const res = await adminAPI.refreshProviderKey(keyId)
      const nextKey = res.data.key
      setAiCfg((prev) => ({
        ...prev,
        provider_keys: (prev.provider_keys || []).map((entry) => (
          entry.id === keyId ? nextKey : entry
        )),
      }))
      toast.success(t('admin.providerKeyRefreshed', 'Statut fournisseur actualise'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setRefreshingProviderKeyId(null)
  }

  const toggleProviderKeySecret = async (entry) => {
    if (!entry?.id || !canManageProviderPool) return

    if (revealedProviderKeys[entry.id]) {
      setRevealedProviderKeys((prev) => {
        const next = { ...prev }
        delete next[entry.id]
        return next
      })
      return
    }

    setLoadingProviderKeySecretId(entry.id)
    try {
      const res = await adminAPI.getProviderKeySecret(entry.id)
      setRevealedProviderKeys((prev) => ({ ...prev, [entry.id]: res.data }))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setLoadingProviderKeySecretId(null)
  }

  const copyProviderKeySecret = async (entry) => {
    if (!entry?.id || !canManageProviderPool) return

    let secretPayload = revealedProviderKeys[entry.id]
    if (!secretPayload) {
      setLoadingProviderKeySecretId(entry.id)
      try {
        const res = await adminAPI.getProviderKeySecret(entry.id)
        secretPayload = res.data
        setRevealedProviderKeys((prev) => ({ ...prev, [entry.id]: res.data }))
      } catch (e) {
        toast.error(getErrorMessage(e))
        setLoadingProviderKeySecretId(null)
        return
      }
      setLoadingProviderKeySecretId(null)
    }

    try {
      await navigator.clipboard.writeText(secretPayload.api_key)
      setCopiedProviderKeyId(entry.id)
      window.setTimeout(() => {
        setCopiedProviderKeyId((current) => current === entry.id ? null : current)
      }, 1800)
      toast.success(t('admin.providerPoolCopied', 'Cl\u00e9 API copi\u00e9e'))
    } catch {
      toast.error(t('admin.providerPoolCopyFailed', 'Copie impossible'))
    }
  }

  const deleteProviderKey = async (entry) => {
    if (!entry?.id || !canManageProviderPool) return
    if (!window.confirm(t('admin.providerKeyDeleteConfirm', 'Supprimer cette cl\u00e9 fournisseur pour tout le monde ?'))) return

    setDeletingProviderKeyId(entry.id)
    try {
      await adminAPI.deleteProviderKey(entry.id)
      setRevealedProviderKeys((prev) => {
        const next = { ...prev }
        delete next[entry.id]
        return next
      })
      setAiCfg((prev) => ({
        ...prev,
        provider_keys: (prev.provider_keys || []).filter((item) => item.id !== entry.id),
        active_provider_key_id: prev.active_provider_key_id === entry.id ? '' : prev.active_provider_key_id,
      }))
      toast.success(t('admin.providerKeyDeleted', 'Cl\u00e9 fournisseur supprim\u00e9e'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setDeletingProviderKeyId(null)
  }

  const saveAI = async () => {
    setSaving(true)
    try {
      const res = await adminAPI.setAI({
        provider: aiCfg.provider,
        api_key: aiCfg.api_key.trim(),
        model: aiCfg.model,
        max_tokens: Number(aiCfg.max_tokens),
        temperature: Number(aiCfg.temperature),
        user_quota_tokens: Number(aiCfg.user_quota_tokens),
        site_quota_tokens: Number(aiCfg.site_quota_tokens),
        quota_window_hours: Number(aiCfg.quota_window_hours),
        auto_mode: !!aiCfg.auto_mode,
        active_provider_key_id: null,
      })
      setAiCfg((prev) => ({
        ...prev,
        api_key: '',
        hasApiKey: true,
        model: res.data.model || prev.model,
        max_tokens: res.data.max_tokens ?? prev.max_tokens,
        temperature: res.data.temperature ?? prev.temperature,
        user_quota_tokens: res.data.user_quota_tokens ?? prev.user_quota_tokens,
        site_quota_tokens: res.data.site_quota_tokens ?? prev.site_quota_tokens,
        quota_window_hours: res.data.quota_window_hours ?? prev.quota_window_hours,
        auto_mode: res.data.auto_mode ?? prev.auto_mode,
        quota: res.data.quota || prev.quota,
        auto_tuning: res.data.auto_tuning || prev.auto_tuning,
        active_provider_key_id: res.data.active_provider_key_id || '',
        provider_key_source: res.data.provider_key_source || prev.provider_key_source,
        provider_key_owner: res.data.provider_key_owner || prev.provider_key_owner,
      }))
      toast.success(t('admin.saved'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setSaving(false)
  }

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
      toast.error(getErrorMessage(e))
    }
    setLoadingPrivateEmail(false)
  }

  const renderProviderKeyCard = (entry) => {
    const revealedSecret = revealedProviderKeys[entry.id]
    const providerLabel = providerLabelById[entry.provider] || entry.provider
    const visibleEmail = revealedSecret?.owner?.email || entry.owner_email || '-'
    const isBusy = (
      refreshingProviderKeyId === entry.id
      || loadingProviderKeySecretId === entry.id
      || deletingProviderKeyId === entry.id
    )

    return (
      <div key={entry.id} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-display font-600 text-white">{entry.owner_username}</p>
              <span className={`badge ${
                entry.status === 'valid'
                  ? 'badge-online'
                  : entry.status === 'quota_exhausted'
                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                  : entry.status === 'invalid'
                  ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                  : 'bg-white/[0.04] text-white/55 border border-white/10'
              }`}>
                {getProviderStatusLabel(locale, entry.status)}
              </span>
            </div>
            <p className="text-xs text-white/30 font-mono mt-1 break-all">{revealedSecret?.api_key || entry.key_masked}</p>
            {entry.status_reason ? <p className="text-xs text-white/30 mt-1">{entry.status_reason}</p> : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => toggleProviderKeySecret(entry)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] text-white/70 text-xs font-mono hover:bg-white/[0.08] transition-all disabled:opacity-40"
            >
              {revealedSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {revealedSecret ? t('admin.providerPoolHide', 'Masquer') : t('admin.providerPoolReveal', 'Afficher')}
            </button>
            <button
              type="button"
              onClick={() => copyProviderKeySecret(entry)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan text-xs font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40"
            >
              {copiedProviderKeyId === entry.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedProviderKeyId === entry.id ? t('admin.providerPoolCopiedShort', 'Copi\u00e9e') : t('admin.providerPoolCopy', 'Copier')}
            </button>
            <button
              type="button"
              onClick={() => refreshProviderKey(entry.id)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] text-white/70 text-xs font-mono hover:bg-white/[0.08] transition-all disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshingProviderKeyId === entry.id ? 'animate-spin' : ''}`} />
              {t('admin.providerPoolRefresh', 'V\u00e9rifier')}
            </button>
            <button
              type="button"
              onClick={() => deleteProviderKey(entry)}
              disabled={isBusy}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-mono hover:bg-red-500/20 transition-all disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t('admin.providerKeyDeleteAction', 'Supprimer')}
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-2 mt-3 text-xs text-white/35">
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="font-mono text-white/25 mb-1">{t('admin.providerPoolProvider', 'Fournisseur')}</p>
            <p>{providerLabel}</p>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="font-mono text-white/25 mb-1">{t('admin.providerPoolEmail', 'Email du fournisseur')}</p>
            <p className="font-mono break-all">{visibleEmail}</p>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="font-mono text-white/25 mb-1">{t('admin.providerPoolCreatedAt', 'Ajout\u00e9e le')}</p>
            <p>{entry.created_at ? new Date(entry.created_at).toLocaleString(locale) : '-'}</p>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="font-mono text-white/25 mb-1">{t('admin.providerPoolCheckedAt', 'Derni\u00e8re v\u00e9rification')}</p>
            <p>{entry.checked_at ? new Date(entry.checked_at).toLocaleString(locale) : '-'}</p>
          </div>
          <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="font-mono text-white/25 mb-1">{t('admin.providerPoolUsedAt', 'Derni\u00e8re utilisation')}</p>
            <p>{entry.last_used_at ? new Date(entry.last_used_at).toLocaleString(locale) : '-'}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Crown className="w-6 h-6 text-amber-400" />
        <h1 className="font-display font-800 text-2xl text-white">{t('admin.title')}</h1>
      </div>

      {sysInfo && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            [t('admin.stats.users'), sysInfo.users, 'text-neon-cyan', Users],
            [t('admin.stats.connectedUsers'), sysInfo.connectedUsers, 'text-green-400', Activity],
            [t('admin.stats.servers'), sysInfo.guilds, 'text-neon-violet', Bot],
            [t('admin.stats.activeBots'), sysInfo.runningBots, 'text-green-400', Activity],
            [t('admin.stats.memory'), `${sysInfo.memoryMB}MB`, 'text-amber-400', Activity],
          ].map(([label, value, color, Icon]) => (
            <div key={label} className="glass-card p-4">
              <p className={`text-xl font-display font-700 ${color}`}>{value}</p>
              <p className="text-xs text-white/40">{label}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-1 bg-white/[0.03] border border-white/[0.06] rounded-xl p-1 w-fit">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-4 py-1.5 rounded-lg text-sm font-mono transition-all ${tab === id ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'text-white/40 hover:text-white'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'users' && canManageUsers && (
        <div className="space-y-2">
          {users.map((user) => {
            const isCurrentFounder = user.id === currentUserId && user.role === 'founder'
            const isCurrentUser = user.id === currentUserId
            const isPrimaryFounder = !!user.is_primary_founder
            const isUpdatingThisUser = updatingUserId === user.id
            const isAdvancedOpen = openAdvancedUserId === user.id
            const canRevealThisEmail = isCurrentUser && isPrimaryFounder && canRevealPrimaryEmail
            const displayedUserEmail = canRevealThisEmail && showPrivateEmail && privateEmail
              ? privateEmail
              : user.email
            const botStatusLabel = user.hasBotToken
              ? t(`layout.status.${user.botStatus}`, user.botStatus)
              : t('admin.botDisconnected')
            const roleLabel = isPrimaryFounder ? t('admin.primaryFounder') : getRoleLabel(t, user.role)
            const roleBadgeClass = user.role === 'founder'
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
              : user.role === 'admin'
              ? 'bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20'
              : user.role === 'api_provider'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-white/5 text-white/40 border border-white/10'

            return (
              <div key={user.id} className="glass-card p-4 space-y-3">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center font-display font-700 shrink-0">
                    {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full rounded-full object-cover" alt="" /> : user.username[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-display font-600 text-white">{user.username}</p>
                      <span className={`badge capitalize ${roleBadgeClass}`}>{roleLabel}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <p className="text-xs text-white/30 font-mono">{displayedUserEmail}</p>
                      {canRevealThisEmail && (
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
                  </div>
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    <span className={`badge ${user.is_active ? 'badge-online' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>{user.is_active ? t('admin.accessAllowed') : t('admin.accessBlocked')}</span>
                    <span className={`badge ${user.hasBotToken && user.botStatus === 'running' ? 'badge-online' : 'badge-offline'}`}>{t('admin.bot')}: {botStatusLabel}</span>
                    {!isPrimaryFounder && (
                      <select
                        value={user.role}
                        onChange={(e) => setRole(user.id, e.target.value)}
                        disabled={isCurrentFounder || isUpdatingThisUser}
                        title={isCurrentFounder ? t('admin.selfFounderLock') : undefined}
                        className={`select-compact ${(isCurrentFounder || isUpdatingThisUser) ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        {roleOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    )}
                    {!isPrimaryFounder && (
                      <button
                        type="button"
                        onClick={() => setOpenAdvancedUserId((current) => current === user.id ? null : user.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] leading-none font-mono transition-all border border-white/10 bg-white/[0.04] text-white/70 hover:text-white hover:bg-white/[0.08]"
                      >
                        <Settings2 className="w-3 h-3" />
                        {t('admin.advancedSettings')}
                        {isAdvancedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {isAdvancedOpen && !isPrimaryFounder && (
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                      <p className="text-xs font-mono uppercase tracking-wider text-white/40">{t('admin.advancedSettings')}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setAccess(user.id, !user.is_active)}
                        disabled={isCurrentUser || isUpdatingThisUser}
                        title={isCurrentUser ? t('admin.selfAccessLock') : undefined}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] leading-none font-mono transition-all border ${
                          user.is_active
                            ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                            : 'bg-green-500/10 border-green-500/20 text-green-400 hover:bg-green-500/20'
                        } ${(isCurrentUser || isUpdatingThisUser) ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        {user.is_active ? <Ban className="w-3 h-3" /> : <ShieldCheck className="w-3 h-3" />}
                        {user.is_active ? t('admin.blockAccess') : t('admin.restoreAccess')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPassword(user.id)}
                        disabled={isUpdatingThisUser}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] leading-none font-mono transition-all border border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20 ${
                          isUpdatingThisUser ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        {t('admin.setPassword')}
                      </button>
                      {canDeleteUsers && (
                        <button
                          type="button"
                          onClick={() => deleteUser(user.id)}
                          disabled={isCurrentUser || isUpdatingThisUser}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] leading-none font-mono transition-all border border-red-500/20 bg-red-500/10 text-red-400 hover:bg-red-500/20 ${
                            (isCurrentUser || isUpdatingThisUser) ? 'opacity-50 cursor-not-allowed' : ''
                          }`}
                        >
                          <Trash2 className="w-3 h-3" />
                          {t('admin.deleteAccount')}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {tab === 'provider_keys' && canManageProviderPool && (
        <div className="space-y-5">
          <div className="glass-card p-5 space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              <p className="font-display font-600 text-white">{t('admin.providerKeysTitle', 'Cl\u00e9s fournisseurs')}</p>
            </div>
            <p className="text-sm text-white/45">
              {t('admin.providerKeysHint', 'Toutes les cl\u00e9s fournisseurs enregistr\u00e9es. Les cl\u00e9s valides sont s\u00e9par\u00e9es des cl\u00e9s invalides ou vides.')}
            </p>
          </div>

          <div className="grid xl:grid-cols-2 gap-5 items-start">
            <div className="glass-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-display font-600 text-white">{t('admin.providerKeysValid', 'Cl\u00e9s valides')}</p>
                <span className="badge badge-online">{validProviderKeys.length}</span>
              </div>
              {validProviderKeys.length > 0 ? (
                <div className="space-y-3">
                  {validProviderKeys.map(renderProviderKeyCard)}
                </div>
              ) : (
                <p className="text-sm text-white/35">{t('admin.providerKeysEmptyValid', 'Aucune cl\u00e9 valide pour le moment.')}</p>
              )}
            </div>

            <div className="glass-card p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-display font-600 text-white">{t('admin.providerKeysInvalid', 'Cl\u00e9s invalides')}</p>
                <span className="badge bg-red-500/10 text-red-400 border border-red-500/20">{invalidProviderKeys.length}</span>
              </div>
              {invalidProviderKeys.length > 0 ? (
                <div className="space-y-3">
                  {invalidProviderKeys.map(renderProviderKeyCard)}
                </div>
              ) : (
                <p className="text-sm text-white/35">{t('admin.providerKeysEmptyInvalid', 'Aucune cl\u00e9 invalide pour le moment.')}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'ai' && (
        <div className="glass-card p-5 space-y-4 max-w-lg">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="font-display font-600 text-white">{t('admin.aiTitle')}</p>
            <div className="min-w-[165px]">
              <label className="text-[11px] font-mono text-white/40 mb-1 block">{t('admin.autoMode')}</label>
              <select
                className={`select-compact w-full ${aiCfg.auto_mode ? 'border-green-500/30 text-green-400 bg-green-500/10' : 'border-red-500/30 text-red-400 bg-red-500/10'}`}
                value={aiCfg.auto_mode ? 'auto' : 'manual'}
                onChange={(e) => setAiCfg((prev) => ({ ...prev, auto_mode: e.target.value === 'auto' }))}
              >
                <option value="auto">{t('admin.autoModeEnabled')}</option>
                <option value="manual">{t('admin.autoModeDisabled')}</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-white/45">
            {aiCfg.auto_mode ? t('admin.autoModeHelpOn') : t('admin.autoModeHelpOff')}
          </p>

          <div>
            <label className="text-xs font-mono text-white/40 mb-1.5 block">{t('admin.provider')}</label>
            <input
              type="text"
              className="input-field mb-2"
              placeholder={t('admin.providerSearch')}
              value={providerSearch}
              onChange={(e) => setProviderSearch(e.target.value)}
            />
            <select className="select-field" value={aiCfg.provider} onChange={(e) => handleProviderChange(e.target.value)}>
              {visibleProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>{provider.label}</option>
              ))}
            </select>
            {selectedProvider?.description && <p className="text-xs text-white/35 mt-1">{selectedProvider.description}</p>}
          </div>

          <div>
            <label className="text-xs font-mono text-white/40 mb-1.5 block">{t('admin.apiKey')}</label>
            <input
              type="text"
              className="input-field secret-field"
              placeholder={selectedProvider?.keyPlaceholder || 'API key'}
              value={aiCfg.api_key}
              onChange={(e) => setAiCfg((prev) => ({ ...prev, api_key: e.target.value }))}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
            />
            <p className="text-xs text-white/35 mt-1">{aiCfg.hasApiKey ? t('admin.apiKeySaved') : t('admin.apiKeyHelp')}</p>
          </div>

          <div>
            <label className="text-xs font-mono text-white/40 mb-1.5 block">{t('admin.model')}</label>
            <input
              type="text"
              className="input-field mb-2"
              placeholder={t('admin.modelSearch')}
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
            />
            <select className="select-field" value={selectedModel?.id || aiCfg.model} onChange={(e) => setAiCfg((prev) => ({ ...prev, model: e.target.value }))}>
              {visibleModels.map((model) => (
                <option key={model.id} value={model.id}>{model.label}</option>
              ))}
            </select>
            <p className="text-xs text-white/35 mt-1">{selectedModel?.description || t('admin.modelHelp')}</p>
            {aiCfg.provider === 'gemini' && <p className="text-xs text-green-400/70 mt-1">{t('admin.freeTierOnly')}</p>}
            {selectedModel?.deprecated && <p className="text-xs text-amber-400/70 mt-1">{t('admin.deprecated')}</p>}
            {selectedModel?.preview && <p className="text-xs text-neon-cyan/70 mt-1">{t('admin.preview')}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono text-white/40 mb-1.5 block">
                {t('admin.maxTokens')} {aiCfg.auto_mode && <span className="text-neon-cyan/70">{t('admin.autoManaged')}</span>}
              </label>
              <input type="number" readOnly={aiCfg.auto_mode} className="input-field" value={aiCfg.max_tokens} onChange={(e) => setAiCfg((prev) => ({ ...prev, max_tokens: Number(e.target.value) }))} />
              <p className="text-xs text-white/35 mt-1">{aiCfg.auto_mode ? t('admin.maxTokensAutoHelp') : t('admin.maxTokensHelp')}</p>
            </div>
            <div>
              <label className="text-xs font-mono text-white/40 mb-1.5 block">
                {t('admin.creativity')} {aiCfg.auto_mode && <span className="text-neon-cyan/70">{t('admin.autoManaged')}</span>}
              </label>
              <input type="number" step="0.1" min="0" max="2" readOnly={aiCfg.auto_mode} className="input-field" value={aiCfg.temperature} onChange={(e) => setAiCfg((prev) => ({ ...prev, temperature: Number(e.target.value) }))} />
              <p className="text-xs text-white/35 mt-1">{aiCfg.auto_mode ? t('admin.creativityAutoHelp') : t('admin.creativityHelp')}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-mono text-white/40 mb-1.5 block">
                {t('admin.userQuotaTokens')} {aiCfg.auto_mode && <span className="text-neon-cyan/70">{t('admin.autoManaged')}</span>}
              </label>
              <input type="number" min="0" readOnly={aiCfg.auto_mode} className="input-field" value={aiCfg.user_quota_tokens} onChange={(e) => setAiCfg((prev) => ({ ...prev, user_quota_tokens: Number(e.target.value) }))} />
              <p className="text-xs text-white/35 mt-1">{aiCfg.auto_mode ? t('admin.userQuotaAutoHelp') : t('admin.userQuotaHelp')}</p>
            </div>
            <div>
              <label className="text-xs font-mono text-white/40 mb-1.5 block">
                {t('admin.siteQuotaTokens')} {aiCfg.auto_mode && <span className="text-neon-cyan/70">{t('admin.autoManaged')}</span>}
              </label>
              <input type="number" min="0" readOnly={aiCfg.auto_mode} className="input-field" value={aiCfg.site_quota_tokens} onChange={(e) => setAiCfg((prev) => ({ ...prev, site_quota_tokens: Number(e.target.value) }))} />
              <p className="text-xs text-white/35 mt-1">{aiCfg.auto_mode ? t('admin.siteQuotaAutoHelp') : t('admin.siteQuotaHelp')}</p>
            </div>
          </div>

          <div>
            <label className="text-xs font-mono text-white/40 mb-1.5 block">{t('admin.quotaWindowHours')}</label>
            <input type="number" min="1" max="168" className="input-field" value={aiCfg.quota_window_hours} onChange={(e) => setAiCfg((prev) => ({ ...prev, quota_window_hours: Number(e.target.value) }))} />
          </div>

          {aiCfg.quota && (
            <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-display font-600 text-white">
                  {aiCfg.provider === 'gemini' ? t('admin.siteQuotaCardTitle') : t('admin.quotaRemaining')}
                </p>
                <p className="text-lg font-display font-700 text-neon-cyan">
                  {aiCfg.quota.site?.remainingTokens === null ? 'illimite' : formatCount(aiCfg.quota.site?.remainingTokens ?? aiCfg.quota.remainingTokens)}
                </p>
              </div>
              <p className="text-xs text-white/45">
                {t('admin.quotaUsed')}: {formatCount(aiCfg.quota.site?.usedTokens || 0)}
                {Number(aiCfg.site_quota_tokens || 0) > 0 ? ` / ${formatCount(aiCfg.site_quota_tokens)}` : ''}
              </p>
              <p className="text-xs text-white/45">
                {t('admin.quotaResetAt')}: {new Date(aiCfg.quota.site?.windowEndsAt || aiCfg.quota.windowEndsAt).toLocaleString(locale)}
              </p>
              <p className="text-xs text-white/45">
                {t('admin.userQuotaTokens')}: {Number(aiCfg.user_quota_tokens || 0) > 0 ? formatCount(aiCfg.user_quota_tokens) : 'illimite'}
              </p>
              <p className="text-xs text-white/35">{t('admin.quotaLocalNote')}</p>
              {aiCfg.provider === 'gemini' && <p className="text-xs text-green-400/70">{t('admin.providerQuotaNote')}</p>}
            </div>
          )}

          <button onClick={saveAI} disabled={saving || !aiCfg.model || (!aiCfg.hasApiKey && !aiCfg.api_key.trim() && providerPool.length < 1)} className="w-full py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-sm hover:bg-amber-500/20 transition-all disabled:opacity-40">
            {saving ? t('admin.saving') : t('admin.save')}
          </button>
        </div>
      )}
    </div>
  )
}
