import { useEffect, useMemo, useState } from 'react'
import { KeyRound, RefreshCw, Save, ShieldCheck, Trash2, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { providerAPI } from '../services/api'
import { useI18n } from '../i18n'
import KeyDeleteConfirmDialog from '../components/KeyDeleteConfirmDialog'
import ProviderQuickLinks from '../components/ProviderQuickLinks'

const UI = {
  fr: {
    title: 'Panel fournisseur API',
    subtitle: 'Ajoute ta propre clé IA, choisis son modèle, puis laisse le fondateur principal la gérer si besoin.',
    provider: 'Fournisseur',
    model: 'Modèle choisi',
    modelHelp: 'Choisis le modèle exact qui devra être utilisé avec cette clé.',
    modelSaved: 'Modèle fournisseur mis à jour',
    applyModel: 'Appliquer le modèle',
    applyingModel: 'Mise à jour...',
    apiKey: 'Clé API',
    apiKeyHelp: 'Ta clé est stockée, vérifiée, puis reliée au modèle que tu choisis.',
    quickAccessTitle: 'Acces rapide',
    quickAccessHelp: 'Ouvre directement la page officielle pour creer ou copier la cle API de ce fournisseur.',
    quickAccessKey: 'Ouvrir la page API',
    quickAccessDocs: 'Voir les modeles',
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
    chosenModel: 'Version choisie',
    statusLabel: 'Statut',
    checkedAt: 'Dernière vérification',
    usedAt: 'Dernière utilisation',
    createdAt: 'Ajoutée le',
    selectPlaceholder: 'Choisir un fournisseur',
    status: {
      valid: 'valide',
      quota_exhausted: 'quota vide',
      invalid: 'invalide',
      unknown: 'à vérifier',
    },
    deleteDialogTitle: 'Supprimer cette clé fournisseur ?',
    deleteDialogText: 'Cette suppression retire la clé de ton accès fournisseur. Si cette clé est utilisée par le site, elle pourra aussi disparaître du pool général.',
    deleteDialogHighlight: 'Pour éviter toute suppression accidentelle, la confirmation manuelle est obligatoire.',
    deleteDialogInput: 'Tape SUPPRIMER pour confirmer',
    deleteDialogPlaceholder: 'SUPPRIMER',
    deleteDialogCancel: 'Annuler',
    deleteDialogConfirm: 'Supprimer la clé',
    deleteDialogWord: 'SUPPRIMER',
  },
  en: {
    title: 'API provider panel',
    subtitle: 'Add your own AI key, choose its model, then let the primary founder manage it when needed.',
    provider: 'Provider',
    model: 'Selected model',
    modelHelp: 'Choose the exact model that must be used with this key.',
    modelSaved: 'Provider model updated',
    applyModel: 'Apply model',
    applyingModel: 'Updating...',
    apiKey: 'API key',
    apiKeyHelp: 'Your key is stored, checked, then linked to the model you choose.',
    quickAccessTitle: 'Quick access',
    quickAccessHelp: 'Open the official page directly to create or copy this provider API key.',
    quickAccessKey: 'Open API page',
    quickAccessDocs: 'View models',
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
    chosenModel: 'Chosen version',
    statusLabel: 'Status',
    checkedAt: 'Last check',
    usedAt: 'Last use',
    createdAt: 'Added on',
    selectPlaceholder: 'Choose a provider',
    status: {
      valid: 'valid',
      quota_exhausted: 'quota empty',
      invalid: 'invalid',
      unknown: 'to check',
    },
    deleteDialogTitle: 'Delete this provider key?',
    deleteDialogText: 'This removes the key from your provider access. If the site is using it, it can also disappear from the shared pool.',
    deleteDialogHighlight: 'Manual confirmation is required so this cannot be deleted by mistake.',
    deleteDialogInput: 'Type DELETE to confirm',
    deleteDialogPlaceholder: 'DELETE',
    deleteDialogCancel: 'Cancel',
    deleteDialogConfirm: 'Delete key',
    deleteDialogWord: 'DELETE',
  },
  es: {
    title: 'Panel proveedor API',
    subtitle: 'Agrega tu propia clave IA, elige su modelo y deja que el fundador principal la gestione si hace falta.',
    provider: 'Proveedor',
    model: 'Modelo elegido',
    modelHelp: 'Elige el modelo exacto que debe usarse con esta clave.',
    modelSaved: 'Modelo del proveedor actualizado',
    applyModel: 'Aplicar modelo',
    applyingModel: 'Actualizando...',
    apiKey: 'Clave API',
    apiKeyHelp: 'Tu clave se guarda, se verifica y queda vinculada al modelo que eliges.',
    quickAccessTitle: 'Acceso rapido',
    quickAccessHelp: 'Abre directamente la pagina oficial para crear o copiar la clave API de este proveedor.',
    quickAccessKey: 'Abrir pagina API',
    quickAccessDocs: 'Ver modelos',
    save: 'Guardar clave',
    saving: 'Guardando...',
    refresh: 'Verificar',
    delete: 'Eliminar',
    empty: 'Todavía no hay clave registrada',
    emptyHint: 'Agrega una clave para alimentar la IA del sitio.',
    saved: 'Clave guardada',
    refreshed: 'Estado actualizado',
    deleted: 'Clave eliminada',
    currentKeys: 'Tus claves guardadas',
    chosenModel: 'Versión elegida',
    statusLabel: 'Estado',
    checkedAt: 'Última verificación',
    usedAt: 'Último uso',
    createdAt: 'Agregada el',
    selectPlaceholder: 'Elegir un proveedor',
    status: {
      valid: 'válida',
      quota_exhausted: 'cuota vacía',
      invalid: 'inválida',
      unknown: 'por verificar',
    },
    deleteDialogTitle: '¿Eliminar esta clave del proveedor?',
    deleteDialogText: 'Esta acción quita la clave de tu acceso proveedor. Si el sitio la usa, también puede salir del pool compartido.',
    deleteDialogHighlight: 'La confirmación manual es obligatoria para evitar borrarla por error.',
    deleteDialogInput: 'Escribe ELIMINAR para confirmar',
    deleteDialogPlaceholder: 'ELIMINAR',
    deleteDialogCancel: 'Cancelar',
    deleteDialogConfirm: 'Eliminar clave',
    deleteDialogWord: 'ELIMINAR',
  },
}

function getUi(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return UI[key] || UI.fr
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function getModelLabel(catalog, providerId, modelId) {
  const provider = catalog.find((entry) => entry.id === providerId)
  const model = provider?.models?.find((entry) => entry.id === modelId)
  return model?.label || modelId || '-'
}

export default function ProviderPanel() {
  const { locale } = useI18n()
  const ui = getUi(locale)
  const [catalog, setCatalog] = useState([])
  const [keys, setKeys] = useState([])
  const [provider, setProvider] = useState('anthropic')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busyKeyId, setBusyKeyId] = useState(null)
  const [updatingModelKeyId, setUpdatingModelKeyId] = useState(null)
  const [keyModelDrafts, setKeyModelDrafts] = useState({})
  const [deleteDialogKey, setDeleteDialogKey] = useState(null)

  useEffect(() => {
    let cancelled = false

    providerAPI.getAI().then((res) => {
      if (cancelled) return
      const nextCatalog = res.data.catalog || []
      const nextKeys = res.data.keys || []
      const firstProvider = nextKeys[0]?.provider || nextCatalog[0]?.id || 'anthropic'
      const firstProviderEntry = nextCatalog.find((entry) => entry.id === firstProvider)

      setCatalog(nextCatalog)
      setKeys(nextKeys)
      setProvider(firstProvider)
      setModel(nextKeys[0]?.selected_model || firstProviderEntry?.defaultModel || firstProviderEntry?.models?.[0]?.id || '')
    }).catch((error) => {
      if (!cancelled) toast.error(getErrorMessage(error))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const nextDrafts = {}
    for (const entry of keys) {
      const providerCatalog = catalog.find((item) => item.id === entry.provider)
      nextDrafts[entry.id] = entry.selected_model || providerCatalog?.defaultModel || providerCatalog?.models?.[0]?.id || ''
    }
    setKeyModelDrafts(nextDrafts)
  }, [keys, catalog])

  const selectedProvider = useMemo(
    () => catalog.find((entry) => entry.id === provider) || null,
    [catalog, provider]
  )

  const providerModels = selectedProvider?.models || []

  useEffect(() => {
    if (!selectedProvider) return
    if (providerModels.some((entry) => entry.id === model)) return

    const existingKey = keys.find((entry) => entry.provider === provider)
    setModel(existingKey?.selected_model || selectedProvider.defaultModel || providerModels[0]?.id || '')
  }, [selectedProvider, providerModels, model, keys, provider])

  const saveKey = async () => {
    if (!apiKey.trim() || !model) return

    setSaving(true)
    try {
      const res = await providerAPI.saveKey({
        provider,
        model,
        api_key: apiKey.trim(),
      })
      const nextKey = res.data.key
      setKeys((current) => {
        const exists = current.some((entry) => entry.id === nextKey.id)
        if (!exists) return [nextKey, ...current]
        return current.map((entry) => (entry.id === nextKey.id ? nextKey : entry))
      })
      setKeyModelDrafts((current) => ({ ...current, [nextKey.id]: nextKey.selected_model }))
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
      setKeyModelDrafts((current) => ({ ...current, [keyId]: nextKey.selected_model }))
      toast.success(ui.refreshed)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusyKeyId(null)
    }
  }

  const updateKeyModel = async (keyId) => {
    const nextModel = keyModelDrafts[keyId]
    if (!nextModel) return

    setUpdatingModelKeyId(keyId)
    try {
      const res = await providerAPI.updateModel(keyId, nextModel)
      const nextKey = res.data.key
      setKeys((current) => current.map((entry) => (entry.id === keyId ? nextKey : entry)))
      setKeyModelDrafts((current) => ({ ...current, [keyId]: nextKey.selected_model }))
      toast.success(ui.modelSaved)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setUpdatingModelKeyId(null)
    }
  }

  const confirmDeleteKey = async () => {
    if (!deleteDialogKey?.id) return

    setBusyKeyId(deleteDialogKey.id)
    try {
      await providerAPI.deleteKey(deleteDialogKey.id)
      setKeys((current) => current.filter((entry) => entry.id !== deleteDialogKey.id))
      setDeleteDialogKey(null)
      toast.success(ui.deleted)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setBusyKeyId(null)
    }
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-5xl mx-auto space-y-5">
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
          {selectedProvider?.description ? <p className="text-xs text-white/35 mt-1">{selectedProvider.description}</p> : null}
        </div>

        <ProviderQuickLinks
          provider={selectedProvider}
          title={ui.quickAccessTitle}
          description={ui.quickAccessHelp}
          keyLabel={ui.quickAccessKey}
          docsLabel={ui.quickAccessDocs}
        />

        <div>
          <label className="text-xs font-mono text-white/40 mb-1.5 block">{ui.model}</label>
          <select className="select-field" value={model} onChange={(event) => setModel(event.target.value)}>
            {providerModels.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.label}</option>
            ))}
          </select>
          <p className="text-xs text-white/35 mt-1">
            {providerModels.find((entry) => entry.id === model)?.description || ui.modelHelp}
          </p>
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
          disabled={saving || !apiKey.trim() || !model}
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

        {!loading && keys.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center">
            <p className="text-white/45">{ui.empty}</p>
            <p className="text-xs text-white/30 mt-1">{ui.emptyHint}</p>
          </div>
        ) : null}

        <div className="space-y-3">
          {keys.map((key) => {
            const isBusy = busyKeyId === key.id || updatingModelKeyId === key.id
            const cardModels = catalog.find((entry) => entry.id === key.provider)?.models || []
            const draftModel = keyModelDrafts[key.id] || key.selected_model || cardModels[0]?.id || ''
            const selectedCardModel = cardModels.find((entry) => entry.id === draftModel)

            return (
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
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/10 bg-white/[0.04] text-white/70 text-xs font-mono hover:bg-white/[0.08] transition-all disabled:opacity-40"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busyKeyId === key.id ? 'animate-spin' : ''}`} />
                      {ui.refresh}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteDialogKey(key)}
                      disabled={isBusy}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-mono hover:bg-red-500/20 transition-all disabled:opacity-40"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {ui.delete}
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/28">{ui.chosenModel}</p>
                      <p className="text-sm text-white mt-1">{getModelLabel(catalog, key.provider, key.selected_model)}</p>
                    </div>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <select
                      className="select-field flex-1"
                      value={draftModel}
                      onChange={(event) => setKeyModelDrafts((current) => ({ ...current, [key.id]: event.target.value }))}
                    >
                      {cardModels.map((entry) => (
                        <option key={entry.id} value={entry.id}>{entry.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => updateKeyModel(key.id)}
                      disabled={isBusy || !draftModel || draftModel === key.selected_model}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-neon-cyan/20 bg-neon-cyan/10 px-4 py-3 text-xs font-mono text-neon-cyan transition-all hover:bg-neon-cyan/20 disabled:opacity-40"
                    >
                      {updatingModelKeyId === key.id ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                      {updatingModelKeyId === key.id ? ui.applyingModel : ui.applyModel}
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-white/35">{selectedCardModel?.description || ui.modelHelp}</p>
                </div>

                <div className="grid sm:grid-cols-3 gap-3 text-xs text-white/35">
                  <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                    <p className="font-mono text-white/30 mb-1">{ui.createdAt}</p>
                    <p>{key.created_at ? new Date(key.created_at).toLocaleString(locale) : '—'}</p>
                  </div>
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
            )
          })}
        </div>
      </div>

      <KeyDeleteConfirmDialog
        open={!!deleteDialogKey}
        busy={busyKeyId === deleteDialogKey?.id}
        title={ui.deleteDialogTitle}
        description={ui.deleteDialogText}
        highlight={ui.deleteDialogHighlight}
        details={deleteDialogKey ? [
          { label: ui.provider, value: catalog.find((entry) => entry.id === deleteDialogKey.provider)?.label || deleteDialogKey.provider },
          { label: ui.chosenModel, value: getModelLabel(catalog, deleteDialogKey.provider, deleteDialogKey.selected_model) },
          { label: ui.statusLabel, value: ui.status[deleteDialogKey.status] || deleteDialogKey.status },
        ] : []}
        confirmWord={ui.deleteDialogWord}
        inputLabel={ui.deleteDialogInput}
        inputPlaceholder={ui.deleteDialogPlaceholder}
        cancelLabel={ui.deleteDialogCancel}
        confirmLabel={ui.deleteDialogConfirm}
        onClose={() => setDeleteDialogKey(null)}
        onConfirm={confirmDeleteKey}
      />
    </div>
  )
}
