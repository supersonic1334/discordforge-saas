import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BadgeHelp,
  Bug,
  CheckCircle2,
  Clock3,
  LifeBuoy,
  Mail,
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

const AUTO_REFRESH_MS = 8000

const TEXT = {
  fr: {
    title: 'Support',
    titleUser: 'Besoin d aide ?',
    titleStaff: 'Support admin',
    userSubtitle: 'Tu laisses un message, le support te repond ici automatiquement.',
    staffSubtitle: 'Vue support claire: file, ticket, prise en charge et reponse en direct.',
    routeMissing: 'Le support backend n est pas charge. Redemarre le backend pour activer la route support.',
    newTicket: 'Nouvelle demande',
    newTicketHint: 'Choisis une raison, ecris ton message, puis envoie.',
    myTickets: 'Mes tickets',
    myTicketsHint: 'Tous tes echanges restent ici.',
    queue: 'Tickets en attente',
    queueHint: 'Selectionne un ticket pour le traiter.',
    conversation: 'Conversation',
    noTicketUser: 'Envoie un premier message pour ouvrir ton ticket.',
    noTicketStaff: 'Choisis un ticket dans la file support.',
    noMine: 'Aucun ticket pour le moment.',
    noQueue: 'Aucun ticket dans la file support.',
    message: 'Message',
    messagePlaceholder: 'Explique clairement le probleme, ce que tu faisais et ce qui bloque.',
    replyPlaceholder: 'Ecris ta reponse support...',
    sendTicket: 'Envoyer au support',
    sendReply: 'Envoyer',
    reason: 'Raison',
    status: 'Statut',
    claim: 'Prise en charge',
    claimedBy: 'Pris par',
    unclaimed: 'Sans claim',
    searchPlaceholder: 'Numero, pseudo, email ou texte',
    requester: 'Demandeur',
    contact: 'Contact',
    ticketInfo: 'Ticket',
    nobody: 'Personne pour le moment',
    opened: 'Ouvert',
    activity: 'Derniere activite',
    joined: 'Compte cree',
    lastLogin: 'Derniere connexion',
    closeAction: 'Fermer',
    reopenAction: 'Reouvrir',
    claimAction: 'Prendre',
    unclaimAction: 'Relacher',
    editAction: 'Modifier',
    cancelAction: 'Annuler',
    saveAction: 'Enregistrer',
    deleteTicket: 'Supprimer le ticket',
    deleteMessage: 'Supprimer le message',
    closedText: 'Ce ticket est ferme. Reouvre-le pour repondre.',
    created: 'Ticket envoye',
    replied: 'Reponse envoyee',
    claimedOk: 'Ticket pris en charge',
    unclaimedOk: 'Ticket relache',
    updated: 'Ticket mis a jour',
    statusOk: 'Statut mis a jour',
    deleted: 'Ticket supprime',
    messageDeleted: 'Message supprime',
    deletedText: 'Message retire par le fondateur principal.',
    confirmDeleteTicket: 'Supprimer definitivement ce ticket ?',
    confirmDeleteMessage: 'Supprimer ce message du ticket ?',
    previewReply: 'Reponse en cours',
    filters: {
      all: 'Tous',
      open: 'En attente',
      claimed: 'Pris',
      closed: 'Fermes',
      mine: 'Par moi',
      unclaimed: 'Sans claim',
    },
    categories: {
      all: 'Toutes',
      bug: 'Bug',
      report: 'Signalement',
      account: 'Compte',
      question: 'Question',
      other: 'Autre',
    },
    categoryHelp: {
      bug: 'Quelque chose bloque ou plante.',
      report: 'Tu signales un abus ou un probleme.',
      account: 'Connexion, profil ou acces.',
      question: 'Tu as besoin d aide.',
      other: 'Toute autre demande.',
    },
    roles: {
      member: 'Utilisateur',
      admin: 'Admin',
      founder: 'Fondateur',
      api_provider: 'Fournisseur API',
      system: 'Support',
    },
    counts: {
      open: 'En attente',
      claimed: 'Pris',
      closed: 'Fermes',
    },
    messages: 'messages',
    subject: 'Titre',
  },
  en: {
    title: 'Support',
    titleUser: 'Need help?',
    titleStaff: 'Admin support',
    userSubtitle: 'Leave a message and the team replies here automatically.',
    staffSubtitle: 'Clear support view: queue, ticket handling and live replies.',
    routeMissing: 'The support backend is not loaded. Restart the backend to enable support routes.',
    newTicket: 'New request',
    newTicketHint: 'Pick a reason, write your message, then send it.',
    myTickets: 'My tickets',
    myTicketsHint: 'All your conversations stay here.',
    queue: 'Support queue',
    queueHint: 'Select a ticket to handle it.',
    conversation: 'Conversation',
    noTicketUser: 'Send your first message to open a ticket.',
    noTicketStaff: 'Pick a ticket from the queue.',
    noMine: 'No tickets yet.',
    noQueue: 'No tickets in the support queue.',
    message: 'Message',
    messagePlaceholder: 'Explain clearly what happened and what is blocked.',
    replyPlaceholder: 'Write your support reply...',
    sendTicket: 'Send to support',
    sendReply: 'Send',
    reason: 'Reason',
    status: 'Status',
    claim: 'Handling',
    claimedBy: 'Claimed by',
    unclaimed: 'Unclaimed',
    searchPlaceholder: 'Number, username, email or text',
    requester: 'Requester',
    contact: 'Contact',
    ticketInfo: 'Ticket',
    nobody: 'Nobody yet',
    opened: 'Opened',
    activity: 'Last activity',
    joined: 'Account created',
    lastLogin: 'Last login',
    closeAction: 'Close',
    reopenAction: 'Reopen',
    claimAction: 'Take',
    unclaimAction: 'Release',
    editAction: 'Edit',
    cancelAction: 'Cancel',
    saveAction: 'Save',
    deleteTicket: 'Delete ticket',
    deleteMessage: 'Delete message',
    closedText: 'This ticket is closed. Reopen it to reply.',
    created: 'Ticket sent',
    replied: 'Reply sent',
    claimedOk: 'Ticket claimed',
    unclaimedOk: 'Ticket released',
    updated: 'Ticket updated',
    statusOk: 'Status updated',
    deleted: 'Ticket deleted',
    messageDeleted: 'Message deleted',
    deletedText: 'Message removed by the primary founder.',
    confirmDeleteTicket: 'Delete this ticket permanently?',
    confirmDeleteMessage: 'Delete this ticket message?',
    previewReply: 'Draft reply',
    filters: {
      all: 'All',
      open: 'Open',
      claimed: 'Claimed',
      closed: 'Closed',
      mine: 'Mine',
      unclaimed: 'Unclaimed',
    },
    categories: {
      all: 'All',
      bug: 'Bug',
      report: 'Report',
      account: 'Account',
      question: 'Question',
      other: 'Other',
    },
    categoryHelp: {
      bug: 'Something breaks or crashes.',
      report: 'You want to report abuse or an issue.',
      account: 'Login, profile or access.',
      question: 'You need help.',
      other: 'Any other request.',
    },
    roles: {
      member: 'User',
      admin: 'Admin',
      founder: 'Founder',
      api_provider: 'API provider',
      system: 'Support',
    },
    counts: {
      open: 'Open',
      claimed: 'Claimed',
      closed: 'Closed',
    },
    messages: 'messages',
    subject: 'Title',
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
  closed: 'border-white/10 bg-white/[0.05] text-white/65',
}

function getText(locale) {
  const key = String(locale || 'fr').toLowerCase().split('-')[0]
  return TEXT[key] || TEXT.fr
}

function formatDate(locale, value) {
  if (!value) return '--'
  try {
    return new Date(value).toLocaleString(locale)
  } catch {
    return value
  }
}

function formatTime(locale, value) {
  if (!value) return '--'
  try {
    return new Date(value).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  } catch {
    return value
  }
}

function getErrorMessage(error, text) {
  const message = error?.response?.data?.error || error?.message || 'Unexpected error'
  return String(message).includes('/api/v1/support/') ? text.routeMissing : message
}

function getIdentityTone(profile, currentUser) {
  const isPrimaryFounder = !!profile?.is_primary_founder || (!!profile?.id && profile.id === currentUser?.id && currentUser?.is_primary_founder)

  if (profile?.role === 'system') {
    return {
      avatarFrame: 'border-violet-400/25 bg-[linear-gradient(135deg,rgba(34,211,238,0.24),rgba(139,92,246,0.28))] shadow-[0_10px_32px_rgba(76,29,149,0.24)]',
      fallbackBg: 'from-cyan-500/28 to-violet-500/28',
      bubble: 'border-violet-400/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.08),rgba(139,92,246,0.14))] shadow-[0_16px_34px_rgba(76,29,149,0.18)]',
      name: 'text-cyan-100',
      dot: 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.75)]',
    }
  }

  if (isPrimaryFounder) {
    return {
      avatarFrame: 'border-amber-300/35 bg-[linear-gradient(135deg,rgba(251,191,36,0.34),rgba(245,158,11,0.22))] shadow-[0_12px_36px_rgba(245,158,11,0.24)]',
      fallbackBg: 'from-amber-300/32 via-yellow-300/20 to-orange-400/24',
      bubble: 'border-amber-300/24 bg-[linear-gradient(135deg,rgba(251,191,36,0.12),rgba(245,158,11,0.08),rgba(255,255,255,0.03))] shadow-[0_18px_40px_rgba(245,158,11,0.18)]',
      name: 'text-amber-100',
      dot: 'bg-amber-300 shadow-[0_0_12px_rgba(252,211,77,0.75)]',
    }
  }

  if (profile?.role === 'founder') {
    return {
      avatarFrame: 'border-violet-400/26 bg-[linear-gradient(135deg,rgba(34,211,238,0.18),rgba(139,92,246,0.3))] shadow-[0_12px_32px_rgba(91,33,182,0.22)]',
      fallbackBg: 'from-cyan-400/22 to-violet-500/28',
      bubble: 'border-violet-400/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.06),rgba(139,92,246,0.14))] shadow-[0_16px_34px_rgba(91,33,182,0.16)]',
      name: 'text-violet-100',
      dot: 'bg-violet-300 shadow-[0_0_10px_rgba(196,181,253,0.7)]',
    }
  }

  if (profile?.role === 'admin') {
    return {
      avatarFrame: 'border-cyan-400/26 bg-[linear-gradient(135deg,rgba(34,211,238,0.26),rgba(14,165,233,0.18))] shadow-[0_12px_30px_rgba(34,211,238,0.2)]',
      fallbackBg: 'from-cyan-400/28 to-sky-500/22',
      bubble: 'border-cyan-400/18 bg-[linear-gradient(135deg,rgba(34,211,238,0.1),rgba(14,165,233,0.08),rgba(255,255,255,0.03))] shadow-[0_16px_34px_rgba(34,211,238,0.14)]',
      name: 'text-cyan-100',
      dot: 'bg-cyan-300 shadow-[0_0_10px_rgba(103,232,249,0.72)]',
    }
  }

  if (profile?.role === 'api_provider') {
    return {
      avatarFrame: 'border-emerald-400/26 bg-[linear-gradient(135deg,rgba(16,185,129,0.24),rgba(45,212,191,0.16))] shadow-[0_12px_30px_rgba(16,185,129,0.18)]',
      fallbackBg: 'from-emerald-400/26 to-teal-400/22',
      bubble: 'border-emerald-400/16 bg-[linear-gradient(135deg,rgba(16,185,129,0.08),rgba(45,212,191,0.06),rgba(255,255,255,0.03))] shadow-[0_16px_34px_rgba(16,185,129,0.12)]',
      name: 'text-emerald-100',
      dot: 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.68)]',
    }
  }

  return {
    avatarFrame: 'border-white/12 bg-[linear-gradient(135deg,rgba(59,130,246,0.12),rgba(255,255,255,0.06))] shadow-[0_10px_26px_rgba(15,23,42,0.28)]',
    fallbackBg: 'from-slate-400/22 to-blue-400/18',
    bubble: 'border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.04),rgba(59,130,246,0.04))] shadow-[0_16px_32px_rgba(15,23,42,0.22)]',
    name: 'text-white',
    dot: 'bg-white/45',
  }
}

function renderAvatar(profile, currentUser, size = 'h-11 w-11') {
  const tone = getIdentityTone(profile, currentUser)

  if (profile?.avatar_url) {
    return (
      <div className={`${size} shrink-0 aspect-square overflow-hidden rounded-2xl border p-[1px] ${tone.avatarFrame}`}>
        <img src={profile.avatar_url} alt={profile?.username || 'User'} className="block h-full w-full rounded-[1rem] object-cover object-center" />
      </div>
    )
  }

  const initials = String(profile?.username || '?').slice(0, 2).toUpperCase()
  return (
    <div className={`${size} shrink-0 aspect-square overflow-hidden rounded-2xl border p-[1px] ${tone.avatarFrame}`}>
      <div className={`flex h-full w-full items-center justify-center rounded-[1rem] bg-gradient-to-br ${tone.fallbackBg} font-mono text-xs text-white/90`}>
        {initials}
      </div>
    </div>
  )
}

function Pill({ children, className = '' }) {
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-mono ${className}`}>{children}</span>
}

function SegmentedButton({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-mono transition-all ${
        active ? 'border-cyan-500/25 bg-cyan-500/12 text-cyan-300' : 'border-white/10 bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

function StatCard({ label, value, tone }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className={`mb-2 inline-flex rounded-full border px-2 py-1 text-[10px] font-mono ${tone}`}>{label}</div>
      <div className="font-display text-2xl font-700 text-white">{value}</div>
    </div>
  )
}

function TicketRow({ ticket, locale, text, selected, onSelect, isStaff, currentUser }) {
  const meta = CATEGORY_META[ticket.category] || CATEGORY_META.other
  const Icon = meta.icon

  return (
    <button
      type="button"
      onClick={() => onSelect(ticket.id)}
      className={`w-full rounded-[24px] border p-4 text-left transition-all ${
        selected ? 'border-cyan-500/25 bg-cyan-500/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]' : 'border-white/10 bg-black/20 hover:border-white/15 hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-start gap-3">
        {renderAvatar(ticket.owner, currentUser)}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pill className="border-white/10 bg-white/[0.04] text-white/80">#{ticket.ticket_number}</Pill>
            <Pill className={STATUS_STYLES[ticket.status]}>{text.filters[ticket.status]}</Pill>
            <Pill className={meta.tone}>
              <Icon className="mr-1.5 h-3 w-3" />
              {text.categories[ticket.category]}
            </Pill>
          </div>
          <div className="mt-3 truncate font-display text-base font-700 text-white">{ticket.title}</div>
          <div className="mt-1 line-clamp-2 text-sm text-white/42">{ticket.last_message_preview || '...'}</div>
          <div className="mt-3 flex flex-wrap gap-3 text-[11px] font-mono text-white/30">
            <span>{ticket.owner?.username}</span>
            <span>{ticket.message_count} {text.messages}</span>
            <span>{formatDate(locale, ticket.last_message_at)}</span>
          </div>
          {isStaff && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span className="text-white/28">{text.claimedBy}</span>
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-white/72">
                {ticket.claimer?.username || text.unclaimed}
              </span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function MetaPanel({ title, children }) {
  return (
    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
      <div className="mb-3 text-[11px] uppercase tracking-[0.24em] text-white/32">{title}</div>
      {children}
    </div>
  )
}

function EmptyState({ icon: Icon, title, body }) {
  return (
    <div className="flex min-h-[360px] items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[28px] border border-white/10 bg-white/[0.04] text-white/60">
          <Icon className="h-8 w-8" />
        </div>
        <div className="font-display text-2xl font-700 text-white">{title}</div>
        <p className="mt-3 text-white/45">{body}</p>
      </div>
    </div>
  )
}

export default function SupportPage() {
  const { locale } = useI18n()
  const text = getText(locale)
  const { user } = useAuthStore()
  const isStaff = ['admin', 'founder'].includes(user?.role) || !!user?.is_primary_founder
  const isPrimaryFounder = !!user?.is_primary_founder

  const [tickets, setTickets] = useState([])
  const [counts, setCounts] = useState({ total: 0, open: 0, claimed: 0, closed: 0, unclaimed: 0 })
  const [selectedTicketId, setSelectedTicketId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [reply, setReply] = useState('')
  const [newTicket, setNewTicket] = useState({ category: 'bug', message: '' })
  const [editForm, setEditForm] = useState({ title: '', category: 'bug', status: 'open' })
  const [filters, setFilters] = useState({ status: 'all', claim: 'all', category: 'all', q: '' })
  const [loadingList, setLoadingList] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [creatingTicket, setCreatingTicket] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [editingTicket, setEditingTicket] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const selectedRef = useRef(null)
  const queryRef = useRef(null)
  const messagesRef = useRef(null)

  const query = useMemo(() => ({
    view: isStaff ? 'staff' : 'mine',
    status: filters.status,
    category: isStaff ? filters.category : 'all',
    claim: isStaff ? filters.claim : 'all',
    q: isStaff ? filters.q : '',
    page: 1,
    limit: 50,
  }), [filters.category, filters.claim, filters.q, filters.status, isStaff])

  useEffect(() => {
    selectedRef.current = selectedTicketId
  }, [selectedTicketId])

  useEffect(() => {
    queryRef.current = query
  }, [query])

  useEffect(() => {
    loadTickets({ preferredId: selectedRef.current })
  }, [query])

  useEffect(() => {
    if (!selectedTicketId) {
      setDetail(null)
      return
    }
    loadDetail(selectedTicketId)
  }, [selectedTicketId])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.hidden) return
      const currentSelected = selectedRef.current
      loadTickets({ preferredId: currentSelected, silent: true })
      if (currentSelected) {
        loadDetail(currentSelected, { silent: true })
      }
    }, AUTO_REFRESH_MS)

    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!messagesRef.current) return
    messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [detail?.ticket?.id, detail?.messages?.length])

  const notifyError = (error, id = 'support-error') => {
    toast.error(getErrorMessage(error, text), { id })
  }

  async function loadTickets(options = {}) {
    const { preferredId = null, silent = false } = options
    if (!silent) setLoadingList(true)

    try {
      const response = await supportAPI.listTickets(queryRef.current || query)
      const nextTickets = response.data.tickets || []
      const nextCounts = response.data.counts || { total: 0, open: 0, claimed: 0, closed: 0, unclaimed: 0 }
      const targetId = preferredId || selectedRef.current

      setTickets(nextTickets)
      setCounts(nextCounts)

      if (targetId && nextTickets.some((ticket) => ticket.id === targetId)) {
        setSelectedTicketId(targetId)
      } else {
        const nextSelected = nextTickets[0]?.id || null
        setSelectedTicketId(nextSelected)
        if (!nextSelected) setDetail(null)
      }
    } catch (error) {
      if (!silent) notifyError(error, 'support-load')
    } finally {
      if (!silent) setLoadingList(false)
    }
  }

  async function loadDetail(ticketId, options = {}) {
    const { silent = false } = options
    if (!silent) setLoadingDetail(true)

    try {
      const response = await supportAPI.getTicket(ticketId)
      setDetail(response.data)
      setEditForm({
        title: response.data.ticket?.title || '',
        category: response.data.ticket?.category || 'bug',
        status: response.data.ticket?.status || 'open',
      })
    } catch (error) {
      if (!silent) {
        setDetail(null)
        notifyError(error, 'support-detail')
      }
    } finally {
      if (!silent) setLoadingDetail(false)
    }
  }

  async function handleCreate(event) {
    event.preventDefault()
    if (!newTicket.message.trim()) return

    setCreatingTicket(true)
    try {
      const response = await supportAPI.createTicket(newTicket)
      setNewTicket((state) => ({ ...state, message: '' }))
      setSelectedTicketId(response.data.ticket?.id || null)
      setDetail({ ticket: response.data.ticket, messages: response.data.messages })
      toast.success(text.created)
      await loadTickets({ preferredId: response.data.ticket?.id || null })
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
      await loadTickets({ preferredId: selectedTicketId })
    } catch (error) {
      notifyError(error, 'support-reply')
    } finally {
      setSendingReply(false)
    }
  }

  async function runAction(key, request, successMessage, after) {
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
      if (after) after(response)
      await loadTickets({ preferredId: selectedTicketId })
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
      await loadTickets({ preferredId: selectedTicketId })
    } catch (error) {
      notifyError(error, `support-delete-message-${messageId}`)
    } finally {
      setBusyAction('')
    }
  }

  const selectedTicket = detail?.ticket || null
  const messages = detail?.messages || []

  const renderActions = () => {
    if (!selectedTicket) return null

    return (
      <div className="flex flex-wrap gap-2">
        {selectedTicket.permissions?.can_claim && !selectedTicket.claimer?.id && (
          <button
            type="button"
            disabled={busyAction === 'claim'}
            onClick={() => runAction('claim', () => supportAPI.claimTicket(selectedTicket.id), text.claimedOk)}
            className="inline-flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-amber-300 disabled:opacity-60"
          >
            <UserRoundPlus className="h-4 w-4" />
            {text.claimAction}
          </button>
        )}

        {selectedTicket.permissions?.can_unclaim && selectedTicket.claimer?.id && (
          <button
            type="button"
            disabled={busyAction === 'unclaim'}
            onClick={() => runAction('unclaim', () => supportAPI.unclaimTicket(selectedTicket.id), text.unclaimedOk)}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-white/75 disabled:opacity-60"
          >
            <UserRoundCheck className="h-4 w-4" />
            {text.unclaimAction}
          </button>
        )}

        {selectedTicket.permissions?.can_close && (
          <button
            type="button"
            disabled={busyAction === 'close'}
            onClick={() => runAction('close', () => supportAPI.setStatus(selectedTicket.id, { status: 'closed' }), text.statusOk)}
            className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-300 disabled:opacity-60"
          >
            <XCircle className="h-4 w-4" />
            {text.closeAction}
          </button>
        )}

        {selectedTicket.permissions?.can_reopen && (
          <button
            type="button"
            disabled={busyAction === 'reopen'}
            onClick={() => runAction('reopen', () => supportAPI.setStatus(selectedTicket.id, { status: 'open' }), text.statusOk)}
            className="inline-flex items-center gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-emerald-300 disabled:opacity-60"
          >
            <CheckCircle2 className="h-4 w-4" />
            {text.reopenAction}
          </button>
        )}

        {selectedTicket.permissions?.can_edit && (
          <button
            type="button"
            onClick={() => setEditingTicket((state) => !state)}
            className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-violet-500/10 px-3 py-2 text-violet-300"
          >
            <Shield className="h-4 w-4" />
            {editingTicket ? text.cancelAction : text.editAction}
          </button>
        )}

        {selectedTicket.permissions?.can_delete && (
          <button
            type="button"
            disabled={busyAction === 'delete-ticket'}
            onClick={handleDeleteTicket}
            className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-red-300 disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" />
            {text.deleteTicket}
          </button>
        )}
      </div>
    )
  }

  const renderConversation = () => {
    if (!selectedTicket) {
      return (
        <EmptyState
          icon={Ticket}
          title={text.conversation}
          body={isStaff ? text.noTicketStaff : text.noTicketUser}
        />
      )
    }

    return (
      <>
        <div className="border-b border-white/[0.08] px-6 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Pill className="border-white/10 bg-white/[0.04] text-white/80">#{selectedTicket.ticket_number}</Pill>
                <Pill className={STATUS_STYLES[selectedTicket.status]}>{text.filters[selectedTicket.status]}</Pill>
                <Pill className={CATEGORY_META[selectedTicket.category]?.tone || CATEGORY_META.other.tone}>{text.categories[selectedTicket.category]}</Pill>
              </div>
              <h2 className="mt-3 font-display text-2xl font-700 text-white">{selectedTicket.title}</h2>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-white/42">
                <span>{text.opened}: {formatDate(locale, selectedTicket.created_at)}</span>
                <span>{text.activity}: {formatDate(locale, selectedTicket.last_message_at)}</span>
              </div>
            </div>

            {renderActions()}
          </div>

          <div className={`mt-5 grid gap-3 ${isStaff ? 'xl:grid-cols-4' : ''}`}>
            <MetaPanel title={text.ticketInfo}>
              <div className="space-y-2 text-sm text-white/75">
                <div>{text.reason}: <span className="text-white">{text.categories[selectedTicket.category]}</span></div>
                <div>{text.status}: <span className="text-white">{text.filters[selectedTicket.status]}</span></div>
                <div>{text.activity}: <span className="text-white">{formatTime(locale, selectedTicket.last_message_at)}</span></div>
                {isStaff && (
                  <div>{text.claimedBy}: <span className="text-white">{selectedTicket.claimer?.username || text.unclaimed}</span></div>
                )}
              </div>
            </MetaPanel>

            {isStaff ? (
              <>
                <MetaPanel title={text.requester}>
                  <div className="flex items-center gap-3">
                    {renderAvatar(selectedTicket.owner, user)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full ${getIdentityTone(selectedTicket.owner, user).dot}`} />
                        <div className={`truncate font-display font-700 ${getIdentityTone(selectedTicket.owner, user).name}`}>{selectedTicket.owner?.username}</div>
                      </div>
                      <div className="mt-1 text-xs text-white/30">ID: {selectedTicket.owner?.id || '--'}</div>
                    </div>
                  </div>
                </MetaPanel>

                <MetaPanel title={text.claim}>
                  {selectedTicket.claimer ? (
                    <div className="flex items-center gap-3">
                      {renderAvatar(selectedTicket.claimer, user)}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className={`h-1.5 w-1.5 rounded-full ${getIdentityTone(selectedTicket.claimer, user).dot}`} />
                          <div className={`truncate font-display font-700 ${getIdentityTone(selectedTicket.claimer, user).name}`}>{selectedTicket.claimer.username}</div>
                        </div>
                        <div className="mt-1 text-xs text-white/30">ID: {selectedTicket.claimer.id || '--'}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-white/45">{text.unclaimed}</div>
                  )}
                </MetaPanel>

                <MetaPanel title={text.contact}>
                  <div className="space-y-2 text-sm text-white/75">
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4 text-cyan-300" />
                      <span className="break-all">{selectedTicket.owner?.email || '--'}</span>
                    </div>
                    <div className="text-white/45">{text.joined}: {formatDate(locale, selectedTicket.owner?.joined_at)}</div>
                    <div className="text-white/45">{text.lastLogin}: {formatDate(locale, selectedTicket.owner?.last_login_at)}</div>
                  </div>
                </MetaPanel>
              </>
            ) : null}
          </div>

          {editingTicket && isPrimaryFounder && (
            <div className="mt-5 rounded-[24px] border border-violet-500/20 bg-violet-500/10 p-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-[11px] uppercase tracking-[0.24em] text-white/35">{text.subject}</label>
                  <input
                    value={editForm.title}
                    onChange={(event) => setEditForm((state) => ({ ...state, title: event.target.value }))}
                    className="input-field mt-2"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-[0.24em] text-white/35">{text.reason}</label>
                  <select
                    value={editForm.category}
                    onChange={(event) => setEditForm((state) => ({ ...state, category: event.target.value }))}
                    className="select-field mt-2"
                  >
                    {['bug', 'report', 'account', 'question', 'other'].map((category) => (
                      <option key={category} value={category}>{text.categories[category]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-[0.24em] text-white/35">{text.status}</label>
                  <select
                    value={editForm.status}
                    onChange={(event) => setEditForm((state) => ({ ...state, status: event.target.value }))}
                    className="select-field mt-2"
                  >
                    {['open', 'claimed', 'closed'].map((status) => (
                      <option key={status} value={status}>{text.filters[status]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyAction === 'edit'}
                  onClick={() => runAction('edit', () => supportAPI.updateTicket(selectedTicket.id, editForm), text.updated, () => setEditingTicket(false))}
                  className="inline-flex items-center gap-2 rounded-2xl border border-violet-500/20 bg-violet-500/15 px-4 py-3 text-violet-200 disabled:opacity-60"
                >
                  <Shield className="h-4 w-4" />
                  {text.saveAction}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingTicket(false)}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-white/65 hover:bg-white/[0.07] hover:text-white"
                >
                  {text.cancelAction}
                </button>
              </div>
            </div>
          )}
        </div>

        <div ref={messagesRef} className="flex-1 space-y-4 overflow-y-auto px-6 py-5 scrollbar-none">
          {messages.map((message) => {
            if (message.kind === 'system') {
              const normalizedBody = String(message.body || '').toLowerCase()
              if (
                normalizedBody.includes('ticket reclame par')
                || normalizedBody.includes('ticket relache par')
                || normalizedBody.includes('ticket claimed by')
                || normalizedBody.includes('ticket released by')
              ) {
                return null
              }

              return (
                <div key={message.id} className="flex justify-center">
                  <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs text-white/55">
                    {message.body}
                  </div>
                </div>
              )
            }

            const own = message.author?.id && message.author.id === user?.id
            const tone = getIdentityTone(message.author, user)
            const bubbleClass = own
              ? `${tone.bubble} ring-1 ring-white/[0.04]`
              : tone.bubble

            return (
              <div key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] rounded-[28px] border ${bubbleClass} px-4 py-4 backdrop-blur-[2px]`}>
                  <div className="flex items-start gap-3">
                    {renderAvatar(message.author, user, 'h-10 w-10')}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
                        <span className={`font-display font-700 ${tone.name}`}>{message.author?.username}</span>
                        <span className="text-[11px] font-mono text-white/30">{formatDate(locale, message.created_at)}</span>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap break-words text-white/88">{message.is_deleted ? text.deletedText : message.body}</div>
                    </div>

                    {selectedTicket.permissions?.can_delete_messages && !message.is_deleted && (
                      <button
                        type="button"
                        disabled={busyAction === `delete-message-${message.id}`}
                        onClick={() => handleDeleteMessage(message.id)}
                        className="text-white/30 hover:text-red-300 disabled:opacity-60"
                      >
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
              <div className="rounded-[24px] border border-white/10 bg-black/20 p-3">
                <textarea
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  className="input-field min-h-[120px] resize-none"
                  placeholder={text.replyPlaceholder}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white/35">{reply.trim() ? text.previewReply : ''}</div>
                <button
                  type="submit"
                  disabled={sendingReply || !reply.trim()}
                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-cyan-300 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {text.sendReply}
                </button>
              </div>
            </form>
          ) : (
            <div className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4 text-white/50">{text.closedText}</div>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="relative min-h-full px-4 py-8 md:px-8 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="feature-hero p-6 sm:p-7">
          <div className="relative z-[1] flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className={`mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono ${
              isStaff ? 'border-cyan-500/20 bg-cyan-500/10 text-cyan-300' : 'border-violet-500/20 bg-violet-500/10 text-violet-200'
              }`}>
                <LifeBuoy className="h-3.5 w-3.5" />
                {isStaff ? text.titleStaff : text.title}
              </div>
              <h1 className="font-display text-3xl font-700 text-white md:text-4xl">{isStaff ? text.titleStaff : text.titleUser}</h1>
              <p className="mt-2 max-w-3xl text-white/45">{isStaff ? text.staffSubtitle : text.userSubtitle}</p>
            </div>

            {isStaff && (
              <div className="flex flex-wrap gap-3">
                <StatCard label={text.counts.open} value={counts.open || 0} tone="border-cyan-500/20 bg-cyan-500/10 text-cyan-300" />
                <StatCard label={text.counts.claimed} value={counts.claimed || 0} tone="border-amber-500/20 bg-amber-500/10 text-amber-300" />
                <StatCard label={text.counts.closed} value={counts.closed || 0} tone="border-white/10 bg-white/[0.04] text-white/70" />
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-6">
            {!isStaff && (
              <form onSubmit={handleCreate} className="depth-panel rounded-[30px] border border-white/[0.08] bg-white/[0.03] p-5">
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
                      <button
                        key={category}
                        type="button"
                        onClick={() => setNewTicket((state) => ({ ...state, category }))}
                        className={`rounded-[22px] border p-4 text-left transition-all ${
                          active ? meta.tone : 'border-white/10 bg-black/20 text-white/70 hover:bg-white/[0.04] hover:text-white'
                        }`}
                      >
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
                  <label className="text-[11px] uppercase tracking-[0.24em] text-white/35">{text.message}</label>
                  <textarea
                    value={newTicket.message}
                    onChange={(event) => setNewTicket((state) => ({ ...state, message: event.target.value }))}
                    className="input-field mt-2 min-h-[180px] resize-none"
                    placeholder={text.messagePlaceholder}
                  />
                </div>

                <button
                  type="submit"
                  disabled={creatingTicket || !newTicket.message.trim()}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-cyan-300 disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  {text.sendTicket}
                </button>
              </form>
            )}

            <div className="depth-panel rounded-[30px] border border-white/[0.08] bg-white/[0.03] p-5">
              <div className="mb-4">
                <h2 className="font-display text-xl font-700 text-white">{isStaff ? text.queue : text.myTickets}</h2>
                <p className="mt-1 text-sm text-white/45">{isStaff ? text.queueHint : text.myTicketsHint}</p>
              </div>

              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {['all', 'open', 'claimed', 'closed'].map((status) => (
                    <SegmentedButton
                      key={status}
                      active={filters.status === status}
                      onClick={() => setFilters((state) => ({ ...state, status }))}
                    >
                      {text.filters[status]}
                    </SegmentedButton>
                  ))}
                </div>

                {isStaff && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {['all', 'mine', 'unclaimed'].map((claim) => (
                        <SegmentedButton
                          key={claim}
                          active={filters.claim === claim}
                          onClick={() => setFilters((state) => ({ ...state, claim }))}
                        >
                          {text.filters[claim]}
                        </SegmentedButton>
                      ))}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
                        <input
                          value={filters.q}
                          onChange={(event) => setFilters((state) => ({ ...state, q: event.target.value }))}
                          className="input-field !pl-11"
                          placeholder={text.searchPlaceholder}
                        />
                      </div>
                      <select
                        value={filters.category}
                        onChange={(event) => setFilters((state) => ({ ...state, category: event.target.value }))}
                        className="select-field"
                      >
                        {['all', 'bug', 'report', 'account', 'question', 'other'].map((category) => (
                          <option key={category} value={category}>{text.categories[category]}</option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
              </div>

              <div className="mt-5 max-h-[760px] space-y-3 overflow-y-auto pr-1 scrollbar-none">
                {tickets.length === 0 && (
                  <div className="rounded-[24px] border border-dashed border-white/10 bg-black/20 px-4 py-10 text-center text-white/45">
                    {isStaff ? text.noQueue : text.noMine}
                  </div>
                )}

                {tickets.map((ticket) => (
                  <TicketRow
                    key={ticket.id}
                    ticket={ticket}
                    locale={locale}
                    text={text}
                    selected={ticket.id === selectedTicketId}
                    onSelect={setSelectedTicketId}
                    isStaff={isStaff}
                    currentUser={user}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="depth-panel flex min-h-[860px] flex-col overflow-hidden rounded-[32px] border border-white/[0.08] bg-white/[0.03]">
            {renderConversation()}
          </div>
        </div>
      </div>
    </div>
  )
}
