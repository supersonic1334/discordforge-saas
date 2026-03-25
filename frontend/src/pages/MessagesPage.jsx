import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BellRing,
  MessageCircleMore,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { messagesAPI } from '../services/api'
import { useGuildStore } from '../stores'

const DEFAULT_CONFIG = {
  auto_dm_warn: true,
  auto_dm_timeout: true,
  auto_dm_kick: true,
  auto_dm_ban: true,
  auto_dm_blacklist: true,
  appeal_server_name: '',
  appeal_server_url: '',
}

const AUTO_OPTIONS = [
  { key: 'auto_dm_warn', title: 'Warn', hint: 'MP propre quand un avertissement est pose.' },
  { key: 'auto_dm_timeout', title: 'Mute temporaire', hint: 'Explique la duree et la raison automatiquement.' },
  { key: 'auto_dm_kick', title: 'Kick', hint: 'Le bot previens avant de sortir la personne.' },
  { key: 'auto_dm_ban', title: 'Ban', hint: 'Le bot envoie aussi la passerelle de recours si tu la configures.' },
  { key: 'auto_dm_blacklist', title: 'Blacklist reseau', hint: 'Notification speciale si l acces global est coupe.' },
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

function Avatar({ src, label, tone = 'from-cyan-500/25 to-violet-500/25', size = 'w-14 h-14' }) {
  if (src) {
    return <img src={src} alt={label} className={`${size} rounded-2xl object-cover border border-white/10 shadow-[0_18px_36px_rgba(0,0,0,0.22)]`} />
  }

  return (
    <div className={`${size} rounded-2xl border border-white/10 bg-gradient-to-br ${tone} flex items-center justify-center text-white/75 font-mono text-xs shadow-[0_18px_36px_rgba(0,0,0,0.22)]`}>
      {initials(label)}
    </div>
  )
}

function TogglePill({ enabled, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex h-8 w-[74px] items-center rounded-full border transition-all ${
        enabled
          ? 'border-emerald-500/30 bg-emerald-500/12 shadow-[0_0_24px_rgba(52,211,153,0.16)]'
          : 'border-white/10 bg-white/[0.04]'
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full transition-all ${
          enabled
            ? 'left-[42px] bg-emerald-300 shadow-[0_8px_20px_rgba(52,211,153,0.35)]'
            : 'left-1 bg-white/25'
        }`}
      />
      <span className={`w-full px-3 text-[11px] font-mono uppercase tracking-[0.2em] ${enabled ? 'text-emerald-200 text-left' : 'text-white/45 text-right'}`}>
        {enabled ? 'On' : 'Off'}
      </span>
    </button>
  )
}

export default function MessagesPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [composer, setComposer] = useState({ title: '', message: '' })
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [loadingConfig, setLoadingConfig] = useState(false)
  const [searching, setSearching] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [sending, setSending] = useState(false)

  const appealGuilds = useMemo(
    () => guilds.filter((entry) => entry.id !== selectedGuildId),
    [guilds, selectedGuildId]
  )

  useEffect(() => {
    setQuery('')
    setResults([])
    setSelectedUser(null)
    setComposer({ title: '', message: '' })
  }, [selectedGuildId])

  useEffect(() => {
    if (!selectedGuildId) return
    loadConfig()
  }, [selectedGuildId])

  async function loadConfig() {
    if (!selectedGuildId) return
    setLoadingConfig(true)
    try {
      const response = await messagesAPI.config(selectedGuildId)
      setConfig({ ...DEFAULT_CONFIG, ...(response.data?.settings || {}) })
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setLoadingConfig(false)
    }
  }

  async function handleSearch() {
    if (!selectedGuildId || !query.trim()) return
    setSearching(true)
    try {
      const response = await messagesAPI.search(selectedGuildId, { q: query.trim(), limit: 10 })
      const nextResults = response.data?.results || []
      setResults(nextResults)
      setSelectedUser(nextResults[0] || null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSearching(false)
    }
  }

  async function handleSaveConfig() {
    if (!selectedGuildId || savingConfig) return
    setSavingConfig(true)
    try {
      const response = await messagesAPI.saveConfig(selectedGuildId, config)
      setConfig({ ...DEFAULT_CONFIG, ...(response.data?.settings || {}) })
      toast.success('Configuration MP enregistree')
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleSendMessage() {
    if (!selectedGuildId || !selectedUser?.id || !composer.message.trim() || sending) return
    setSending(true)
    try {
      await messagesAPI.send(selectedGuildId, {
        target_user_id: selectedUser.id,
        target_username: selectedUser.display_name || selectedUser.username || selectedUser.id,
        title: composer.title.trim() || undefined,
        message: composer.message.trim(),
      })
      setComposer({ title: '', message: '' })
      toast.success('Message prive envoye')
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
          <MessageCircleMore className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">Choisis d'abord un serveur</p>
          <p className="text-white/40 mt-2">La categorie Messages fonctionne serveur par serveur.</p>
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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">Messages prives</h1>
          <p className="text-white/40 text-sm mt-1">Recherche un membre puis envoie un MP propre. Les sanctions du site peuvent aussi partir automatiquement d ici. - {guild?.name}</p>
        </div>
        <button onClick={loadConfig} className="inline-flex items-center gap-2 px-4 py-3 rounded-2xl border border-white/10 bg-white/[0.03] text-white/70 text-sm font-mono hover:border-white/20 hover:text-white transition-all">
          <RefreshCw className={`w-4 h-4 ${loadingConfig ? 'animate-spin' : ''}`} />
          Recharger
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="glass-card p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
                <Search className="w-5 h-5 text-neon-cyan" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Recherche rapide</p>
                <p className="text-white/40 text-sm mt-1">Pseudo, surnom ou ID Discord.</p>
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-white/25 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                className="input-field pl-11"
                placeholder="Exemple: Dream ou 123456789"
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
              onClick={handleSearch}
              disabled={!query.trim() || searching}
              className="inline-flex w-full items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${searching ? 'animate-spin' : ''}`} />
              Rechercher
            </button>
          </div>

          <div className="space-y-3">
            {!searching && results.length === 0 && (
              <div className="glass-card p-6 text-center text-white/40 text-sm">
                {query.trim() ? 'Aucun resultat.' : 'Lance une recherche pour ouvrir une fiche MP.'}
              </div>
            )}

            {results.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedUser(entry)}
                className={`w-full text-left glass-card p-4 border transition-all ${
                  selectedUser?.id === entry.id
                    ? 'border-neon-cyan/25 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
                    : 'border-white/8 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Avatar src={entry.avatar_url} label={entry.display_name} />
                  <div className="min-w-0">
                    <p className="text-white font-display font-700 truncate">{entry.display_name}</p>
                    <p className="text-sm text-white/55 truncate mt-1">@{entry.username || entry.id}</p>
                    <p className="text-[11px] text-white/30 font-mono mt-2">{entry.id}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="glass-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                <Send className="w-5 h-5 text-violet-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Envoyer un message</p>
                <p className="text-white/40 text-sm mt-1">Le bot enverra un MP direct avec un rendu plus propre qu un texte brut.</p>
              </div>
            </div>

            {!selectedUser && (
              <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-8 text-center text-white/40 text-sm">
                Selectionne une personne a gauche pour ouvrir la composition.
              </div>
            )}

            {selectedUser && (
              <>
                <div className="rounded-3xl border border-white/8 bg-white/[0.02] p-5 flex items-center gap-4">
                  <Avatar src={selectedUser.avatar_url} label={selectedUser.display_name} size="w-16 h-16" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2 items-center">
                      <p className="font-display font-800 text-white text-2xl truncate">{selectedUser.display_name}</p>
                      {selectedUser.banned && <span className="px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-300 text-xs font-mono">Banni</span>}
                      {selectedUser.in_server && <span className="px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-xs font-mono">Dans le serveur</span>}
                    </div>
                    <p className="text-white/55 text-sm mt-1">@{selectedUser.username || selectedUser.id}</p>
                    <p className="text-[11px] text-white/30 font-mono mt-2">{selectedUser.id}</p>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div className="space-y-4">
                    <label className="block space-y-2">
                      <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Titre</span>
                      <input
                        className="input-field"
                        placeholder="Exemple: Message du staff"
                        value={composer.title}
                        onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))}
                      />
                    </label>

                    <label className="block space-y-2">
                      <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Message</span>
                      <textarea
                        className="input-field min-h-[220px] resize-y"
                        placeholder="Ecris ici le message prive a envoyer..."
                        value={composer.message}
                        onChange={(event) => setComposer((current) => ({ ...current, message: event.target.value }))}
                      />
                    </label>

                    <button
                      onClick={handleSendMessage}
                      disabled={sending || !composer.message.trim()}
                      className="inline-flex w-full items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-neon-cyan/25 bg-neon-cyan/10 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/15 transition-all disabled:opacity-50"
                    >
                      <Send className="w-4 h-4" />
                      {sending ? 'Envoi...' : 'Envoyer le MP'}
                    </button>
                  </div>

                  <div className="rounded-3xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-5 space-y-4">
                    <div className="flex items-center gap-2 text-white">
                      <BellRing className="w-4 h-4 text-amber-300" />
                      <p className="font-display font-700">Apercu</p>
                    </div>
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-4 space-y-3">
                      <div className="flex items-center gap-3">
                        <Avatar src={guild?.iconUrl} label={guild?.name} tone="from-cyan-500/25 to-violet-500/25" size="w-11 h-11" />
                        <div>
                          <p className="text-white font-display font-700">{guild?.name}</p>
                          <p className="text-white/35 text-xs">Message prive staff</p>
                        </div>
                      </div>
                      <div>
                        <p className="text-white text-sm font-display font-700">{composer.title.trim() || 'Message du staff'}</p>
                        <p className="text-white/65 text-sm mt-2 whitespace-pre-wrap">{composer.message.trim() || 'Ton message apparaitra ici avec le rendu final du bot.'}</p>
                      </div>
                    </div>
                    <p className="text-white/35 text-xs leading-6">Le rendu final ajoute automatiquement l identite du serveur, l heure et la presentation propre dans le MP.</p>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="glass-card p-6 space-y-5">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-emerald-300" />
              </div>
              <div>
                <p className="font-display font-700 text-white text-lg">Notifications automatiques</p>
                <p className="text-white/40 text-sm mt-1">Chaque sanction du site peut envoyer son propre MP visuel, sans repasser ailleurs.</p>
              </div>
            </div>

            <div className="grid gap-3">
              {AUTO_OPTIONS.map((item) => (
                <div key={item.key} className="rounded-2xl border border-white/8 bg-white/[0.02] px-4 py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-white font-display font-700">{item.title}</p>
                    <p className="text-white/40 text-sm mt-1">{item.hint}</p>
                  </div>
                  <TogglePill
                    enabled={!!config[item.key]}
                    onClick={() => setConfig((current) => ({ ...current, [item.key]: !current[item.key] }))}
                  />
                </div>
              ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <label className="block space-y-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Serveur de recours</span>
                <select
                  className="select-field"
                  value={appealGuilds.some((entry) => entry.name === config.appeal_server_name) ? config.appeal_server_name : ''}
                  onChange={(event) => setConfig((current) => ({ ...current, appeal_server_name: event.target.value }))}
                >
                  <option value="">Aucun serveur choisi</option>
                  {appealGuilds.map((entry) => (
                    <option key={entry.id} value={entry.name}>{entry.name}</option>
                  ))}
                </select>
              </label>

              <label className="block space-y-2">
                <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Lien d invitation</span>
                <input
                  className="input-field"
                  placeholder="https://discord.gg/..."
                  value={config.appeal_server_url}
                  onChange={(event) => setConfig((current) => ({ ...current, appeal_server_url: event.target.value }))}
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Nom libre du serveur de recours</span>
              <input
                className="input-field"
                placeholder="Exemple: Support deban DiscordForger"
                value={config.appeal_server_name}
                onChange={(event) => setConfig((current) => ({ ...current, appeal_server_name: event.target.value }))}
              />
            </label>

            <button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-violet-500/25 bg-violet-500/10 text-violet-200 font-mono text-sm hover:bg-violet-500/15 transition-all disabled:opacity-50"
            >
              <BellRing className="w-4 h-4" />
              {savingConfig ? 'Enregistrement...' : 'Enregistrer la configuration'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
