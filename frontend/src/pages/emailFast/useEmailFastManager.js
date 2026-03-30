import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  API,
  DEFAULT_DRAFT,
  MAX_MAILBOXES,
  copyText,
  ensureQRCodeScript,
  getDurationConfig,
  randomString,
  stripHtml,
} from './model'

function buildMailbox(accountPayload, token, draft, index) {
  const duration = getDurationConfig(draft.durationKey, draft.customDurationMinutes)
  return {
    id: `mailbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    accountId: accountPayload.id,
    address: accountPayload.address,
    password: accountPayload.password,
    token,
    label: `Boite ${index + 1}`,
    messages: [],
    deletedIds: [],
    createdAt: Date.now(),
    durationKey: draft.durationKey,
    customDurationMinutes: draft.durationKey === 'custom' ? Number(draft.customDurationMinutes) : null,
    pollIntervalMs: Number(draft.pollIntervalMs) || 6000,
    expiresAt: duration.isPermanent ? null : Date.now() + duration.totalMs,
    totalDurationMs: duration.isPermanent ? null : duration.totalMs,
    isExpired: false,
    lastSyncAt: null,
    nextPollAt: Date.now(),
  }
}

export function useEmailFastManager() {
  const [screen, setScreen] = useState('auth')
  const [authMode, setAuthMode] = useState('create')
  const [createPassword, setCreatePassword] = useState('')
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState('')
  const [accessPassword, setAccessPassword] = useState('')
  const [showCreatePassword, setShowCreatePassword] = useState(false)
  const [showCreatePasswordConfirm, setShowCreatePasswordConfirm] = useState(false)
  const [showAccessPassword, setShowAccessPassword] = useState(false)
  const [authError, setAuthError] = useState('')
  const [sessionPassword, setSessionPassword] = useState(null)
  const [failedAttempts, setFailedAttempts] = useState(0)
  const [lockoutUntil, setLockoutUntil] = useState(null)
  const [mailboxes, setMailboxes] = useState([])
  const [activeMailboxId, setActiveMailboxId] = useState(null)
  const [createDraft, setCreateDraft] = useState(DEFAULT_DRAFT)
  const [runtimeDraft, setRuntimeDraft] = useState(DEFAULT_DRAFT)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterMode, setFilterMode] = useState('all')
  const [selectedMessageId, setSelectedMessageId] = useState(null)
  const [modalTab, setModalTab] = useState('text')
  const [qrOpen, setQrOpen] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [timeTick, setTimeTick] = useState(() => Date.now())
  const [qrReady, setQrReady] = useState(false)

  const mailboxesRef = useRef(mailboxes)
  const activeMailboxIdRef = useRef(activeMailboxId)
  const inFlightRef = useRef(new Set())

  const activeMailbox = useMemo(
    () => mailboxes.find((mailbox) => mailbox.id === activeMailboxId) || null,
    [mailboxes, activeMailboxId]
  )

  const selectedMessage = useMemo(
    () => activeMailbox?.messages?.find((message) => message.id === selectedMessageId) || null,
    [activeMailbox?.messages, selectedMessageId]
  )

  const visibleMessages = useMemo(() => {
    const source = activeMailbox?.messages || []
    const query = searchQuery.trim().toLowerCase()

    return source.filter((message) => {
      if (filterMode === 'unread' && message.read) return false
      if (filterMode === 'starred' && !message.starred) return false
      if (!query) return true

      return [
        message.from,
        message.subject,
        message.bodyText,
        stripHtml(message.bodyHtml),
      ]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(query))
    })
  }, [activeMailbox?.messages, filterMode, searchQuery])

  const unreadCount = useMemo(
    () => (activeMailbox?.messages || []).filter((message) => !message.read).length,
    [activeMailbox?.messages]
  )

  const starredCount = useMemo(
    () => (activeMailbox?.messages || []).filter((message) => message.starred).length,
    [activeMailbox?.messages]
  )

  const lockoutSecondsLeft = useMemo(() => {
    if (!lockoutUntil) return 0
    return Math.max(0, Math.ceil((lockoutUntil - timeTick) / 1000))
  }, [lockoutUntil, timeTick])

  const remainingMs = useMemo(() => {
    if (!activeMailbox?.expiresAt || activeMailbox?.isExpired) return 0
    return Math.max(0, activeMailbox.expiresAt - timeTick)
  }, [activeMailbox?.expiresAt, activeMailbox?.isExpired, timeTick])

  const progressPercent = useMemo(() => {
    if (!activeMailbox?.expiresAt || !activeMailbox?.totalDurationMs) return 100
    if (activeMailbox.isExpired) return 0
    const ratio = remainingMs / activeMailbox.totalDurationMs
    return Math.max(0, Math.min(100, ratio * 100))
  }, [activeMailbox?.expiresAt, activeMailbox?.isExpired, activeMailbox?.totalDurationMs, remainingMs])

  useEffect(() => {
    mailboxesRef.current = mailboxes
  }, [mailboxes])

  useEffect(() => {
    activeMailboxIdRef.current = activeMailboxId
  }, [activeMailboxId])

  useEffect(() => {
    const previousTitle = document.title
    document.title = 'Email Fast - DiscordForger'

    ensureQRCodeScript()
      .then(() => setQrReady(true))
      .catch((error) => {
        console.error(error)
        toast.error('QRCode.js indisponible pour le moment.')
      })

    return () => {
      document.title = previousTitle
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    const intervalId = window.setInterval(() => setTimeTick(Date.now()), 1000)
    return () => window.clearInterval(intervalId)
  }, [])

  useEffect(() => {
    if (!lockoutUntil || lockoutSecondsLeft > 0) return
    setLockoutUntil(null)
    setFailedAttempts(0)
  }, [lockoutSecondsLeft, lockoutUntil])

  useEffect(() => {
    if (activeMailbox) {
      setRuntimeDraft({
        durationKey: activeMailbox.durationKey,
        customDurationMinutes: String(activeMailbox.customDurationMinutes || 180),
        pollIntervalMs: activeMailbox.pollIntervalMs,
      })
      return
    }

    setRuntimeDraft(DEFAULT_DRAFT)
  }, [activeMailbox?.id])

  useEffect(() => {
    if (!mailboxes.length) {
      if (screen === 'app') {
        setScreen('auth')
        setAuthMode('create')
      }
      setActiveMailboxId(null)
      return
    }

    if (!activeMailboxId || !mailboxes.some((mailbox) => mailbox.id === activeMailboxId)) {
      setActiveMailboxId(mailboxes[0].id)
    }
  }, [mailboxes, activeMailboxId, screen])

  useEffect(() => {
    const expiredAddresses = []

    setMailboxes((current) => current.map((mailbox) => {
      if (!mailbox.expiresAt || mailbox.isExpired || mailbox.expiresAt > timeTick) {
        return mailbox
      }

      expiredAddresses.push(mailbox.address)
      return {
        ...mailbox,
        isExpired: true,
        nextPollAt: null,
      }
    }))

    if (expiredAddresses.length) {
      if (activeMailboxIdRef.current && expiredAddresses.includes(mailboxesRef.current.find((mailbox) => mailbox.id === activeMailboxIdRef.current)?.address)) {
        setSyncError('La duree de cette boite est terminee. Passe en permanent ou relance une adresse.')
      }
      expiredAddresses.forEach((address) => {
        toast.error(`Boite expiree: ${address}`)
      })
    }
  }, [timeTick])

  useEffect(() => {
    if (screen !== 'app' || !mailboxes.length) return undefined

    const intervalId = window.setInterval(() => {
      const snapshot = mailboxesRef.current
      const now = Date.now()

      snapshot.forEach((mailbox) => {
        if (!mailbox.token || mailbox.isExpired) return
        if ((mailbox.nextPollAt || 0) > now) return
        void fetchMailboxMessages(mailbox.id, { silent: true })
      })
    }, 3000)

    return () => window.clearInterval(intervalId)
  }, [screen, mailboxes.length])

  async function fetchMailboxMessages(mailboxId, { silent = false } = {}) {
    const mailbox = mailboxesRef.current.find((entry) => entry.id === mailboxId)
    if (!mailbox || !mailbox.token || mailbox.isExpired || inFlightRef.current.has(mailboxId)) return

    inFlightRef.current.add(mailboxId)
    if (!silent && activeMailboxIdRef.current === mailboxId) {
      setIsRefreshing(true)
    }

    try {
      const response = await fetch(`${API}/messages`, {
        headers: { Authorization: `Bearer ${mailbox.token}` },
      })

      if (!response.ok) {
        throw new Error('Lecture de la boite impossible.')
      }

      const payload = await response.json()
      const rawMessages = Array.isArray(payload?.['hydra:member']) ? payload['hydra:member'] : []
      const currentMap = new Map(mailbox.messages.map((message) => [message.id, message]))
      const deletedIds = new Set(mailbox.deletedIds || [])
      const visibleRawMessages = rawMessages.filter((message) => !deletedIds.has(message.id))
      const missingIds = visibleRawMessages
        .map((message) => message.id)
        .filter((messageId) => !currentMap.has(messageId))

      const fetchedDetails = await Promise.all(
        missingIds.map(async (messageId) => {
          try {
            const detailResponse = await fetch(`${API}/messages/${messageId}`, {
              headers: { Authorization: `Bearer ${mailbox.token}` },
            })

            if (!detailResponse.ok) return null

            const detail = await detailResponse.json()
            const htmlContent = Array.isArray(detail?.html) ? detail.html[0] || '' : detail?.html || ''

            return {
              id: detail.id,
              from: detail?.from?.address || 'expediteur inconnu',
              subject: detail?.subject || '(sans objet)',
              bodyText: detail?.text || '',
              bodyHtml: htmlContent,
              date: detail?.createdAt,
              read: false,
              starred: false,
            }
          } catch {
            return null
          }
        })
      )

      const detailMap = new Map(fetchedDetails.filter(Boolean).map((message) => [message.id, message]))
      const mergedMessages = visibleRawMessages
        .map((message) => currentMap.get(message.id) || detailMap.get(message.id))
        .filter(Boolean)
        .sort((first, second) => new Date(second.date).getTime() - new Date(first.date).getTime())

      const newMessagesCount = fetchedDetails.filter(Boolean).length
      const nextPollAt = Date.now() + (mailbox.pollIntervalMs || 6000)

      setMailboxes((current) => current.map((entry) => (
        entry.id === mailboxId
          ? {
              ...entry,
              messages: mergedMessages,
              lastSyncAt: Date.now(),
              nextPollAt,
            }
          : entry
      )))

      if (activeMailboxIdRef.current === mailboxId) {
        setSyncError('')
      }

      if (newMessagesCount > 0 && mailbox.messages.length > 0 && activeMailboxIdRef.current === mailboxId) {
        toast.success(`${newMessagesCount} nouvel email synchronise.`)
      }
    } catch (error) {
      console.error(error)
      if (activeMailboxIdRef.current === mailboxId) {
        setSyncError(error.message || 'Synchronisation impossible.')
        if (!silent) {
          toast.error(error.message || 'Synchronisation impossible.')
        }
      }

      setMailboxes((current) => current.map((entry) => (
        entry.id === mailboxId
          ? {
              ...entry,
              nextPollAt: Date.now() + (entry.pollIntervalMs || 6000),
            }
          : entry
      )))
    } finally {
      inFlightRef.current.delete(mailboxId)
      if (!silent && activeMailboxIdRef.current === mailboxId) {
        setIsRefreshing(false)
      }
    }
  }

  async function createMailboxFromDraft({ fromAuth = false } = {}) {
    if (mailboxesRef.current.length >= MAX_MAILBOXES) {
      const message = `Maximum ${MAX_MAILBOXES} boites actives.`
      if (fromAuth) setAuthError(message)
      else toast.error(message)
      return false
    }

    const draft = createDraft
    const duration = getDurationConfig(draft.durationKey, draft.customDurationMinutes)
    if (!duration.valid) {
      const message = duration.error || 'Duree invalide.'
      if (fromAuth) setAuthError(message)
      else toast.error(message)
      return false
    }

    setIsCreating(true)
    setSelectedMessageId(null)
    setQrOpen(false)
    if (fromAuth) setAuthError('')

    try {
      const domainsResponse = await fetch(`${API}/domains`)
      const domainsPayload = await domainsResponse.json()
      const domain = domainsPayload?.['hydra:member']?.[0]?.domain

      if (!domain) {
        throw new Error('Aucun domaine mail.tm disponible.')
      }

      const address = `${randomString(10)}@${domain}`
      const mailboxPassword = randomString(16)

      const createResponse = await fetch(`${API}/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password: mailboxPassword }),
      })

      if (!createResponse.ok) {
        const errorBody = await createResponse.json().catch(() => ({}))
        throw new Error(errorBody?.['hydra:description'] || 'Creation de boite impossible.')
      }

      const createdAccount = await createResponse.json()

      const tokenResponse = await fetch(`${API}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, password: mailboxPassword }),
      })

      if (!tokenResponse.ok) {
        throw new Error('Authentification mail.tm impossible.')
      }

      const tokenPayload = await tokenResponse.json()
      const nextMailbox = buildMailbox(
        {
          id: createdAccount.id,
          address,
          password: mailboxPassword,
        },
        tokenPayload.token,
        draft,
        mailboxesRef.current.length
      )

      setMailboxes((current) => [...current, nextMailbox])
      setActiveMailboxId(nextMailbox.id)
      setScreen('app')
      setAuthMode('access')
      setSyncError('')
      window.setTimeout(() => {
        void fetchMailboxMessages(nextMailbox.id, { silent: true })
      }, 0)
      toast.success(mailboxesRef.current.length ? 'Nouvelle boite ajoutee.' : 'Boite securisee creee.')
      return true
    } catch (error) {
      console.error(error)
      if (fromAuth) setAuthError(error.message || 'Creation impossible.')
      else toast.error(error.message || 'Creation impossible.')
      return false
    } finally {
      setIsCreating(false)
    }
  }

  async function handleCreateSubmit() {
    setAuthError('')

    if (mailboxesRef.current.length > 0) {
      setAuthMode('access')
      setAuthError('Deverrouille la session pour ajouter une nouvelle boite.')
      return
    }

    if (createPassword.length < 4) {
      setAuthError('Mot de passe trop court. Minimum 4 caracteres.')
      return
    }

    if (createPassword !== createPasswordConfirm) {
      setAuthError('Les mots de passe ne correspondent pas.')
      return
    }

    const duration = getDurationConfig(createDraft.durationKey, createDraft.customDurationMinutes)
    if (!duration.valid) {
      setAuthError(duration.error || 'Duree invalide.')
      return
    }

    setSessionPassword(createPassword)
    await createMailboxFromDraft({ fromAuth: true })
  }

  async function handleCreateAnotherMailbox() {
    if (!sessionPassword) {
      toast.error('Definis d abord un mot de passe de session.')
      return
    }

    await createMailboxFromDraft()
  }

  function handleLock() {
    if (!mailboxesRef.current.length) return
    setScreen('auth')
    setAuthMode('access')
    setAccessPassword('')
    setSelectedMessageId(null)
    setQrOpen(false)
    setSyncError('')
    toast.success('Session verrouillee.')
  }

  function handleUnlock() {
    if (lockoutSecondsLeft > 0) return
    setAuthError('')

    if (!mailboxesRef.current.length) {
      setAuthError('Aucune boite a restaurer.')
      return
    }

    if (accessPassword !== sessionPassword) {
      const nextFailedAttempts = failedAttempts + 1
      setFailedAttempts(nextFailedAttempts)
      setAccessPassword('')

      if (nextFailedAttempts >= 3) {
        setLockoutUntil(Date.now() + 30000)
        setAuthError('Trop de tentatives. Attends 30 secondes.')
      } else {
        setAuthError(`Mot de passe incorrect. ${3 - nextFailedAttempts} essai(s) restant(s).`)
      }
      return
    }

    setFailedAttempts(0)
    setLockoutUntil(null)
    setScreen('app')
    setAccessPassword('')
    toast.success('Acces restaure.')
  }

  function switchMailbox(mailboxId) {
    setActiveMailboxId(mailboxId)
    setSelectedMessageId(null)
    setQrOpen(false)
    setSyncError('')
    void fetchMailboxMessages(mailboxId, { silent: true })
  }

  function updateActiveMailbox(updater) {
    if (!activeMailboxIdRef.current) return
    setMailboxes((current) => current.map((mailbox) => (
      mailbox.id === activeMailboxIdRef.current
        ? updater(mailbox)
        : mailbox
    )))
  }

  function applyRuntimeSettings() {
    if (!activeMailbox) return
    const duration = getDurationConfig(runtimeDraft.durationKey, runtimeDraft.customDurationMinutes)
    if (!duration.valid) {
      toast.error(duration.error || 'Duree invalide.')
      return
    }

    updateActiveMailbox((mailbox) => ({
      ...mailbox,
      durationKey: runtimeDraft.durationKey,
      customDurationMinutes: runtimeDraft.durationKey === 'custom' ? Number(runtimeDraft.customDurationMinutes) : null,
      pollIntervalMs: Number(runtimeDraft.pollIntervalMs) || 6000,
      expiresAt: duration.isPermanent ? null : Date.now() + duration.totalMs,
      totalDurationMs: duration.isPermanent ? null : duration.totalMs,
      isExpired: false,
      nextPollAt: Date.now(),
    }))

    setSyncError('')
    toast.success(duration.isPermanent ? 'Boite passee en permanent.' : `Duree reglee sur ${duration.label}.`)
  }

  function extendActiveMailbox(minutesToAdd) {
    if (!activeMailbox || activeMailbox.durationKey === 'permanent') {
      toast.error('Cette boite est deja permanente.')
      return
    }

    const currentRemainingMinutes = activeMailbox.expiresAt && !activeMailbox.isExpired
      ? Math.ceil(Math.max(0, activeMailbox.expiresAt - Date.now()) / 60000)
      : 0

    const nextMinutes = Math.min(10080, Math.max(5, currentRemainingMinutes + Number(minutesToAdd || 0)))
    const duration = getDurationConfig('custom', nextMinutes)

    setRuntimeDraft((current) => ({
      ...current,
      durationKey: 'custom',
      customDurationMinutes: String(nextMinutes),
    }))

    updateActiveMailbox((mailbox) => ({
      ...mailbox,
      durationKey: 'custom',
      customDurationMinutes: nextMinutes,
      expiresAt: Date.now() + duration.totalMs,
      totalDurationMs: duration.totalMs,
      isExpired: false,
      nextPollAt: Date.now(),
    }))

    setSyncError('')
    toast.success(`+${nextMinutes - currentRemainingMinutes} min ajoutees.`)
  }

  function makeActivePermanent() {
    if (!activeMailbox) return
    setRuntimeDraft((current) => ({ ...current, durationKey: 'permanent' }))
    updateActiveMailbox((mailbox) => ({
      ...mailbox,
      durationKey: 'permanent',
      customDurationMinutes: null,
      expiresAt: null,
      totalDurationMs: null,
      isExpired: false,
      nextPollAt: Date.now(),
    }))
    setSyncError('')
    toast.success('Boite passee en permanent.')
  }

  async function refreshActiveMailbox() {
    if (!activeMailbox) return
    await fetchMailboxMessages(activeMailbox.id, { silent: false })
  }

  async function copyActiveAddress() {
    if (!activeMailbox?.address) return
    await copyText(activeMailbox.address)
    toast.success('Adresse copiee.')
  }

  async function copyMessageContent() {
    if (!selectedMessage) return
    await copyText(selectedMessage.bodyText || stripHtml(selectedMessage.bodyHtml) || '(vide)')
    toast.success('Contenu copie.')
  }

  function openMessage(messageId) {
    setModalTab('text')
    setSelectedMessageId(messageId)
    updateActiveMailbox((mailbox) => ({
      ...mailbox,
      messages: mailbox.messages.map((message) => (
        message.id === messageId
          ? { ...message, read: true }
          : message
      )),
    }))
  }

  function closeModal() {
    setSelectedMessageId(null)
  }

  function toggleStar(messageId) {
    updateActiveMailbox((mailbox) => ({
      ...mailbox,
      messages: mailbox.messages.map((message) => (
        message.id === messageId
          ? { ...message, starred: !message.starred }
          : message
      )),
    }))
  }

  function deleteMessage(messageId) {
    setSelectedMessageId((current) => (current === messageId ? null : current))
    updateActiveMailbox((mailbox) => ({
      ...mailbox,
      deletedIds: Array.from(new Set([...(mailbox.deletedIds || []), messageId])),
      messages: mailbox.messages.filter((message) => message.id !== messageId),
    }))
    toast.success('Email masque de la session.')
  }

  function removeMailbox(mailboxId) {
    setMailboxes((current) => current.filter((mailbox) => mailbox.id !== mailboxId))
    if (activeMailboxIdRef.current === mailboxId) {
      const next = mailboxesRef.current.filter((mailbox) => mailbox.id !== mailboxId)[0]
      setActiveMailboxId(next?.id || null)
      setSelectedMessageId(null)
    }
    toast.success('Boite retiree.')
  }

  function setMailboxLabel(mailboxId, label) {
    const nextLabel = String(label || '').trim()
    if (!nextLabel) return

    setMailboxes((current) => current.map((mailbox) => (
      mailbox.id === mailboxId
        ? { ...mailbox, label: nextLabel.slice(0, 24) }
        : mailbox
    )))
  }

  function exportActiveMailbox() {
    if (!activeMailbox?.address) return
    const payload = {
      address: activeMailbox.address,
      label: activeMailbox.label,
      duration: getDurationConfig(activeMailbox.durationKey, activeMailbox.customDurationMinutes).label,
      pollIntervalMs: activeMailbox.pollIntervalMs,
      lastSyncAt: activeMailbox.lastSyncAt,
      messages: activeMailbox.messages,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `email-fast-${activeMailbox.address.replace(/[@.]/g, '-')}.json`
    link.click()
    window.URL.revokeObjectURL(url)
    toast.success('Snapshot exporte.')
  }

  return {
    state: {
      screen,
      authMode,
      createPassword,
      createPasswordConfirm,
      accessPassword,
      showCreatePassword,
      showCreatePasswordConfirm,
      showAccessPassword,
      authError,
      sessionPassword,
      failedAttempts,
      lockoutSecondsLeft,
      createDraft,
      runtimeDraft,
      mailboxes,
      activeMailbox,
      activeMailboxId,
      unreadCount,
      starredCount,
      searchQuery,
      filterMode,
      visibleMessages,
      selectedMessage,
      modalTab,
      qrOpen,
      syncError,
      isCreating,
      isRefreshing,
      qrReady,
      remainingMs,
      progressPercent,
    },
    actions: {
      setAuthMode,
      setCreatePassword,
      setCreatePasswordConfirm,
      setAccessPassword,
      setShowCreatePassword,
      setShowCreatePasswordConfirm,
      setShowAccessPassword,
      setCreateDraft,
      setRuntimeDraft,
      setSearchQuery,
      setFilterMode,
      setModalTab,
      setQrOpen,
      handleCreateSubmit,
      handleCreateAnotherMailbox,
      handleLock,
      handleUnlock,
      switchMailbox,
      applyRuntimeSettings,
      extendActiveMailbox,
      makeActivePermanent,
      refreshActiveMailbox,
      copyActiveAddress,
      copyMessageContent,
      openMessage,
      closeModal,
      toggleStar,
      deleteMessage,
      removeMailbox,
      setMailboxLabel,
      exportActiveMailbox,
    },
  }
}
