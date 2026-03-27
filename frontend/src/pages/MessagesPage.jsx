import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Calendar,
  Copy,
  Mail,
  MessageCircleMore,
  Search,
  Send,
  Sparkles,
  User,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import toast from 'react-hot-toast'
import { messagesAPI } from '../services/api'
import { useGuildStore } from '../stores'

const QUICK_TEMPLATES = [
  {
    id: 'staff',
    label: 'Staff',
    title: 'Message du staff',
    message: 'Bonjour,\n\nJe te contacte au sujet du serveur. Merci de prendre en compte ce message et de revenir vers nous si besoin.\n\nCordialement,\nLe staff',
  },
  {
    id: 'followup',
    label: 'Suivi',
    title: 'Suivi moderation',
    message: 'Bonjour,\n\nNous faisons un suivi concernant ta situation sur le serveur. Merci de nous repondre calmement si tu souhaites apporter des precisions.\n\nLe staff',
  },
  {
    id: 'support',
    label: 'Support',
    title: 'Besoin de te joindre',
    message: 'Bonjour,\n\nNous avons besoin de te contacter en message prive pour clarifier un point. Reponds simplement a ce MP des que possible.\n\nMerci.',
  },
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

function HeaderPill({ icon: Icon, label }) {
  return (
    <span className="feature-chip">
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  )
}

export default function MessagesPage() {
  const { guilds, selectedGuildId } = useGuildStore()
  const guild = guilds.find((entry) => entry.id === selectedGuildId)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [composer, setComposer] = useState({ title: '', message: '' })
  const [searching, setSearching] = useState(false)
  const [sending, setSending] = useState(false)

  const messageLength = composer.message.trim().length

  useEffect(() => {
    setQuery('')
    setResults([])
    setSelectedUser(null)
    setComposer({ title: '', message: '' })
  }, [selectedGuildId])

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

  async function handleCopyId() {
    if (!selectedUser?.id) return
    try {
      await navigator.clipboard.writeText(selectedUser.id)
      toast.success('ID copie')
    } catch {
      toast.error('Copie impossible')
    }
  }

  function applyTemplate(template) {
    setComposer({
      title: template.title,
      message: template.message,
    })
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
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <HeaderPill icon={MessageCircleMore} label="messages prives" />
              <HeaderPill icon={Sparkles} label="templates rapides" />
              <HeaderPill icon={Mail} label={guild?.name || 'serveur'} />
            </div>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">Messages</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/55 sm:text-[15px]">Recherche un membre, ouvre sa fiche en un clic et prepare un MP propre avec apercu direct, templates rapides et envoi simplifie.</p>
            </div>
          </div>
        </div>

        <div className="relative z-[1] mt-6 grid gap-3 sm:grid-cols-3">
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Resultats</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{results.length}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Cible ouverte</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{selectedUser ? '1' : '0'}</p>
          </div>
          <div className="feature-metric">
            <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-white/35">Longueur</p>
            <p className="mt-2 font-display text-2xl font-800 text-white">{messageLength}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="spotlight-card p-5 sm:p-6">
            <div className="relative z-[1] space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl border border-neon-cyan/20 bg-neon-cyan/10 flex items-center justify-center shrink-0">
                  <Search className="w-5 h-5 text-neon-cyan" />
                </div>
                <div>
                  <p className="font-display font-700 text-white text-lg">Recherche membre</p>
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
                <Search className={`w-4 h-4 ${searching ? 'animate-pulse' : ''}`} />
                Rechercher
              </button>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {searching && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-2xl skeleton" />)}
              </motion.div>
            )}

            {!searching && results.length === 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="spotlight-card p-6 text-center text-white/40 text-sm"
              >
                <div className="relative z-[1]">
                  {query.trim() ? 'Aucun resultat.' : 'Lance une recherche pour ouvrir une fiche MP.'}
                </div>
              </motion.div>
            )}

            {!searching && results.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {results.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedUser(entry)}
                    className={`w-full text-left depth-panel p-4 border transition-all ${
                      selectedUser?.id === entry.id
                        ? 'border-neon-cyan/25 shadow-[0_0_24px_rgba(34,211,238,0.12)]'
                        : 'border-white/8 hover:border-white/15'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar src={entry.avatar_url} label={entry.display_name || entry.username || entry.id} />
                      <div className="min-w-0">
                        <p className="text-white font-display font-700 truncate">{entry.display_name || entry.username || entry.id}</p>
                        <p className="text-sm text-white/55 truncate mt-1">@{entry.username || entry.id}</p>
                        <p className="text-[11px] text-white/30 font-mono mt-2">{entry.id}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="space-y-5">
          <div className="spotlight-card p-6">
            <div className="relative z-[1] space-y-5">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl border border-violet-500/20 bg-violet-500/10 flex items-center justify-center shrink-0">
                  <Send className="w-5 h-5 text-violet-300" />
                </div>
                <div>
                  <p className="font-display font-700 text-white text-lg">Composer un message</p>
                  <p className="text-white/40 text-sm mt-1">Page reservee uniquement a l'envoi manuel de MP.</p>
                </div>
              </div>

              {!selectedUser && (
                <div className="rounded-3xl border border-white/8 bg-black/15 p-8 text-center text-white/40 text-sm">
                  Selectionne une personne a gauche pour ouvrir la composition.
                </div>
              )}

              {selectedUser && (
                <AnimatePresence mode="wait">
                  <motion.div
                    key={selectedUser.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    transition={{ duration: 0.2 }}
                    className="space-y-5"
                  >
                    <div className="rounded-3xl border border-white/8 bg-black/15 p-5 flex items-center gap-4">
                      <Avatar src={selectedUser.avatar_url} label={selectedUser.display_name || selectedUser.username || selectedUser.id} size="w-16 h-16" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap gap-2 items-center">
                          <p className="font-display font-800 text-white text-2xl truncate">{selectedUser.display_name || selectedUser.username || selectedUser.id}</p>
                          {selectedUser.banned && <span className="px-2.5 py-1 rounded-full border border-red-500/20 bg-red-500/10 text-red-300 text-xs font-mono">Banni</span>}
                          {selectedUser.in_server && <span className="px-2.5 py-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 text-xs font-mono">Dans le serveur</span>}
                        </div>
                        <p className="text-white/55 text-sm mt-1 flex items-center gap-2">
                          <User className="w-3 h-3" />
                          @{selectedUser.username || selectedUser.id}
                        </p>
                        <p className="text-[11px] text-white/30 font-mono mt-2 flex items-center gap-2">
                          <Mail className="w-3 h-3" />
                          {selectedUser.id}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyId}
                        className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/60 transition-all hover:border-white/20 hover:text-white"
                      >
                        <Copy className="w-4 h-4" />
                        ID
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {QUICK_TEMPLATES.map((template) => (
                        <button
                          key={template.id}
                          type="button"
                          onClick={() => applyTemplate(template)}
                          className="feature-chip transition-all hover:border-white/20 hover:bg-white/[0.08] hover:text-white"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          {template.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                      <div className="space-y-4">
                        <label className="block space-y-2">
                          <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Titre du message</span>
                          <input
                            className="input-field"
                            placeholder="Exemple: Message du staff"
                            value={composer.title}
                            onChange={(event) => setComposer((current) => ({ ...current, title: event.target.value }))}
                          />
                        </label>

                        <label className="block space-y-2">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-xs font-mono uppercase tracking-[0.2em] text-white/35">Contenu du message</span>
                            <span className="text-[11px] font-mono text-white/30">{messageLength} caracteres</span>
                          </div>
                          <textarea
                            className="input-field min-h-[240px] resize-y"
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
                          <Send className={`w-4 h-4 ${sending ? 'animate-pulse' : ''}`} />
                          {sending ? 'Envoi...' : 'Envoyer le MP'}
                        </button>
                      </div>

                      <div className="depth-panel-static rounded-3xl border border-white/8 bg-gradient-to-br from-white/[0.04] to-white/[0.02] p-5 space-y-4">
                        <div className="flex items-center gap-2 text-white">
                          <Sparkles className="w-4 h-4 text-violet-300" />
                          <p className="font-display font-700">Apercu du rendu</p>
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-black/20 p-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <Avatar src={guild?.iconUrl} label={guild?.name} tone="from-cyan-500/25 to-violet-500/25" size="w-11 h-11" />
                            <div>
                              <p className="text-white font-display font-700">{guild?.name}</p>
                              <p className="text-white/35 text-xs flex items-center gap-1.5">
                                <Calendar className="w-3 h-3" />
                                Message prive staff
                              </p>
                            </div>
                          </div>
                          <div>
                            <p className="text-white text-sm font-display font-700">{composer.title.trim() || 'Message du staff'}</p>
                            <p className="text-white/65 text-sm mt-2 whitespace-pre-wrap">{composer.message.trim() || 'Ton message apparaitra ici avec le rendu final du bot.'}</p>
                          </div>
                        </div>
                        <p className="text-white/35 text-xs leading-6">Le rendu final garde l'identite du serveur et une presentation propre, sans melanger cette page avec les notifications automatiques.</p>
                      </div>
                    </div>
                  </motion.div>
                </AnimatePresence>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
