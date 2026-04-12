import { useEffect, useMemo, useState } from 'react'
import { Crown, Users, Bot, Activity, Ban, ShieldCheck, Settings2, ChevronDown, ChevronUp, Trash2, KeyRound, RefreshCw, Eye, EyeOff, Copy, Check, Save, Link2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminAPI, authAPI } from '../services/api'
import { useI18n } from '../i18n'
import { useAuthStore } from '../stores'
import KeyDeleteConfirmDialog from '../components/KeyDeleteConfirmDialog'
import ProviderQuickLinks from '../components/ProviderQuickLinks'
import SearchableSelect from '../components/ui/SearchableSelect'

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

function formatDateTime(locale, value) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
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
  const [updatingProviderKeyModelId, setUpdatingProviderKeyModelId] = useState(null)
  const [deletingProviderKeyId, setDeletingProviderKeyId] = useState(null)
  const [loadingProviderKeySecretId, setLoadingProviderKeySecretId] = useState(null)
  const [revealedProviderKeys, setRevealedProviderKeys] = useState({})
  const [providerKeyModelDrafts, setProviderKeyModelDrafts] = useState({})
  const [copiedProviderKeyId, setCopiedProviderKeyId] = useState(null)
  const [providerKeyDeleteDialog, setProviderKeyDeleteDialog] = useState(null)
  const [openAdvancedUserId, setOpenAdvancedUserId] = useState(null)
  const [openLinkedUserId, setOpenLinkedUserId] = useState(null)
  const [openSecurityUserId, setOpenSecurityUserId] = useState(null)
  const [privateEmail, setPrivateEmail] = useState('')
  const [showPrivateEmail, setShowPrivateEmail] = useState(false)
  const [loadingPrivateEmail, setLoadingPrivateEmail] = useState(false)

  const syncProviderKeys = async ({ silent = true } = {}) => {
    if (!canManageProviderPool) return

    try {
      const res = await adminAPI.getAI()
      setCatalog((prev) => prev.length ? prev : (res.data.catalog || []))
      setAiCfg((prev) => ({
        ...prev,
        provider_keys: res.data.provider_keys || [],
        active_provider_key_id: res.data.active_provider_key_id || '',
        provider_key_source: res.data.provider_key_source || prev.provider_key_source,
        provider_key_owner: res.data.provider_key_owner || prev.provider_key_owner,
      }))
    } catch (error) {
      if (!silent) {
        toast.error(getErrorMessage(error))
      }
    }
  }

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
      setOpenLinkedUserId(null)
      setOpenSecurityUserId(null)
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

  const currentPanelUser = useMemo(() => {
    const normalizedCurrentUserId = currentUserId == null ? '' : String(currentUserId)
    const fallbackPrimaryFounder = currentUser?.is_primary_founder
      ? users.find((user) => !!user.is_primary_founder)
      : null

    return users.find((user) => String(user.id) === normalizedCurrentUserId) || fallbackPrimaryFounder || null
  }, [users, currentUserId, currentUser?.is_primary_founder])
  const canDeleteUsers = !!currentPanelUser?.is_primary_founder
  const canManageProviderPool = !!(currentUser?.is_primary_founder || currentPanelUser?.is_primary_founder)
  const canViewSecurityIntel = !!(currentUser?.is_primary_founder || currentPanelUser?.is_primary_founder)
  const canRevealPrimaryEmail = !!(
    currentUser?.is_primary_founder
    || (currentUser?.role === 'founder' && currentUser?.email === '********@********.***')
  )

  useEffect(() => {
    if (!openSecurityUserId) return
    const selectedUser = users.find((entry) => String(entry.id) === String(openSecurityUserId))
    if (selectedUser?.is_primary_founder) {
      setOpenSecurityUserId(null)
    }
  }, [openSecurityUserId, users])

  useEffect(() => {
    if (!canManageUsers && tab === 'users') {
      setTab('ai')
    }
    if (!canManageProviderPool && tab === 'provider_keys') {
      setTab('ai')
    }
  }, [canManageUsers, canManageProviderPool, tab])

  useEffect(() => {
    if (!canManageProviderPool) return undefined

    syncProviderKeys({ silent: true })
    const intervalId = window.setInterval(() => {
      syncProviderKeys({ silent: true })
    }, 8000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [canManageProviderPool, tab])

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
  const usableProviderPool = useMemo(
    () => providerPool.filter((entry) => entry.status === 'valid' || entry.status === 'unknown'),
    [providerPool]
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
  const roleOptions = useMemo(() => ([
    { value: 'member', label: t('admin.roles.member') },
    { value: 'admin', label: t('admin.roles.admin') },
    { value: 'founder', label: t('admin.roles.founder') },
    { value: 'osint', label: t('admin.roles.osint', 'OSINT') },
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

  useEffect(() => {
    const nextDrafts = {}
    for (const entry of aiCfg.provider_keys || []) {
      const providerCatalog = catalog.find((item) => item.id === entry.provider)
      nextDrafts[entry.id] = entry.selected_model || providerCatalog?.defaultModel || providerCatalog?.models?.[0]?.id || ''
    }
    setProviderKeyModelDrafts(nextDrafts)
  }, [aiCfg.provider_keys, catalog])

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
      setOpenLinkedUserId((current) => current === userId ? null : current)
      setOpenSecurityUserId((current) => current === userId ? null : current)
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
      setProviderKeyModelDrafts((prev) => ({ ...prev, [keyId]: nextKey.selected_model }))
      toast.success(t('admin.providerKeyRefreshed', 'Statut fournisseur actualise'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setRefreshingProviderKeyId(null)
  }

  const updateProviderKeyModel = async (entry) => {
    if (!entry?.id || !canManageProviderPool) return

    const nextModel = providerKeyModelDrafts[entry.id]
    if (!nextModel) return

    setUpdatingProviderKeyModelId(entry.id)
    try {
      const res = await adminAPI.updateProviderKeyModel(entry.id, nextModel)
      const nextKey = res.data.key
      setAiCfg((prev) => ({
        ...prev,
        provider_keys: (prev.provider_keys || []).map((item) => (
          item.id === entry.id ? nextKey : item
        )),
      }))
      setProviderKeyModelDrafts((prev) => ({ ...prev, [entry.id]: nextKey.selected_model }))
      toast.success(t('admin.providerKeyModelSaved', 'Modele fournisseur mis a jour'))
    } catch (e) {
      toast.error(getErrorMessage(e))
    }
    setUpdatingProviderKeyModelId(null)
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
      setProviderKeyModelDrafts((prev) => {
        const next = { ...prev }
        delete next[entry.id]
        return next
      })
      setProviderKeyDeleteDialog(null)
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
    const providerCatalog = catalog.find((item) => item.id === entry.provider)
    const providerModels = providerCatalog?.models || []
    const selectedModelValue = providerKeyModelDrafts[entry.id] || entry.selected_model || providerCatalog?.defaultModel || providerModels[0]?.id || ''
    const selectedModel = providerModels.find((model) => model.id === selectedModelValue)
    const isBusy = (
      refreshingProviderKeyId === entry.id
      || loadingProviderKeySecretId === entry.id
      || updatingProviderKeyModelId === entry.id
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
              onClick={() => setProviderKeyDeleteDialog(entry)}
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

        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3 mt-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="font-mono text-white/25 mb-1">{t('admin.providerKeyModelLabel', 'Modele choisi')}</p>
              <p className="text-sm text-white">{selectedModel?.label || selectedModelValue || '-'}</p>
            </div>
            {entry.is_selected ? (
              <span className="badge bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                {t('admin.providerKeyInUse', 'Cl\u00e9 fournisseur active')}
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-col gap-2 lg:flex-row">
            <div className="flex-1">
              <SearchableSelect
                label={t('admin.providerKeyModelLabel', 'Modele choisi')}
                value={selectedModelValue}
                onChange={(option) => setProviderKeyModelDrafts((prev) => ({ ...prev, [entry.id]: option.id }))}
                options={providerModels}
                placeholder={t('admin.providerKeyModelLabel', 'Modele choisi')}
                emptyLabel={t('admin.providerKeyModelLabel', 'Modele choisi')}
                emptySearchLabel={t('admin.providerKeyModelLabel', 'Modele choisi')}
                getOptionKey={(option) => option.id}
                getOptionLabel={(option) => option.label}
                showCount={false}
              />
            </div>
            <button
              type="button"
              onClick={() => updateProviderKeyModel(entry)}
              disabled={isBusy || !selectedModelValue || selectedModelValue === entry.selected_model}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs font-mono text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-40"
            >
              {updatingProviderKeyModelId === entry.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {updatingProviderKeyModelId === entry.id ? t('admin.providerKeyModelSaving', 'Mise a jour...') : t('admin.providerKeyModelApply', 'Appliquer le modele')}
            </button>
          </div>
          <p className="mt-2 text-xs text-white/35">{selectedModel?.description || t('admin.modelHelp')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-5xl mx-auto space-y-5">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl border border-amber-500/25 bg-amber-500/10 flex items-center justify-center">
              <Crown className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h1 className="font-display font-800 text-2xl text-white">{t('admin.title')}</h1>
              <p className="text-sm text-white/45">Vue plus claire pour les utilisateurs, l IA et les cles fournisseurs.</p>
            </div>
          </div>

          {sysInfo && (
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {[
                [t('admin.stats.users'), sysInfo.users, 'text-neon-cyan'],
                [t('admin.stats.connectedUsers'), sysInfo.connectedUsers, 'text-green-400'],
                [t('admin.stats.servers'), sysInfo.guilds, 'text-neon-violet'],
                [t('admin.stats.activeBots'), sysInfo.runningBots, 'text-green-400'],
                [t('admin.stats.memory'), `${sysInfo.memoryMB}MB`, 'text-amber-400'],
              ].map(([label, value, color]) => (
                <div key={label} className="feature-metric depth-panel p-4">
                  <p className={`text-xl font-display font-700 ${color}`}>{value}</p>
                  <p className="text-xs text-white/40">{label}</p>
                </div>
              ))}
            </div>
          )}

          <div className="grid w-full grid-cols-1 gap-1 rounded-xl border border-white/[0.06] bg-white/[0.03] p-1 sm:w-fit sm:grid-cols-2 xl:flex">
            {tabs.map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`w-full rounded-lg px-4 py-2 text-center text-xs font-mono transition-all sm:text-sm xl:w-auto ${tab === id ? 'border border-amber-500/20 bg-amber-500/10 text-amber-400' : 'text-white/40 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'users' && canManageUsers && (
        <div className="space-y-2">
          {users.map((user) => {
            const isCurrentUser = String(user.id) === String(currentUserId)
            const isCurrentFounder = isCurrentUser && user.role === 'founder'
            const isPrimaryFounder = !!user.is_primary_founder
            const isUpdatingThisUser = updatingUserId === user.id
            const isAdvancedOpen = openAdvancedUserId === user.id
            const linkedDiscord = user.linked_discord || null
            const isLinkedOpen = openLinkedUserId === user.id
            const isSecurityOpen = openSecurityUserId === user.id
            const securityAccess = user.security_access || null
            const preciseLocation = user.precise_location || null
            const currentSecurity = securityAccess?.current || null
            const securityHistory = securityAccess?.recent || []
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
              <div key={user.id} className="depth-panel relative z-0 overflow-visible p-4 space-y-3">
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center font-display font-700 shrink-0">
                    {user.avatar_url ? <img src={user.avatar_url} className="w-full h-full rounded-full object-cover" alt="" /> : user.username[0]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-display font-600 text-white">{user.username}</p>
                      {!isPrimaryFounder && (
                          <div className="relative z-[90] min-w-[138px] max-w-[180px]">
                            <SearchableSelect
                              label={t('admin.rolesLabel', 'Role')}
                              value={user.role}
                              onChange={(option) => setRole(user.id, option.value)}
                              disabled={isCurrentFounder || isUpdatingThisUser}
                              options={roleOptions}
                              placeholder={t('admin.rolesLabel', 'Role')}
                              emptyLabel={t('admin.rolesLabel', 'Role')}
                              emptySearchLabel={t('admin.rolesLabel', 'Role')}
                              getOptionKey={(option) => option.value}
                              getOptionLabel={(option) => option.label}
                              showCount={false}
                              compact
                            />
                          </div>
                      )}
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
                    <button
                      type="button"
                      onClick={() => linkedDiscord && setOpenLinkedUserId((current) => current === user.id ? null : user.id)}
                      disabled={!linkedDiscord}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] leading-none font-mono transition-all border ${
                        linkedDiscord
                          ? 'border-neon-cyan/20 bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20'
                          : 'border-white/10 bg-white/[0.03] text-white/28 cursor-not-allowed'
                      }`}
                    >
                      <Link2 className="w-3 h-3" />
                      {linkedDiscord ? 'Compte lie' : 'Aucun compte lie'}
                      {linkedDiscord ? (isLinkedOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />) : null}
                    </button>
                    {canViewSecurityIntel && !isPrimaryFounder && (
                      <button
                        type="button"
                        onClick={() => setOpenSecurityUserId((current) => current === user.id ? null : user.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] leading-none font-mono transition-all border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                      >
                        <Activity className="w-3 h-3" />
                        Infos reseau
                        {isSecurityOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
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

                {isLinkedOpen && linkedDiscord && (
                  <div className="overflow-hidden rounded-2xl border border-neon-cyan/15 bg-[linear-gradient(180deg,rgba(6,182,212,0.08),rgba(255,255,255,0.02))]">
                    <div
                      className="h-24 w-full border-b border-white/8"
                      style={linkedDiscord.banner_url ? {
                        backgroundImage: `url(${linkedDiscord.banner_url})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      } : {
                        background: `linear-gradient(135deg, ${linkedDiscord.banner_color || '#0f172a'}, rgba(6,182,212,0.28), rgba(124,58,237,0.22))`,
                      }}
                    />

                    <div className="p-4">
                      <div className="flex items-start gap-4 flex-wrap">
                        <div className="w-16 h-16 -mt-12 rounded-[22px] border-4 border-[#0b1220] bg-white/[0.04] overflow-hidden shrink-0 flex items-center justify-center text-white font-display font-700 shadow-[0_12px_32px_rgba(0,0,0,0.28)]">
                          {linkedDiscord.avatar_url ? (
                            <img src={linkedDiscord.avatar_url} alt="" className="w-full h-full object-cover" />
                          ) : (
                            String(linkedDiscord.display_name || '?').slice(0, 1).toUpperCase()
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-base font-display font-700 text-white">{linkedDiscord.display_name}</p>
                            {linkedDiscord.avatar_animated && (
                              <span className="badge bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">Avatar anime</span>
                            )}
                            {linkedDiscord.banner_animated && (
                              <span className="badge bg-violet-500/10 text-violet-300 border border-violet-500/20">Banniere animee</span>
                            )}
                          </div>
                          <p className="mt-1 text-sm text-white/45">
                            {linkedDiscord.username ? `@${linkedDiscord.username}` : 'Pseudo Discord indisponible'}
                          </p>
                        </div>
                      </div>

                      <div className="mt-4 grid sm:grid-cols-2 gap-2 text-xs text-white/65">
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                          <p className="font-mono text-white/25 mb-1">ID Discord</p>
                          <p className="font-mono break-all">{linkedDiscord.id}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                          <p className="font-mono text-white/25 mb-1">Creation du compte</p>
                          <p>{formatDateTime(locale, linkedDiscord.created_at)}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                          <p className="font-mono text-white/25 mb-1">Nom global</p>
                          <p>{linkedDiscord.global_name || '-'}</p>
                        </div>
                        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                          <p className="font-mono text-white/25 mb-1">Couleur de profil</p>
                          <p>{linkedDiscord.banner_color || '-'}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {canViewSecurityIntel && !isPrimaryFounder && isSecurityOpen && (
                  <div className="rounded-2xl border border-amber-500/15 bg-[linear-gradient(180deg,rgba(245,158,11,0.08),rgba(255,255,255,0.02))] p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-display font-700 text-white">Infos reseau</p>
                        <p className="text-xs text-white/35">Visible uniquement par le fondateur principal</p>
                      </div>
                      {currentSecurity && (
                        <span className="badge bg-white/5 text-white/60 border border-white/10">
                          Derniere activite: {formatDateTime(locale, currentSecurity.last_seen_at)}
                        </span>
                      )}
                    </div>

                    {currentSecurity ? (
                      <>
                        {preciseLocation?.consent_status === 'granted' && preciseLocation.latitude != null && preciseLocation.longitude != null && (
                          <div className="rounded-xl border border-neon-cyan/15 bg-neon-cyan/[0.06] p-3.5 space-y-2">
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <p className="text-sm font-display font-700 text-white">GPS precise autorise</p>
                              <span className="badge bg-neon-cyan/10 text-neon-cyan border border-neon-cyan/20">
                                {preciseLocation.accuracy_m != null ? `± ${Math.round(preciseLocation.accuracy_m)} m` : 'precision indisponible'}
                              </span>
                            </div>
                            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 text-xs text-white/70">
                              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                <p className="font-mono text-white/25 mb-1">Coordonnees</p>
                                <p className="font-mono break-all">
                                  {Number(preciseLocation.latitude).toFixed(6)}, {Number(preciseLocation.longitude).toFixed(6)}
                                </p>
                              </div>
                              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                <p className="font-mono text-white/25 mb-1">Adresse precise</p>
                                <p>{preciseLocation.reverse_label || preciseLocation.reverse_display_name || '-'}</p>
                              </div>
                              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                <p className="font-mono text-white/25 mb-1">Fuseau</p>
                                <p>{preciseLocation.timezone || '-'}</p>
                              </div>
                              <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                                <p className="font-mono text-white/25 mb-1">Capture</p>
                                <p>{formatDateTime(locale, preciseLocation.captured_at || preciseLocation.updated_at)}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 text-xs text-white/70">
                          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                            <p className="font-mono text-white/25 mb-1">IP</p>
                            <p className="font-mono break-all">{currentSecurity.ip_address || '-'}</p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                            <p className="font-mono text-white/25 mb-1">Localisation approx.</p>
                            <p>{currentSecurity.location_label || '-'}</p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                            <p className="font-mono text-white/25 mb-1">Reseau</p>
                            <p>{currentSecurity.network_provider || currentSecurity.network_type || '-'}</p>
                          </div>
                          <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
                            <p className="font-mono text-white/25 mb-1">Appareil</p>
                            <p>{currentSecurity.device_label || '-'}</p>
                            {currentSecurity.device_model && (
                              <p className="mt-1 text-[11px] text-white/35">{currentSecurity.device_model}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {currentSecurity.is_vpn && <span className="badge bg-amber-500/10 text-amber-300 border border-amber-500/20">VPN detecte</span>}
                          {currentSecurity.is_proxy && <span className="badge bg-orange-500/10 text-orange-300 border border-orange-500/20">Proxy detecte</span>}
                          {currentSecurity.is_tor && <span className="badge bg-red-500/10 text-red-300 border border-red-500/20">Tor detecte</span>}
                          {currentSecurity.is_datacenter && <span className="badge bg-violet-500/10 text-violet-300 border border-violet-500/20">Datacenter / hebergeur</span>}
                        </div>

                        <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3 space-y-2">
                          <p className="text-xs font-mono uppercase tracking-wider text-white/35">Historique recent</p>
                          {securityHistory.map((entry) => (
                            <div key={entry.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/6 bg-black/20 px-3 py-2.5">
                              <div className="min-w-0">
                                <p className="text-xs text-white font-mono break-all">{entry.ip_address || 'IP indisponible'}</p>
                                <p className="mt-1 text-[11px] text-white/45">
                                  {entry.location_label || 'Localisation indisponible'}
                                  {entry.network_provider ? ` · ${entry.network_provider}` : ''}
                                </p>
                                <p className="mt-1 text-[11px] text-white/30">
                                  {entry.device_label}
                                  {entry.device_model ? ` · ${entry.device_model}` : ''}
                                </p>
                              </div>
                              <div className="text-right text-[11px] text-white/35 shrink-0">
                                <p>{formatDateTime(locale, entry.last_seen_at)}</p>
                                <p className="mt-1">{entry.seen_count} vue{entry.seen_count > 1 ? 's' : ''}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-3 text-xs text-white/45">
                        Aucune telemetrie disponible pour ce compte pour le moment.
                      </div>
                    )}
                  </div>
                )}

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
          <div className="depth-panel p-5 space-y-2">
            <div className="flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-emerald-400" />
              <p className="font-display font-600 text-white">{t('admin.providerKeysTitle', 'Cl\u00e9s fournisseurs')}</p>
            </div>
            <p className="text-sm text-white/45">
              {t('admin.providerKeysHint', 'Toutes les cl\u00e9s fournisseurs enregistr\u00e9es. Les cl\u00e9s valides sont s\u00e9par\u00e9es des cl\u00e9s invalides ou vides.')}
            </p>
          </div>

          <div className="grid xl:grid-cols-2 gap-5 items-start">
            <div className="depth-panel p-5 space-y-3">
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

            <div className="depth-panel p-5 space-y-3">
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
        <div className="depth-panel p-5 space-y-4 max-w-lg">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="font-display font-600 text-white">{t('admin.aiTitle')}</p>
            <div className="min-w-[165px]">
              <label className="text-[11px] font-mono text-white/40 mb-1 block">{t('admin.autoMode')}</label>
              <SearchableSelect
                label={t('admin.autoMode')}
                value={aiCfg.auto_mode ? 'auto' : 'manual'}
                onChange={(option) => setAiCfg((prev) => ({ ...prev, auto_mode: option.value === 'auto' }))}
                options={[
                  { value: 'auto', label: t('admin.autoModeEnabled') },
                  { value: 'manual', label: t('admin.autoModeDisabled') },
                ]}
                placeholder={t('admin.autoMode')}
                emptyLabel={t('admin.autoMode')}
                emptySearchLabel={t('admin.autoMode')}
                getOptionKey={(option) => option.value}
                getOptionLabel={(option) => option.label}
                showCount={false}
                compact
              />
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
            <SearchableSelect
              label={t('admin.provider')}
              value={aiCfg.provider}
              onChange={(option) => handleProviderChange(option.id)}
              options={visibleProviders}
              placeholder={t('admin.provider')}
              emptyLabel={t('admin.provider')}
              emptySearchLabel={t('admin.provider')}
              getOptionKey={(option) => option.id}
              getOptionLabel={(option) => option.label}
              showCount={false}
            />
            {selectedProvider?.description && <p className="text-xs text-white/35 mt-1">{selectedProvider.description}</p>}
          </div>

          <ProviderQuickLinks
            provider={selectedProvider}
            title={t('admin.providerQuickAccessTitle', 'Acces rapide API')}
            description={t('admin.providerQuickAccessHelp', 'Ouvre directement la page officielle pour creer ou copier la cle API du fournisseur selectionne.')}
            keyLabel={t('admin.providerQuickAccessKey', 'Ouvrir la page API')}
            docsLabel={t('admin.providerQuickAccessDocs', 'Voir les modeles')}
          />

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
            <SearchableSelect
              label={t('admin.model')}
              value={selectedModel?.id || aiCfg.model}
              onChange={(option) => setAiCfg((prev) => ({ ...prev, model: option.id }))}
              options={visibleModels}
              placeholder={t('admin.model')}
              emptyLabel={t('admin.model')}
              emptySearchLabel={t('admin.model')}
              getOptionKey={(option) => option.id}
              getOptionLabel={(option) => option.label}
              showCount={false}
            />
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

          <button onClick={saveAI} disabled={saving || !aiCfg.model || (!aiCfg.hasApiKey && !aiCfg.api_key.trim() && usableProviderPool.length < 1)} className="w-full py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono text-sm hover:bg-amber-500/20 transition-all disabled:opacity-40">
            {saving ? t('admin.saving') : t('admin.save')}
          </button>
        </div>
      )}

      <KeyDeleteConfirmDialog
        open={!!providerKeyDeleteDialog}
        busy={deletingProviderKeyId === providerKeyDeleteDialog?.id}
        title={t('admin.providerKeyDeleteTitle', 'Supprimer cette clé fournisseur ?')}
        description={t('admin.providerKeyDeleteDescription', 'Cette action retire immédiatement la clé du pool fournisseur. Si elle alimente encore l IA du site, il faudra en choisir une autre ou en remettre une nouvelle.')}
        highlight={
          providerKeyDeleteDialog?.status === 'valid'
            ? t('admin.providerKeyDeleteHighlightValid', 'Cette clé est actuellement valide. Supprime-la seulement si tu es certain de vouloir la retirer du site.')
            : t('admin.providerKeyDeleteHighlightInvalid', 'Cette clé sera supprimée pour tout le monde et ne pourra plus être réutilisée tant qu elle n est pas remise.')
        }
        details={providerKeyDeleteDialog ? [
          { label: t('admin.providerPoolProvider', 'Fournisseur'), value: providerLabelById[providerKeyDeleteDialog.provider] || providerKeyDeleteDialog.provider },
          { label: t('admin.providerKeyModelLabel', 'Modele choisi'), value: (() => {
            const providerCatalog = catalog.find((item) => item.id === providerKeyDeleteDialog.provider)
            const providerModel = providerCatalog?.models?.find((model) => model.id === providerKeyDeleteDialog.selected_model)
            return providerModel?.label || providerKeyDeleteDialog.selected_model || '-'
          })() },
          { label: t('admin.providerPoolEmail', 'Email du fournisseur'), value: providerKeyDeleteDialog.owner_email || '-' },
          { label: t('admin.statusLabel', 'Statut'), value: getProviderStatusLabel(locale, providerKeyDeleteDialog.status) },
        ] : []}
        confirmWord={t('admin.providerKeyDeleteWord', 'SUPPRIMER')}
        inputLabel={t('admin.providerKeyDeleteInput', 'Tape SUPPRIMER pour confirmer')}
        inputPlaceholder={t('admin.providerKeyDeleteWord', 'SUPPRIMER')}
        cancelLabel={t('admin.providerKeyDeleteCancel', 'Annuler')}
        confirmLabel={t('admin.providerKeyDeleteAction', 'Supprimer')}
        onClose={() => setProviderKeyDeleteDialog(null)}
        onConfirm={() => providerKeyDeleteDialog && deleteProviderKey(providerKeyDeleteDialog)}
      />
    </div>
  )
}
