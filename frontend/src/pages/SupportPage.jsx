import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BadgeHelp,
  Bug,
  CheckCircle2,
  Clock3,
  LifeBuoy,
  Mail,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Ticket,
  Trash2,
  UserRoundCheck,
  UserRoundPlus,
  XCircle,
} from 'lucide-react'
import { supportAPI } from '../services/api'
import { useAuthStore } from '../stores'
import { useI18n } from '../i18n'

const TEXT = {
  fr: {
    title: 'Support',
    userSubtitle: 'Tu envoies juste ton message, puis tu suis la reponse ici.',
    adminTitle: 'Support admin',
    adminSubtitle: 'File claire pour traiter les tickets sans melanger le cote client et le cote staff.',
    routeMissing: 'Le support backend nest pas charge. Redemarre le backend pour activer la route support.',
    newTicket: 'Nouvelle demande',
    newTicketHint: 'Choisis la raison, ecris ton message, le reste se gere tout seul.',
    queue: 'File support',
    queueHint: 'Filtres, claim, reponse et suivi complet.',
    conversation: 'Conversation',
    noTicket: 'Choisis un ticket pour afficher toute la conversation.',
    noMine: 'Aucun ticket pour le moment.',
    noQueue: 'Aucun ticket dans la file support.',
    refresh: 'Actualiser',
    sendTicket: 'Envoyer au support',
    sendReply: 'Envoyer la reponse',
    message: 'Message',
    messagePlaceholder: 'Explique clairement le probleme, ce que tu faisais et ce qui bloque.',
    replyPlaceholder: 'Reponse support...',
    subject: 'Sujet',
    reason: 'Raison',
    status: 'Statut',
    claim: 'Claim',
    requester: 'Demandeur',
    contact: 'Contact',
    ticketInfo: 'Ticket',
    handling: 'Prise en charge',
    nobody: 'Non attribue',
    opened: 'Ouvert',
    activity: 'Activite',
    joined: 'Compte cree',
    lastLogin: 'Derniere connexion',
    closedText: 'Ce ticket est ferme. Il faut le reouvrir pour repondre.',
    claimAction: 'Reclamer',
    unclaimAction: 'Liberer',
    closeAction: 'Fermer',
    reopenAction: 'Reouvrir',
    editAction: 'Modifier',
    cancelAction: 'Annuler',
    saveAction: 'Enregistrer',
    deleteTicket: 'Supprimer le ticket',
    deleteMessage: 'Supprimer le message',
    search: 'Recherche',
    searchPlaceholder: 'Numero, pseudo, email ou texte',
    total: 'Tickets',
    open: 'En attente',
    claimed: 'Pris',
    closed: 'Clotures',
    unclaimed: 'Sans claim',
    created: 'Ticket envoye',
    replied: 'Reponse envoyee',
    claimedOk: 'Ticket reclame',
    unclaimedOk: 'Ticket libere',
    updated: 'Ticket mis a jour',
    statusOk: 'Statut mis a jour',
    deleted: 'Ticket supprime',
    messageDeleted: 'Message supprime',
    deletedText: 'Message retire par le fondateur principal.',
    confirmDeleteTicket: 'Supprimer definitivement ce ticket ?',
    confirmDeleteMessage: 'Supprimer ce message du ticket ?',
    statuses: { all: 'Tous', open: 'En attente', claimed: 'Pris en charge', closed: 'Clos' },
    claims: { all: 'Tous', mine: 'Par moi', unclaimed: 'Sans claim' },
    categories: { all: 'Toutes', bug: 'Bug', report: 'Signalement', account: 'Compte', question: 'Question', other: 'Autre' },
    categoryHelp: {
      bug: 'Quelque chose casse ou plante.',
      report: 'Tu signales un abus.',
      account: 'Connexion, profil ou acces.',
      question: 'Tu as besoin daide.',
      other: 'Toute autre demande.',
    },
    roles: { member: 'Utilisateur', admin: 'Admin', founder: 'Fondateur', api_provider: 'Fournisseur API', system: 'Support' },
    messages: 'messages',
  },
}

const CATEGORY_META = {
  bug: { icon: Bug, tone: 'border-red-500/20 bg-red-500/10 text-red-300' },
  report: { icon: ShieldAlert, tone: 'border-orange-500/20 bg-orange-500/10 text-orange-300' },
  account: { icon: Shield, tone: 'border-violet-500/20 bg-violet-500/10 text-violet-300' },
  question: { icon: BadgeHelp, tone: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300' },
  other: { icon: Sparkles, tone: 'border-white/10 bg-white/[0.04] text-white/70' },
}

const STATUS_STYLES = {
  open: 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300',
  claimed: 'border-amber-500/20 bg-amber-500/10 text-amber-300',
  closed: 'border-white/10 bg-white/[0.04] text-white/65',
}

function getText(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return TEXT[key] || TEXT.fr
}

function formatDate(locale, value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
}

function getErrorMessage(error, text) {
  const message = error?.response?.data?.error || error?.message || 'Unexpected error'
  return String(message).includes('/api/v1/support/') ? text.routeMissing : message
}

function renderAvatar(profile, size = 'w-11 h-11') {
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt={profile?.username || 'User'} className={`${size} rounded-2xl object-cover border border-white/10`} />
  }
  const initials = String(profile?.username || '?').slice(0, 2).toUpperCase()
  return (
    <div className={`${size} rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-500/20 to-violet-500/20 flex items-center justify-center text-white/85 font-mono text-xs`}>
      {initials}
    </div>
  )
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-mono ${className}`}>{children}</span>
}

function CountCard({ icon: Icon, label, value, tone }) {
  return (
    <div className="rounded-[26px] border border-white/[0.08] bg-white/[0.03] p-4">
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl border ${tone}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="mt-4 font-display text-2xl font-700 text-white">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-[0.24em] text-white/38">{label}</div>
    </div>
  )
}

function TicketItem({ ticket, selected, locale, text, onSelect }) {
  const meta = CATEGORY_META[ticket.category] || CATEGORY_META.other
  const Icon = meta.icon

  return (
    <button
      type="button"
      onClick={() => onSelect(ticket.id)}
      className={`w-full rounded-[24px] border p-4 text-left transition-all ${
        selected ? 'border-cyan-500/25 bg-cyan-500/10' : 'border-white/10 bg-black/20 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        {renderAvatar(ticket.owner)}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="border-white/10 bg-white/[0.04] text-white/80">#{ticket.ticket_number}</Pill>
            <Pill className={STATUS_STYLES[ticket.status]}>{text.statuses[ticket.status]}</Pill>
            <Pill className={meta.tone}>
              <Icon className="mr-1.5 h-3 w-3" />
              {text.categories[ticket.category]}
            </Pill>
          </div>
          <div className="mt-3 truncate font-display text-white font-700">{ticket.title}</div>
          <div className="mt-1 line-clamp-2 text-sm text-white/40">{ticket.last_message_preview || '...'}</div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-mono text-white/30">
            <span>{ticket.owner?.username}</span>
            <span>{ticket.message_count} {text.messages}</span>
            <span>{formatDate(locale, ticket.last_message_at)}</span>
          </div>
        </div>
      </div>
    </button>
  )
}

function MetaCard({ title, children }) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-xs uppercase tracking-[0.24em] text-white/35">{title}</div>
      {children}
    </div>
  )
}

export default function SupportPage() {
  const { locale } = useI18n()
  const text = getText(locale)
  const { user } = useAuthStore()
  const isStaff = ['admin', 'founder'].includes(user?.role)
  const isPrimaryFounder = !!user?.is_primary_founder

  const [tickets, setTickets] = useState([])
  const [counts, setCounts] = useState({ total: 0, open: 0, claimed: 0, unclaimed: 0, closed: 0 })
  const [selectedTicketId, setSelectedTicketId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [filters, setFilters] = useState({ status: 'all', category: 'all', claim: 'all', q: '' })
  const [newTicket, setNewTicket] = useState({ category: 'bug', title: '', message: '' })
  const [editForm, setEditForm] = useState({ title: '', category: 'bug', status: 'open' })
  const [reply, setReply] = useState('')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [creatingTicket, setCreatingTicket] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [editingTicket, setEditingTicket] = useState(false)
  const [busyAction, setBusyAction] = useState('')

  const query = useMemo(() => ({
    view: isStaff ? 'staff' : 'mine',
    status: filters.status,
    category: filters.category,
    claim: isStaff ? filters.claim : 'all',
    q: filters.q,
    page: 1,
    limit: 50,
  }), [filters.category, filters.claim, filters.q, filters.status, isStaff])

  useEffect(() => {
    loadTickets()
  }, [query.view, query.status, query.category, query.claim, query.q])

  useEffect(() => {
    if (!selectedTicketId) {
      setDetail(null)
      return
    }
    loadDetail(selectedTicketId)
  }, [selectedTicketId])

  const notifyError = (error, id = 'support-error') => {
    toast.error(getErrorMessage(error, text), { id })
  }

  async function loadTickets(preferredId = null) {
    setLoadingList(true)
    try {
      const response = await supportAPI.listTickets(query)
      const nextTickets = response.data.tickets || []
      setTickets(nextTickets)
      setCounts(response.data.counts || { total: 0, open: 0, claimed: 0, unclaimed: 0, closed: 0 })
      const targetId = preferredId || selectedTicketId
      if (targetId && nextTickets.some((ticket) => ticket.id === targetId)) {
        setSelectedTicketId(targetId)
      } else {
        setSelectedTicketId(nextTickets[0]?.id || null)
      }
    } catch (error) {
      setTickets([])
      setCounts({ total: 0, open: 0, claimed: 0, unclaimed: 0, closed: 0 })
      setSelectedTicketId(null)
      setDetail(null)
      notifyError(error, 'support-load')
    } finally {
      setLoadingList(false)
    }
  }

  async function loadDetail(ticketId) {
    setLoadingDetail(true)
    try {
      const response = await supportAPI.getTicket(ticketId)
      setDetail(response.data)
      setEditForm({
        title: response.data.ticket?.title || '',
        category: response.data.ticket?.category || 'bug',
        status: response.data.ticket?.status || 'open',
      })
    } catch (error) {
      setDetail(null)
      notifyError(error, 'support-detail')
    } finally {
      setLoadingDetail(false)
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!newTicket.message.trim()) return
    setCreatingTicket(true)
    try {
      const response = await supportAPI.createTicket(newTicket)
      setNewTicket((state) => ({ ...state, title: '', message: '' }))
      setSelectedTicketId(response.data.ticket?.id || null)
      setDetail({ ticket: response.data.ticket, messages: response.data.messages })
      toast.success(text.created)
      await loadTickets(response.data.ticket?.id || null)
    } catch (error) {
      notifyError(error, 'support-create')
    } finally {
      setCreatingTicket(false)
    }
  }

  async function handleReply(event) {
    event.preventDefault()
    if (!selectedTicketId || !reply.trim()) return
    setSendingReply(true)
    try {
      const response = await supportAPI.sendMessage(selectedTicketId, { message: reply.trim() })
      setReply('')
      setDetail({ ticket: response.data.ticket, messages: response.data.messages })
      toast.success(text.replied)
      await loadTickets(selectedTicketId)
    } catch (error) {
      notifyError(error, 'support-reply')
    } finally {
      setSendingReply(false)
    }
  }

  async function runAction(key, request, successMessage, onSuccess) {
    if (!selectedTicketId) return
    setBusyAction(key)
    try {
      const response = await request()
      if (response?.data?.ticket) {
        setDetail({ ticket: response.data.ticket, messages: response.data.messages })
        setEditForm({
          title: response.data.ticket.title,
          category: response.data.ticket.category,
          status: response.data.ticket.status,
        })
      }
      if (successMessage) toast.success(successMessage)
      if (onSuccess) onSuccess()
      await loadTickets(selectedTicketId)
    } catch (error) {
      notifyError(error, `support-${key}`)
    } finally {
      setBusyAction('')
    }
  }

  async function handleDeleteTicket() {
    if (!selectedTicketId || !window.confirm(text.confirmDeleteTicket)) return
    setBusyAction('delete-ticket')
    try {
      await supportAPI.deleteTicket(selectedTicketId)
      toast.success(text.deleted)
      setSelectedTicketId(null)
      setDetail(null)
      await loadTickets()
    } catch (error) {
      notifyError(error, 'support-delete-ticket')
    } finally {
      setBusyAction('')
    }
  }

  async function handleDeleteMessage(messageId) {
    if (!window.confirm(text.confirmDeleteMessage)) return
    setBusyAction(`delete-message-${messageId}`)
    try {
      const response = await supportAPI.deleteMessage(messageId)
      setDetail({ ticket: response.data.ticket, messages: response.data.messages })
      toast.success(text.messageDeleted)
      await loadTickets(selectedTicketId)
    } catch (error) {
      notifyError(error, `support-delete-message-${messageId}`)
    } finally {
      setBusyAction('')
    }
  }

  const selectedTicket = detail?.ticket || null
  const messages = detail?.messages || []

  const renderConversation = () => {
    if (!selectedTicket) {
      return (
        <div className="flex min-h-[320px] items-center justify-center px-6">
          <div className="text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.04] text-white/60">
              <Ticket className="h-8 w-8" />
            </div>
            <div className="font-display text-2xl font-700 text-white">{text.conversation}</div>
            <p className="mt-3 text-white/45">{text.noTicket}</p>
          </div>
        </div>
      )
    }

    return (
      <>
        <div className="border-b border-white/[0.08] px-6 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="border-white/10 bg-white/[0.04] text-white/80">#{selectedTicket.ticket_number}</Pill>
                <Pill className={STATUS_STYLES[selectedTicket.status]}>{text.statuses[selectedTicket.status]}</Pill>
                <Pill className={CATEGORY_META[selectedTicket.category]?.tone || CATEGORY_META.other.tone}>{text.categories[selectedTicket.category]}</Pill>
              </div>
              <h2 className="mt-3 font-display text-2xl font-700 text-white">{selectedTicket.title}</h2>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/40">
                <span>{text.opened}: {formatDate(locale, selectedTicket.created_at)}</span>
                <span>{text.activity}: {formatDate(locale, selectedTicket.last_message_at)}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => loadDetail(selectedTicket.id)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/70 hover:bg-white/[0.07] hover:text-white">
                <RefreshCw className={`h-4 w-4 ${loadingDetail ? 'animate-spin' : ''}`} />
                {text.refresh}
              </button>
              {selectedTicket.permissions?.can_claim && !selectedTicket.claimer?.id && (
                <button type="button" disabled={busyAction === 'claim'} onClick={() => runAction('claim', () => supportAPI.claimTicket(selectedTicket.id), text.claimedOk)} className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-300 disabled:opacity-60">
                  <UserRoundPlus className="h-4 w-4" />
                  {text.claimAction}
                </button>
              )}
              {selectedTicket.permissions?.can_unclaim && selectedTicket.claimer?.id && (
                <button type="button" disabled={busyAction === 'unclaim'} onClick={() => runAction('unclaim', () => supportAPI.unclaimTicket(selectedTicket.id), text.unclaimedOk)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/70 disabled:opacity-60">
                  <UserRoundCheck className="h-4 w-4" />
                  {text.unclaimAction}
                </button>
              )}
              {selectedTicket.permissions?.can_close && (
                <button type="button" disabled={busyAction === 'close'} onClick={() => runAction('close', () => supportAPI.setStatus(selectedTicket.id, { status: 'closed' }), text.statusOk)} className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-300 disabled:opacity-60">
                  <XCircle className="h-4 w-4" />
                  {text.closeAction}
                </button>
              )}
              {selectedTicket.permissions?.can_reopen && (
                <button type="button" disabled={busyAction === 'reopen'} onClick={() => runAction('reopen', () => supportAPI.setStatus(selectedTicket.id, { status: 'open' }), text.statusOk)} className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-emerald-300 disabled:opacity-60">
                  <CheckCircle2 className="h-4 w-4" />
                  {text.reopenAction}
                </button>
              )}
              {selectedTicket.permissions?.can_edit && (
                <button type="button" onClick={() => setEditingTicket((state) => !state)} className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-violet-300">
                  <Shield className="h-4 w-4" />
                  {editingTicket ? text.cancelAction : text.editAction}
                </button>
              )}
              {selectedTicket.permissions?.can_delete && (
                <button type="button" disabled={busyAction === 'delete-ticket'} onClick={handleDeleteTicket} className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-300 disabled:opacity-60">
                  <Trash2 className="h-4 w-4" />
                  {text.deleteTicket}
                </button>
              )}
            </div>
          </div>

          {isStaff && (
            <div className="mt-5 grid gap-4 xl:grid-cols-4">
              <MetaCard title={text.requester}>
                <div className="flex items-center gap-3">
                  {renderAvatar(selectedTicket.owner)}
                  <div className="min-w-0">
                    <div className="truncate font-display text-white font-700">{selectedTicket.owner?.username}</div>
                    <div className="text-sm text-white/40">{text.roles[selectedTicket.owner?.role] || selectedTicket.owner?.role}</div>
                  </div>
                </div>
              </MetaCard>
              <MetaCard title={text.contact}>
                <div className="space-y-2 text-sm text-white/75">
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-cyan-300" />
                    <span className="break-all">{selectedTicket.owner?.email || '—'}</span>
                  </div>
                  <div className="text-white/45">{text.joined}: {formatDate(locale, selectedTicket.owner?.joined_at)}</div>
                  <div className="text-white/45">{text.lastLogin}: {formatDate(locale, selectedTicket.owner?.last_login_at)}</div>
                </div>
              </MetaCard>
              <MetaCard title={text.ticketInfo}>
                <div className="space-y-2 text-sm text-white/75">
                  <div>{text.reason}: <span className="text-white">{text.categories[selectedTicket.category]}</span></div>
                  <div>{text.status}: <span className="text-white">{text.statuses[selectedTicket.status]}</span></div>
                  <div>{text.opened}: <span className="text-white">{formatDate(locale, selectedTicket.created_at)}</span></div>
                </div>
              </MetaCard>
              <MetaCard title={text.handling}>
                {selectedTicket.claimer ? (
                  <div className="flex items-center gap-3">
                    {renderAvatar(selectedTicket.claimer)}
                    <div className="min-w-0">
                      <div className="truncate font-display text-white font-700">{selectedTicket.claimer.username}</div>
                      <div className="text-sm text-white/40">{text.roles[selectedTicket.claimer.role] || selectedTicket.claimer.role}</div>
                    </div>
                  </div>
                ) : <div className="text-white/45">{text.nobody}</div>}
              </MetaCard>
            </div>
          )}

          {editingTicket && isPrimaryFounder && (
            <div className="mt-5 rounded-[24px] border border-violet-500/20 bg-violet-500/10 p-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.subject}</label>
                  <input value={editForm.title} onChange={(event) => setEditForm((state) => ({ ...state, title: event.target.value }))} className="input-field mt-2" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.reason}</label>
                  <select value={editForm.category} onChange={(event) => setEditForm((state) => ({ ...state, category: event.target.value }))} className="select-field mt-2">
                    {['bug', 'report', 'account', 'question', 'other'].map((category) => <option key={category} value={category}>{text.categories[category]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.status}</label>
                  <select value={editForm.status} onChange={(event) => setEditForm((state) => ({ ...state, status: event.target.value }))} className="select-field mt-2">
                    {['open', 'claimed', 'closed'].map((status) => <option key={status} value={status}>{text.statuses[status]}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={busyAction === 'edit'} onClick={() => runAction('edit', () => supportAPI.updateTicket(selectedTicket.id, editForm), text.updated, () => setEditingTicket(false))} className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-violet-500/15 px-4 py-3 text-violet-200 disabled:opacity-60">
                  <Shield className="h-4 w-4" />
                  {text.saveAction}
                </button>
                <button type="button" onClick={() => setEditingTicket(false)} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white/65 hover:bg-white/[0.07] hover:text-white">
                  {text.cancelAction}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5 scrollbar-none">
          {messages.map((message) => {
            if (message.kind === 'system') {
              return <div key={message.id} className="flex justify-center"><div className="rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">{message.body}</div></div>
            }
            const own = message.author?.id && message.author.id === user?.id
            const bubbleClass = own ? 'border-cyan-500/20 bg-cyan-500/10' : 'border-white/10 bg-white/[0.03]'
            return (
              <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[88%] rounded-[28px] border ${bubbleClass} px-4 py-4`}>
                  <div className="flex items-start gap-3">
                    {renderAvatar(message.author)}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-white font-700">{message.author?.username}</span>
                        <Pill className="border-white/10 bg-black/20 text-white/65">{text.roles[message.author?.role] || message.author?.role}</Pill>
                        <span className="text-[11px] font-mono text-white/30">{formatDate(locale, message.created_at)}</span>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap break-words text-white/85">{message.is_deleted ? text.deletedText : message.body}</div>
                    </div>
                    {selectedTicket.permissions?.can_delete_messages && !message.is_deleted && (
                      <button type="button" disabled={busyAction === `delete-message-${message.id}`} onClick={() => handleDeleteMessage(message.id)} className="text-white/30 hover:text-red-300 disabled:opacity-60">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="border-t border-white/[0.08] px-6 py-5">
          {selectedTicket.permissions?.can_reply ? (
            <form onSubmit={handleReply} className="space-y-3">
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} className="input-field min-h-[130px] resize-none" placeholder={text.replyPlaceholder} />
              <div className="flex justify-end">
                <button type="submit" disabled={sendingReply || !reply.trim()} className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-cyan-300 disabled:opacity-60">
                  <Send className="h-4 w-4" />
                  {text.sendReply}
                </button>
              </div>
            </form>
          ) : <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-white/50">{text.closedText}</div>}
        </div>
      </>
    )
  }

  return (
    <div className="relative min-h-full px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono ${
              isStaff ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' : 'border-violet-500/20 bg-violet-500/10 text-violet-200'
            }`}>
              <LifeBuoy className="h-3.5 w-3.5" />
              {isStaff ? text.adminTitle : text.title}
            </div>
            <h1 className="font-display text-3xl font-700 text-white md:text-4xl">{isStaff ? text.adminTitle : text.title}</h1>
            <p className="mt-2 max-w-2xl text-white/45">{isStaff ? text.adminSubtitle : text.userSubtitle}</p>
          </div>
          <button type="button" onClick={() => loadTickets(selectedTicketId)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white/80 hover:bg-white/[0.07]">
            <RefreshCw className={`h-4 w-4 ${loadingList ? 'animate-spin' : ''}`} />
            {text.refresh}
          </button>
        </div>

        {isStaff && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <CountCard icon={Ticket} label={text.total} value={counts.total || 0} tone="border-white/10 bg-white/[0.04] text-white/70" />
            <CountCard icon={Clock3} label={text.open} value={counts.open || 0} tone="border-cyan-500/20 bg-cyan-500/10 text-cyan-300" />
            <CountCard icon={UserRoundCheck} label={text.claimed} value={counts.claimed || 0} tone="border-amber-500/20 bg-amber-500/10 text-amber-300" />
            <CountCard icon={Shield} label={text.unclaimed} value={counts.unclaimed || 0} tone="border-violet-500/20 bg-violet-500/10 text-violet-300" />
            <CountCard icon={CheckCircle2} label={text.closed} value={counts.closed || 0} tone="border-emerald-500/20 bg-emerald-500/10 text-emerald-300" />
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-6">
            {!isStaff && (
              <form onSubmit={handleCreate} className="rounded-[30px] border border-white/[0.08] bg-white/[0.03] p-5">
                <div className="mb-5">
                  <h2 className="font-display text-xl font-700 text-white">{text.newTicket}</h2>
                  <p className="mt-1 text-sm text-white/45">{text.newTicketHint}</p>
                </div>
                <div className="grid gap-3">
                  {['bug', 'report', 'account', 'question', 'other'].map((category) => {
                    const meta = CATEGORY_META[category]
                    const Icon = meta.icon
                    const active = newTicket.category === category
                    return (
                      <button key={category} type="button" onClick={() => setNewTicket((state) => ({ ...state, category }))} className={`rounded-[24px] border p-4 text-left transition-all ${active ? meta.tone : 'border-white/10 bg-black/20 text-white/65 hover:bg-white/[0.04] hover:text-white'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${active ? meta.tone : 'border-white/10 bg-white/[0.04]'}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div>
                            <div className="font-display text-sm font-700">{text.categories[category]}</div>
                            <div className="mt-1 text-xs text-white/45">{text.categoryHelp[category]}</div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-5">
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.message}</label>
                  <textarea value={newTicket.message} onChange={(event) => setNewTicket((state) => ({ ...state, message: event.target.value }))} className="input-field mt-2 min-h-[190px] resize-none" placeholder={text.messagePlaceholder} />
                </div>
                <button type="submit" disabled={creatingTicket || !newTicket.message.trim()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-cyan-300 disabled:opacity-60">
                  <Send className="h-4 w-4" />
                  {text.sendTicket}
                </button>
              </form>
            )}

            <div className="rounded-[30px] border border-white/[0.08] bg-white/[0.03] p-5">
              <div className="mb-4">
                <h2 className="font-display text-xl font-700 text-white">{isStaff ? text.queue : text.title}</h2>
                <p className="mt-1 text-sm text-white/45">{isStaff ? text.queueHint : text.userSubtitle}</p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.status}</label>
                  <select value={filters.status} onChange={(event) => setFilters((state) => ({ ...state, status: event.target.value }))} className="select-field mt-2">
                    {['all', 'open', 'claimed', 'closed'].map((status) => <option key={status} value={status}>{text.statuses[status]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.reason}</label>
                  <select value={filters.category} onChange={(event) => setFilters((state) => ({ ...state, category: event.target.value }))} className="select-field mt-2">
                    {['all', 'bug', 'report', 'account', 'question', 'other'].map((category) => <option key={category} value={category}>{text.categories[category]}</option>)}
                  </select>
                </div>
                {isStaff && (
                  <div>
                    <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.claim}</label>
                    <select value={filters.claim} onChange={(event) => setFilters((state) => ({ ...state, claim: event.target.value }))} className="select-field mt-2">
                      {['all', 'mine', 'unclaimed'].map((claim) => <option key={claim} value={claim}>{text.claims[claim]}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs uppercase tracking-[0.24em] text-white/40">{text.search}</label>
                  <div className="relative mt-2">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                    <input value={filters.q} onChange={(event) => setFilters((state) => ({ ...state, q: event.target.value }))} className="input-field !pl-11" placeholder={text.searchPlaceholder} />
                  </div>
                </div>
              </div>

              <div className="mt-5 max-h-[760px] space-y-3 overflow-y-auto pr-1 scrollbar-none">
                {tickets.length === 0 && <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center text-white/45">{isStaff ? text.noQueue : text.noMine}</div>}
                {tickets.map((ticket) => (
                  <TicketItem key={ticket.id} ticket={ticket} selected={ticket.id === selectedTicketId} locale={locale} text={text} onSelect={setSelectedTicketId} />
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-h-[840px] flex-col overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.03]">
            {renderConversation()}
          </div>
        </div>
      </div>
    </div>
  )
}
