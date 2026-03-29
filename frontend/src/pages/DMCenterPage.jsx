import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BellRing, Mail, MessageCircleMore, Search, Send, Shield, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesAPI } from '../services/api'
import { useGuildStore } from '../stores'

const QUICK_TEMPLATES = [
  {
    id: 'followup',
    label: 'Suivi',
    title: 'Suivi du staff',
    message: 'Bonjour,\n\nNous revenons vers toi au sujet du serveur. Merci de répondre calmement si tu souhaites nous apporter des précisions.\n',
  },
  {
    id: 'warning',
    label: 'Prévention',
    title: 'Rappel important',
    message: 'Bonjour,\n\nNous t’écrivons pour te rappeler les règles du serveur. Merci d’en tenir compte pour la suite.\n',
  },
  {
    id: 'support',
    label: 'Support',
    title: 'Besoin de te joindre',
    message: 'Bonjour,\n\nNous avons besoin de te joindre en message privé pour clarifier un point. Merci de répondre dès que possible.\n',
  },
]

const TOGGLE_FIELDS = [
  { key: 'auto_dm_warn', label: 'Warn' },
  { key: 'auto_dm_timeout', label: 'Timeout' },
  { key: 'auto_dm_kick', label: 'Kick' },
  { key: 'auto_dm_ban', label: 'Ban' },
  { key: 'auto_dm_blacklist', label: 'Blacklist réseau' },
]

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Erreur inattendue'
}

function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?'
}

function Avatar({ src, label }) {
  if (src) {
    return <img src={src} alt={label} className="w-14 h-14 rounded-2xl border border-white/10 object-cover" />
  }

  return (
    <div className="w-14 h-14 rounded-2xl border border-white/10 bg-gradient-to-br from-neon-cyan/20 to-violet-500/20 flex items-center justify-center text-white/70 font-mono text-xs">
      {initials(label)}
    </div>
  )
}

function MetricCard({ label, value, tone = 'cyan' }) {
  const tones = {
    cyan: 'border-neon-cyan/15 bg-neon-cyan/[0.06]',
    violet: 'border-violet-400/15 bg-violet-400/[0.06]',
    emerald: 'border-emerald-400/15 bg-emerald-400/[0.06]',
  }

  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-2 font-display text-2xl font-800 text-white">{value}</p>
    </div>
  )
}

export default function DMCenterPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [settings, setSettings] = useState(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [composer, setComposer] = useState({ title: '', message: '' })
  const [loading, setLoading] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(false)

  const enabledCount = useMemo(() => {
    if (!settings) return 0
    return TOGGLE_FIELDS.filter(({ key }) => !!settings[key]).length
  }, [settings])

  useEffect(() => {
    setSettings(null)
    setQuery('')
    setResults([])
    setSelectedUser(null)
    setComposer({ title: '', message: '' })
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return
    let mounted = true

    async function loadConfig() {
      setLoading(true)
      try {
        const response = await messagesAPI.config(selectedGuildId)
        if (!mounted) return
        setSettings(response.data?.settings || {})
      } catch (error) {
        toast.error(getErrorMessage(error))
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadConfig()
    return () => {
      mounted = false
    }
  }, [selectedGuildId])

  async function handleSaveConfig() {
    if (!selectedGuildId || !settings) return
    setSavingConfig(true)
    try {
      const response = await messagesAPI.saveConfig(selectedGuildId, settings)
      setSettings(response.data?.settings || settings)
      toast.success('Centre DM mis à jour')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleSearch() {
    if (!selectedGuildId || !query.trim()) return
    setSearching(true)
    try {
      const response = await messagesAPI.search(selectedGuildId, { q: query.trim(), limit: 8 })
      const nextResults = response.data?.results || []
      setResults(nextResults)
      setSelectedUser(nextResults[0] || null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }

  async function handleSend() {
    if (!selectedGuildId || !selectedUser?.id || !composer.message.trim()) return
    setSending(true)
    try {
      await messagesAPI.send(selectedGuildId, {
        target_user_id: selectedUser.id,
        target_username: selectedUser.display_name || selectedUser.username || selectedUser.id,
        title: composer.title.trim() || undefined,
        message: composer.message.trim(),
      })
      setComposer({ title: '', message: '' })
      toast.success('Message envoyé')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSending(false)
    }
  }

  if (!selectedGuildId) {
    return (
      <div className="px-4 pt-20 pb-5 sm:p-6 sm:pt-24 max-w-3xl mx-auto">
        <div className="glass-card p-10 text-center">
          <Mail className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p>
          <p className="text-white/40 mt-2">Le Centre DM fonctionne serveur par serveur.</p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            Choisir un serveur
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <span className="feature-chip"><Mail className="w-3.5 h-3.5" /> centre dm</span>
              <span className="feature-chip"><Sparkles className="w-3.5 h-3.5" /> templates propres</span>
              <span className="feature-chip"><BellRing className="w-3.5 h-3.5" /> {guild?.name || 'serveur'}</span>
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Centre DM</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">
                Pilote tous les messages privés du staff dans une seule vue claire: réglages automatiques, recherche rapide, templates et envoi manuel.
              </p>
            </div>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <MetricCard label="Automatiques actifs" value={enabledCount} tone="emerald" />
          <MetricCard label="Résultats" value={results.length} tone="violet" />
          <MetricCard label="Cible ouverte" value={selectedUser ? '1' : '0'} tone="cyan" />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
        <div className="space-y-5">
          <div className="spotlight-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
                <Shield className="w-5 h-5 text-neon-cyan" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Réglages automatiques</p>
                <p className="text-white/40 text-sm mt-1">Choisis quels types de sanctions envoient un MP.</p>
              </div>
            </div>

            {loading && <div className="h-48 rounded-3xl skeleton" />}

            {!loading && settings && (
              <>
                <div className="grid gap-2">
                  {TOGGLE_FIELDS.map(({ key, label }) => (
                    <label key={key} className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/70">
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={!!settings[key]}
                        onChange={(event) => setSettings((current) => ({ ...current, [key]: event.target.checked }))}
                        className="toggle-switch"
                      />
                    </label>
                  ))}
                </div>

                <input
                  className="input-field"
                  placeholder="Nom du serveur de recours"
                  value={settings.appeal_server_name || ''}
                  onChange={(event) => setSettings((current) => ({ ...current, appeal_server_name: event.target.value }))}
                />
                <input
                  className="input-field"
                  placeholder="Lien du serveur de recours"
                  value={settings.appeal_server_url || ''}
                  onChange={(event) => setSettings((current) => ({ ...current, appeal_server_url: event.target.value }))}
                />
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-50"
                >
                  <Shield className={`w-4 h-4 ${savingConfig ? 'animate-pulse' : ''}`} />
                  {savingConfig ? 'Sauvegarde...' : 'Enregistrer'}
                </button>
              </>
            )}
          </div>

          <div className="spotlight-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Templates rapides</p>
                <p className="text-white/40 text-sm mt-1">Préremplis en un clic, puis ajuste le ton.</p>
              </div>
            </div>
            <div className="grid gap-2">
              {QUICK_TEMPLATES.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setComposer({ title: template.title, message: template.message })}
                  className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-left transition-all hover:border-white/12 hover:bg-white/[0.03]"
                >
                  <p className="font-display font-600 text-white">{template.label}</p>
                  <p className="mt-1 text-xs text-white/40">{template.title}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="spotlight-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-amber-400/20 bg-amber-400/10 flex items-center justify-center shrink-0">
                <Search className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Trouver un destinataire</p>
                <p className="text-white/40 text-sm mt-1">Pseudo, surnom ou ID Discord.</p>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[1fr_auto]">
              <div className="relative">
                <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
                <input
                  className="input-field pl-11"
                  placeholder="Exemple: pseudo ou ID Discord"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleSearch()
                    }
                  }}
                />
              </div>
              <button
                type="button"
                onClick={handleSearch}
                disabled={!query.trim() || searching}
                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"
              >
                <Search className={`w-4 h-4 ${searching ? 'animate-pulse' : ''}`} />
                Rechercher
              </button>
            </div>

            {results.length > 0 && (
              <div className="grid gap-3 lg:grid-cols-2">
                {results.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedUser(entry)}
                    className={`rounded-2xl border px-4 py-3 text-left transition-all ${
                      selectedUser?.id === entry.id
                        ? 'border-neon-cyan/25 bg-neon-cyan/10'
                        : 'border-white/[0.06] bg-white/[0.02] hover:border-white/12'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar src={entry.avatar_url} label={entry.display_name || entry.username || entry.id} />
                      <div className="min-w-0">
                        <p className="font-display font-700 text-white truncate">{entry.display_name || entry.username || entry.id}</p>
                        <p className="mt-1 text-xs text-white/35 truncate">@{entry.username || entry.id}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="spotlight-card p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                <MessageCircleMore className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Composer un DM</p>
                <p className="text-white/40 text-sm mt-1">Prépare un message propre et envoie-le sans quitter la vue.</p>
              </div>
            </div>

            {!selectedUser ? (
              <div className="rounded-3xl border border-white/8 bg-black/15 p-8 text-center text-white/40 text-sm">
                Sélectionne une personne pour ouvrir la composition.
              </div>
            ) : (
              <>
                <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-4 flex items-center gap-3">
                  <Avatar src={selectedUser.avatar_url} label={selectedUser.display_name || selectedUser.username || selectedUser.id} />
                  <div className="min-w-0">
                    <p className="font-display font-700 text-white truncate">{selectedUser.display_name || selectedUser.username || selectedUser.id}</p>
                    <p className="mt-1 text-xs text-white/35 truncate">{selectedUser.id}</p>
                  </div>
                </div>

                <input
                  className="input-field"
                  placeholder="Titre du message (optionnel)"
                  value={composer.title}
                  onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))}
                />
                <textarea
                  className="input-field min-h-[220px] resize-y"
                  placeholder="Ton message..."
                  value={composer.message}
                  onChange={(event) => setComposer((current) => ({ ...current, message: event.target.value }))}
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-white/35">{composer.message.trim().length} caractères</p>
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending || !composer.message.trim()}
                    className="inline-flex items-center gap-2 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 px-5 py-3 text-sm font-mono text-neon-cyan transition-all hover:bg-neon-cyan/15 disabled:opacity-50"
                  >
                    <Send className={`w-4 h-4 ${sending ? 'animate-pulse' : ''}`} />
                    {sending ? 'Envoi...' : 'Envoyer'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
