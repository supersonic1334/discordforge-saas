import { useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, Save, ShieldCheck, Trash2, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { providerAPI } from '../services/api'
import { useI18n } from '../i18n'

const UI = {
  fr: {
    title: 'Panel fournisseur API',
    subtitle: 'Ajoute ta propre clé IA. Le fondateur principal peut voir son état, mais pas ton accès complet.',
    provider: 'Fournisseur',
    apiKey: 'Clé API',
    apiKeyHelp: 'Ta clé est stockée et vérifiée automatiquement.',
    save: 'Enregistrer la clé',
    saving: 'Enregistrement...',
    refresh: 'Vérifier',
    delete: 'Supprimer',
    empty: 'Aucune clé fournisseur enregistrée',
    emptyHint: 'Ajoute une clé pour alimenter l’IA du site.',
    saved: 'Clé fournisseur enregistrée',
    refreshed: 'Statut actualisé',
    deleted: 'Clé supprimée',
    currentKeys: 'Tes clés enregistrées',
    status: {
      valid: 'valide',
      quota_exhausted: 'quota vide',
      invalid: 'invalide',
      unknown: 'à vérifier',
    },
    owner: 'Compte',
    checkedAt: 'Dernière vérification',
    usedAt: 'Dernière utilisation',
    selectPlaceholder: 'Choisir un fournisseur',
  },
  en: {
    title: 'API provider panel',
    subtitle: 'Add your own AI key. The primary founder can see its status, but not your full access.',
    provider: 'Provider',
    apiKey: 'API key',
    apiKeyHelp: 'Your key is stored and checked automatically.',
    save: 'Save key',
    saving: 'Saving...',
    refresh: 'Refresh',
    delete: 'Delete',
    empty: 'No provider key saved yet',
    emptyHint: 'Add a key to power the site AI.',
    saved: 'Provider key saved',
    refreshed: 'Status refreshed',
    deleted: 'Key deleted',
    currentKeys: 'Your saved keys',
    status: {
      valid: 'valid',
      quota_exhausted: 'quota empty',
      invalid: 'invalid',
      unknown: 'to check',
    },
    owner: 'Account',
    checkedAt: 'Last check',
    usedAt: 'Last use',
    selectPlaceholder: 'Choose a provider',
  },
  es: {
    title: 'Panel proveedor API',
    subtitle: 'Agrega tu propia clave IA. El fundador principal puede ver su estado, pero no tu acceso completo.',
    provider: 'Proveedor',
    apiKey: 'Clave API',
    apiKeyHelp: 'Tu clave se guarda y se verifica automaticamente.',
    save: 'Guardar clave',
    saving: 'Guardando...',
    refresh: 'Verificar',
    delete: 'Eliminar',
    empty: 'Todavia no hay clave registrada',
    emptyHint: 'Agrega una clave para alimentar la IA del sitio.',
    saved: 'Clave guardada',
    refreshed: 'Estado actualizado',
    deleted: 'Clave eliminada',
    currentKeys: 'Tus claves guardadas',
    status: {
      valid: 'valida',
      quota_exhausted: 'cuota vacia',
      invalid: 'invalida',
      unknown: 'por verificar',
    },
    owner: 'Cuenta',
    checkedAt: 'Ultima verificacion',
    usedAt: 'Ultimo uso',
    selectPlaceholder: 'Elegir un proveedor',
  },
}

function getUi(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return UI[key] || UI.fr
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

export default function ProviderPanel() {
  const { locale } = useI18n()
  const ui = getUi(locale)
  const [catalog, setCatalog] = useState([])
  const [keys, setKeys] = useState([])
  const [provider, setProvider] = useState('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyKeyId, setBusyKeyId] = useState(null)

  useEffect(() => {
    let cancelled = false

    providerAPI.getAI().then((res) => {
      if (cancelled) return
      setCatalog(res.data.catalog || [])
      setKeys(res.data.keys || [])
      const firstProvider = res.data.keys?.[0]?.provider || res.data.catalog?.[0]?.id || 'anthropic'
      setProvider(firstProvider)
    }).catch((error) => {
      if (!cancelled) toast.error(getErrorMessage(error))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const selectedProvider = useMemo(
    () => catalog.find((entry) => entry.id === provider) || null,
    [catalog, provider]
  )

  const saveKey = async () => {
    if (!apiKey.trim()) return

    setSaving(true)
    try {
      const res = await providerAPI.saveKey({
        provider,
        api_key: apiKey.trim(),
      })
      const nextKey = res.data.key
      setKeys((current) => {
        const exists = current.some((entry) => entry.id === nextKey.id)
        if (!exists) return [nextKey, ...current]
        return current.map((entry) => (entry.id === nextKey.id ? nextKey : entry))
      })
      setApiKey('')
      toast.success(ui.saved)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const refreshKey = async (keyId) => {
    setBusyKeyId(keyId)
    try {
      const res = await providerAPI.refreshKey(keyId)
      const nextKey = res.data.key
      setKeys((current) => current.map((entry) => (entry.id === keyId ? nextKey : entry)))
      toast.success(ui.refreshed)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusyKeyId(null)
    }
  }

  const deleteKey = async (keyId) => {
    setBusyKeyId(keyId)
    try {
      await providerAPI.deleteKey(keyId)
      setKeys((current) => current.filter((entry) => entry.id !== keyId))
      toast.success(ui.deleted)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusyKeyId(null)
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <KeyRound className="w-6 h-6 text-neon-cyan" />
        <div>
          <h1 className="font-display font-800 text-2xl text-white">{ui.title}</h1>
          <p className="text-white/40 text-sm mt-1">{ui.subtitle}</p>
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div>
          <label className="text-xs font-mono text-white/40 mb-1.5 block">{ui.provider}</label>
          <select className="select-field" value={provider} onChange={(event) => setProvider(event.target.value)}>
            {!catalog.length && <option value="anthropic">{ui.selectPlaceholder}</option>}
            {catalog.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
          {selectedProvider?.description && <p className="text-xs text-white/35 mt-1">{selectedProvider.description}</p>}
        </div>

        <div>
          <label className="text-xs font-mono text-white/40 mb-1.5 block">{ui.apiKey}</label>
          <input
            type="text"
            className="input-field secret-field"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={selectedProvider?.keyPlaceholder || 'API key'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
          />
          <p className="text-xs text-white/35 mt-1">{ui.apiKeyHelp}</p>
        </div>

        <button
          type="button"
          onClick={saveKey}
          disabled={saving || !apiKey.trim()}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan text-sm font-mono hover:bg-neon-cyan/20 transition-all disabled:opacity-40"
        >
          {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? ui.saving : ui.save}
        </button>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-amber-400" />
          <p className="font-display font-600 text-white">{ui.currentKeys}</p>
        </div>

        {!loading && keys.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-white/45">{ui.empty}</p>
            <p className="text-xs text-white/30 mt-1">{ui.emptyHint}</p>
          </div>
        )}

        <div className="space-y-3">
          {keys.map((key) => (
            <div key={key.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 space-y-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-display font-600 text-white">{catalog.find((entry) => entry.id === key.provider)?.label || key.provider}</p>
                    <span className={`badge ${
                      key.status === 'valid'
                        ? 'badge-online'
                        : key.status === 'quota_exhausted'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : key.status === 'invalid'
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : 'bg-white/[0.04] text-white/55 border border-white/10'
                    }`}>
                      {ui.status[key.status] || key.status}
                    </span>
                  </div>
                  <p className="text-xs text-white/35 font-mono mt-1">{key.key_masked}</p>
                  {key.status_reason ? <p className="text-xs text-white/30 mt-1">{key.status_reason}</p> : null}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => refreshKey(key.id)}
                    disabled={busyKeyId === key.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] text-white/70 text-xs font-mono hover:bg-white/[0.08] transition-all disabled:opacity-40"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyKeyId === key.id ? 'animate-spin' : ''}`} />
                    {ui.refresh}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteKey(key.id)}
                    disabled={busyKeyId === key.id}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-mono hover:bg-red-500/20 transition-all disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {ui.delete}
                  </button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3 text-xs text-white/35">
                <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                  <p className="font-mono text-white/30 mb-1">{ui.checkedAt}</p>
                  <p>{key.checked_at ? new Date(key.checked_at).toLocaleString(locale) : '—'}</p>
                </div>
                <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                  <p className="font-mono text-white/30 mb-1">{ui.usedAt}</p>
                  <p>{key.last_used_at ? new Date(key.last_used_at).toLocaleString(locale) : '—'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
