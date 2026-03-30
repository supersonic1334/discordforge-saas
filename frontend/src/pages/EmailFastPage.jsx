import { useEffect, useRef } from 'react'
import './EmailFastPage.css'

const QR_CODE_SCRIPT_URL = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'

let qrCodeScriptPromise

function ensureQRCodeScript() {
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.QRCode) return Promise.resolve(window.QRCode)

  if (!qrCodeScriptPromise) {
    qrCodeScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector(`script[src="${QR_CODE_SCRIPT_URL}"]`)

      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(window.QRCode), { once: true })
        existingScript.addEventListener('error', reject, { once: true })
        return
      }

      const script = document.createElement('script')
      script.src = QR_CODE_SCRIPT_URL
      script.async = true
      script.onload = () => resolve(window.QRCode)
      script.onerror = () => {
        qrCodeScriptPromise = null
        reject(new Error('Unable to load QRCode.js'))
      }
      document.head.appendChild(script)
    })
  }

  return qrCodeScriptPromise
}

const COPY_BUTTON_CONTENT = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
  Copier
`

const COPY_SUCCESS_CONTENT = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
  Copie !
`

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'readonly')
  textarea.style.position = 'absolute'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

export default function EmailFastPage() {
  const pageRef = useRef(null)

  useEffect(() => {
    const root = pageRef.current
    if (!root) return undefined

    const previousTitle = document.title
    document.title = 'Email Fast — DiscordForger'

    let disposed = false
    let sessionPassword = null
    let failedAttempts = 0
    let lockoutActive = false
    let lockoutSecs = 30
    let lockoutInterval = null
    let savedMailbox = null
    let account = null
    let token = null
    let messages = []
    let pollTimer = null
    let timerInterval = null
    let totalSecs = 600
    let secsLeft = 600
    let currentMailIndex = -1
    let qrVisible = false
    let currentTab = 'text'
    let toastTimeout = null

    const timeouts = new Set()
    const cleanupFns = []

    const elements = {
      authScreen: root.querySelector('#authScreen'),
      appScreen: root.querySelector('#appScreen'),
      createTabButton: root.querySelector('[data-auth-tab="create"]'),
      accessTabButton: root.querySelector('[data-auth-tab="access"]'),
      tabCreate: root.querySelector('#tabCreate'),
      tabAccess: root.querySelector('#tabAccess'),
      authError: root.querySelector('#authError'),
      authTabs: Array.from(root.querySelectorAll('.auth-tab')),
      createPass: root.querySelector('#createPass'),
      createPassConfirm: root.querySelector('#createPassConfirm'),
      accessPass: root.querySelector('#accessPass'),
      strengthFill: root.querySelector('#strengthFill'),
      btnCreate: root.querySelector('#btnCreate'),
      btnAccess: root.querySelector('#btnAccess'),
      accessInfo: root.querySelector('#accessInfo'),
      toggleEyeButtons: Array.from(root.querySelectorAll('[data-toggle-eye]')),
      lockoutOverlay: root.querySelector('#lockoutOverlay'),
      lockoutTimer: root.querySelector('#lockoutTimer'),
      emailDisplay: root.querySelector('#emailDisplay'),
      btnCopy: root.querySelector('#btnCopy'),
      btnNewMailbox: root.querySelector('#btnNewMailbox'),
      timerLabel: root.querySelector('#timerLabel'),
      progressFill: root.querySelector('#progressFill'),
      extendButtons: Array.from(root.querySelectorAll('[data-extend-minutes]')),
      btnQR: root.querySelector('#btnQR'),
      qrPanel: root.querySelector('#qrPanel'),
      qrCanvas: root.querySelector('#qrCanvas'),
      errorBanner: root.querySelector('#errorBanner'),
      inboxCount: root.querySelector('#inboxCount'),
      btnRefresh: root.querySelector('#btnRefresh'),
      searchInput: root.querySelector('#searchInput'),
      mailList: root.querySelector('#mailList'),
      btnLock: root.querySelector('#btnLock'),
      overlay: root.querySelector('#overlay'),
      mSubject: root.querySelector('#mSubject'),
      mFrom: root.querySelector('#mFrom'),
      mBody: root.querySelector('#mBody'),
      btnCopyContent: root.querySelector('#btnCopyContent'),
      closeModal: root.querySelector('#btnCloseModal'),
      viewTabs: Array.from(root.querySelectorAll('.tab')),
      toast: root.querySelector('#toast'),
    }

    const qrCodeReady = ensureQRCodeScript().catch((error) => {
      console.error(error)
      return null
    })

    const scheduleTimeout = (callback, delay) => {
      const timeoutId = window.setTimeout(() => {
        timeouts.delete(timeoutId)
        callback()
      }, delay)
      timeouts.add(timeoutId)
      return timeoutId
    }

    const on = (target, eventName, handler, options) => {
      if (!target) return
      target.addEventListener(eventName, handler, options)
      cleanupFns.push(() => target.removeEventListener(eventName, handler, options))
    }

    function clearRuntimeTimers() {
      window.clearInterval(pollTimer)
      window.clearInterval(timerInterval)
      window.clearInterval(lockoutInterval)
      window.clearTimeout(toastTimeout)
      pollTimer = null
      timerInterval = null
      lockoutInterval = null
      toastTimeout = null

      timeouts.forEach((timeoutId) => window.clearTimeout(timeoutId))
      timeouts.clear()
    }

    function switchAuthTab(tab) {
      elements.authTabs.forEach((tabButton) => {
        tabButton.classList.toggle('active', tabButton.dataset.authTab === tab)
      })

      if (elements.tabCreate) {
        elements.tabCreate.style.display = tab === 'create' ? 'block' : 'none'
      }
      if (elements.tabAccess) {
        elements.tabAccess.style.display = tab === 'access' ? 'block' : 'none'
      }

      clearAuthError()

      if (tab === 'access' && elements.accessInfo) {
        if (savedMailbox?.account?.address) {
          elements.accessInfo.style.display = 'block'
          elements.accessInfo.textContent = `📬 Boîte active : ${savedMailbox.account.address}`
        } else {
          elements.accessInfo.style.display = 'none'
          elements.accessInfo.textContent = ''
        }
      }
    }

    function toggleEye(fieldId, button) {
      const field = root.querySelector(`#${fieldId}`)
      if (!field || !button) return
      field.type = field.type === 'password' ? 'text' : 'password'
      button.textContent = field.type === 'password' ? '👁' : '🙈'
    }

    function handleEnter(event, callback) {
      if (event.key !== 'Enter') return
      event.preventDefault()
      callback()
    }

    function checkStrength() {
      const password = elements.createPass?.value || ''
      const fill = elements.strengthFill
      if (!fill) return

      let score = 0
      if (password.length >= 8) score += 1
      if (/[A-Z]/.test(password)) score += 1
      if (/[0-9]/.test(password)) score += 1
      if (/[^A-Za-z0-9]/.test(password)) score += 1

      const colors = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e']
      const widths = ['25%', '50%', '75%', '100%']

      fill.style.width = password.length ? widths[score - 1] || '15%' : '0%'
      fill.style.background = password.length ? colors[score - 1] || '#ef4444' : 'transparent'
    }

    async function submitCreate() {
      const password = elements.createPass?.value || ''
      const confirmPassword = elements.createPassConfirm?.value || ''

      clearAuthError()

      if (password.length < 4) {
        showAuthError('Mot de passe trop court (min. 4 caractères)')
        shakeField('createPass')
        return
      }

      if (password !== confirmPassword) {
        showAuthError('Les mots de passe ne correspondent pas')
        shakeField('createPassConfirm')
        return
      }

      sessionPassword = password

      if (elements.btnCreate) {
        elements.btnCreate.disabled = true
        elements.btnCreate.textContent = '⏳ Création...'
      }

      await launchApp()
    }

    function submitAccess() {
      if (lockoutActive) return

      const password = elements.accessPass?.value || ''
      clearAuthError()

      if (!savedMailbox) {
        showAuthError('Aucune boîte active — crée-en une d’abord')
        return
      }

      if (password !== sessionPassword) {
        failedAttempts += 1
        shakeField('accessPass')

        if (elements.accessPass) {
          elements.accessPass.value = ''
        }

        if (failedAttempts >= 3) {
          startLockout()
        } else {
          showAuthError(`Mot de passe incorrect — ${3 - failedAttempts} essai(s) restant(s)`)
        }

        return
      }

      failedAttempts = 0
      restoreApp()
    }

    function startLockout() {
      lockoutActive = true
      lockoutSecs = 30
      clearAuthError()
      elements.lockoutOverlay?.classList.add('show')

      if (elements.lockoutTimer) {
        elements.lockoutTimer.textContent = `${lockoutSecs}s`
      }

      window.clearInterval(lockoutInterval)
      lockoutInterval = window.setInterval(() => {
        lockoutSecs -= 1

        if (elements.lockoutTimer) {
          elements.lockoutTimer.textContent = `${lockoutSecs}s`
        }

        if (lockoutSecs <= 0) {
          window.clearInterval(lockoutInterval)
          lockoutActive = false
          failedAttempts = 0
          elements.lockoutOverlay?.classList.remove('show')
        }
      }, 1000)
    }

    function shakeField(fieldId) {
      const field = root.querySelector(`#${fieldId}`)
      if (!field) return
      field.classList.add('error')
      scheduleTimeout(() => field.classList.remove('error'), 500)
    }

    function showAuthError(message) {
      if (!elements.authError) return
      elements.authError.textContent = `⚠ ${message}`
      elements.authError.style.display = 'block'
    }

    function clearAuthError() {
      if (!elements.authError) return
      elements.authError.style.display = 'none'
      elements.authError.textContent = ''
    }

    async function launchApp() {
      showApp()
      await createMailbox()
    }

    function showApp() {
      if (elements.authScreen) {
        elements.authScreen.style.display = 'none'
      }
      if (elements.appScreen) {
        elements.appScreen.style.display = 'block'
      }
    }

    function showAuth() {
      if (elements.authScreen) {
        elements.authScreen.style.display = 'flex'
      }
      if (elements.appScreen) {
        elements.appScreen.style.display = 'none'
      }
    }

    function lockApp() {
      if (!account || !token) return

      savedMailbox = {
        account: { ...account },
        token,
      }

      window.clearInterval(pollTimer)
      window.clearInterval(timerInterval)
      pollTimer = null
      timerInterval = null

      showAuth()
      switchAuthTab('access')

      if (elements.btnCreate) {
        elements.btnCreate.disabled = false
        elements.btnCreate.textContent = '✉️ Créer ma boîte sécurisée'
      }

      showToast('🔒 Boîte verrouillée')
    }

    function restoreApp() {
      if (!savedMailbox) return

      account = { ...savedMailbox.account }
      token = savedMailbox.token

      if (elements.accessPass) {
        elements.accessPass.value = ''
      }

      showApp()
      setEmail(account.address)
      renderList()
      pollTimer = window.setInterval(fetchMessages, 6000)
      startTimer()
      showToast('🔓 Accès restauré')
    }

    async function createMailbox() {
      window.clearInterval(pollTimer)
      window.clearInterval(timerInterval)

      pollTimer = null
      timerInterval = null
      messages = []
      token = null
      account = null
      currentMailIndex = -1
      secsLeft = 600
      totalSecs = 600

      closeModal()
      setEmail('Création...')
      updateCount()
      renderList()
      hideError()

      try {
        const domainsResponse = await fetch('https://api.mail.tm/domains')
        const domainsPayload = await domainsResponse.json()
        const domain = domainsPayload?.['hydra:member']?.[0]?.domain

        if (!domain) {
          throw new Error('Aucun domaine disponible')
        }

        const username = rnd(10)
        const mailboxPassword = rnd(16)
        const address = `${username}@${domain}`

        const createResponse = await fetch('https://api.mail.tm/accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, password: mailboxPassword }),
        })

        if (!createResponse.ok) {
          const createError = await createResponse.json().catch(() => ({}))
          throw new Error(createError?.['hydra:description'] || 'Erreur création')
        }

        const createdAccount = await createResponse.json()
        account = {
          id: createdAccount.id,
          address,
          password: mailboxPassword,
        }

        const tokenResponse = await fetch('https://api.mail.tm/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address, password: mailboxPassword }),
        })

        if (!tokenResponse.ok) {
          throw new Error('Erreur auth')
        }

        token = (await tokenResponse.json()).token

        setEmail(address)
        updateTimer()
        void regenerateQR()
        startTimer()
        pollTimer = window.setInterval(fetchMessages, 6000)
        showToast('✓ Boîte créée !')
        await fetchMessages()
      } catch (error) {
        console.error(error)
        showError(`Erreur : ${error.message}`)
        setEmail('Erreur — réessaie')

        if (elements.btnCreate) {
          elements.btnCreate.disabled = false
          elements.btnCreate.textContent = '✉️ Créer ma boîte sécurisée'
        }
      }
    }

    function newMailbox() {
      messages = []
      void createMailbox()
    }

    function startTimer() {
      window.clearInterval(timerInterval)
      updateTimer()

      timerInterval = window.setInterval(() => {
        secsLeft -= 1
        updateTimer()

        if (secsLeft <= 0) {
          window.clearInterval(pollTimer)
          window.clearInterval(timerInterval)
          pollTimer = null
          timerInterval = null

          if (elements.timerLabel) {
            elements.timerLabel.textContent = '⚠ Expirée'
          }
        }
      }, 1000)
    }

    function updateTimer() {
      const minutes = Math.max(0, Math.floor(secsLeft / 60))
      const seconds = Math.max(0, secsLeft % 60)

      if (elements.timerLabel) {
        elements.timerLabel.textContent = `Expire dans ${minutes}:${String(seconds).padStart(2, '0')}`
      }

      const percentage = totalSecs > 0 ? Math.max(0, (secsLeft / totalSecs) * 100) : 0

      if (elements.progressFill) {
        elements.progressFill.style.width = `${percentage}%`
        elements.progressFill.className = `progress-fill${percentage < 20 ? ' warning' : ''}`
      }
    }

    function extendTime(minutes) {
      secsLeft += minutes * 60
      totalSecs = Math.max(totalSecs, secsLeft)
      updateTimer()
      showToast(`+${minutes} min ajoutées ✓`)
    }

    function toggleQR() {
      qrVisible = !qrVisible
      elements.qrPanel?.classList.toggle('show', qrVisible)
      elements.btnQR?.classList.toggle('active', qrVisible)

      if (qrVisible) {
        void regenerateQR()
      }
    }

    async function regenerateQR() {
      if (!account || !elements.qrCanvas) return

      const QRCodeLib = await qrCodeReady
      if (disposed || !QRCodeLib) {
        showError('QR Code indisponible')
        return
      }

      elements.qrCanvas.innerHTML = ''
      new QRCodeLib(elements.qrCanvas, {
        text: account.address,
        width: 140,
        height: 140,
        colorDark: '#000000',
        colorLight: '#ffffff',
        correctLevel: QRCodeLib.CorrectLevel.M,
      })
    }

    async function fetchMessages() {
      if (!token) return

      try {
        const response = await fetch('https://api.mail.tm/messages', {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!response.ok) return

        const payload = await response.json()
        const rawMessages = payload?.['hydra:member'] || []
        const knownIds = new Set(messages.map((message) => message.id))
        const newMessages = rawMessages.filter((message) => !knownIds.has(message.id))

        if (!newMessages.length) {
          updateCount()
          renderList()
          return
        }

        for (const message of newMessages) {
          const detailResponse = await fetch(`https://api.mail.tm/messages/${message.id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (!detailResponse.ok) continue

          const detail = await detailResponse.json()
          const htmlContent = Array.isArray(detail?.html) ? detail.html[0] : detail?.html || ''

          messages.unshift({
            id: detail.id,
            from: detail?.from?.address || 'inconnu',
            subject: detail?.subject || '(sans objet)',
            bodyText: detail?.text || '',
            bodyHtml: htmlContent,
            date: detail?.createdAt,
            read: false,
            starred: false,
          })
        }

        renderList()
        updateCount()
      } catch (error) {
        console.error(error)
      }
    }

    function renderList() {
      const query = (elements.searchInput?.value || '').trim().toLowerCase()
      const filteredMessages = messages.filter((message) => (
        !query
        || message.from.toLowerCase().includes(query)
        || message.subject.toLowerCase().includes(query)
        || message.bodyText.toLowerCase().includes(query)
      ))

      if (!elements.mailList) return

      if (!filteredMessages.length) {
        elements.mailList.innerHTML = `
          <div class="card">
            <div class="empty">
              <div class="empty-icon">${query ? '🔍' : '📭'}</div>
              <div>${query ? 'Aucun résultat' : 'En attente d’emails...'}</div>
              <div style="margin-top:6px;opacity:.5">${query ? 'Essaie un autre terme' : 'Utilise l’adresse ci-dessus'}</div>
            </div>
          </div>
        `
        return
      }

      elements.mailList.innerHTML = filteredMessages.map((message, index) => {
        const realIndex = messages.indexOf(message)
        return `
          <div class="mail-item ${message.read ? '' : 'unread'} ${message.starred ? 'starred' : ''}" style="animation-delay:${index * 0.04}s">
            <div class="mail-from" data-open-index="${realIndex}">
              ${message.read ? '' : '<span class="unread-dot"></span>'}
              ${esc(message.from)}
            </div>
            <div class="mail-time">
              <button class="mail-star" type="button" data-star-index="${realIndex}">${message.starred ? '★' : '☆'}</button>
              <button class="mail-del" type="button" data-delete-index="${realIndex}">🗑</button>
              ${ago(message.date)}
            </div>
            <div class="mail-subject" data-open-index="${realIndex}">${esc(message.subject)}</div>
          </div>
        `
      }).join('')
    }

    function updateCount() {
      if (!elements.inboxCount) return
      elements.inboxCount.textContent = String(messages.length)
    }

    function toggleStar(index) {
      if (!messages[index]) return
      messages[index].starred = !messages[index].starred
      renderList()
    }

    function deleteMail(index) {
      if (!messages[index]) return
      messages.splice(index, 1)
      renderList()
      updateCount()
      showToast('Email supprimé')
    }

    function openEmail(index) {
      const message = messages[index]
      if (!message) return

      message.read = true
      currentMailIndex = index
      renderList()

      if (elements.mSubject) {
        elements.mSubject.textContent = message.subject
      }
      if (elements.mFrom) {
        elements.mFrom.textContent = `De : ${message.from}  ·  ${ago(message.date)}`
      }

      currentTab = 'text'
      elements.viewTabs.forEach((tabButton) => {
        tabButton.classList.toggle('active', tabButton.dataset.viewTab === 'text')
      })

      renderModalBody(message)
      elements.overlay?.classList.add('open')
      document.body.style.overflow = 'hidden'
    }

    function renderModalBody(message) {
      if (!elements.mBody) return

      if (currentTab === 'html' && message.bodyHtml) {
        elements.mBody.innerHTML = '<iframe id="htmlFrame" title="Email HTML preview" sandbox="allow-same-origin"></iframe>'
        const frame = elements.mBody.querySelector('#htmlFrame')
        if (frame) {
          frame.srcdoc = message.bodyHtml
        }
        return
      }

      const content = message.bodyText || stripHtmlTags(message.bodyHtml) || '(vide)'
      elements.mBody.innerHTML = `<pre>${esc(content)}</pre>`
    }

    function switchTab(tab) {
      currentTab = tab
      elements.viewTabs.forEach((tabButton) => {
        tabButton.classList.toggle('active', tabButton.dataset.viewTab === tab)
      })

      if (currentMailIndex >= 0) {
        renderModalBody(messages[currentMailIndex])
      }
    }

    async function copyMailContent() {
      if (currentMailIndex < 0 || !messages[currentMailIndex]) return

      const message = messages[currentMailIndex]
      const content = message.bodyText || stripHtmlTags(message.bodyHtml)

      try {
        await navigator.clipboard.writeText(content)
      } catch {
        fallbackCopyText(content)
      }

      if (elements.btnCopyContent) {
        elements.btnCopyContent.classList.add('copy-ok')
        elements.btnCopyContent.textContent = '✓'
      }

      showToast('Contenu copié !')

      scheduleTimeout(() => {
        if (!elements.btnCopyContent) return
        elements.btnCopyContent.classList.remove('copy-ok')
        elements.btnCopyContent.textContent = '📋'
      }, 2000)
    }

    function closeModal() {
      elements.overlay?.classList.remove('open')
      document.body.style.overflow = ''
    }

    async function copyEmail() {
      if (!account?.address || !elements.btnCopy) return

      try {
        await navigator.clipboard.writeText(account.address)
      } catch {
        fallbackCopyText(account.address)
      }

      elements.btnCopy.classList.add('copied')
      elements.btnCopy.innerHTML = COPY_SUCCESS_CONTENT
      showToast('✓ Adresse copiée !')

      scheduleTimeout(() => {
        if (!elements.btnCopy) return
        elements.btnCopy.classList.remove('copied')
        elements.btnCopy.innerHTML = COPY_BUTTON_CONTENT
      }, 2200)
    }

    function rnd(length) {
      const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
      return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    }

    function esc(value) {
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    }

    function stripHtmlTags(value) {
      return String(value || '').replace(/<[^>]*>/g, '')
    }

    function ago(dateValue) {
      if (!dateValue) return 'À l’instant'
      const diff = Date.now() - new Date(dateValue).getTime()
      if (diff < 60000) return 'À l’instant'
      if (diff < 3600000) return `${Math.floor(diff / 60000)} min`
      return new Date(dateValue).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    }

    function setEmail(value) {
      if (elements.emailDisplay) {
        elements.emailDisplay.textContent = value
      }
    }

    function showToast(message) {
      if (!elements.toast) return
      elements.toast.textContent = message
      elements.toast.classList.add('show')
      window.clearTimeout(toastTimeout)
      toastTimeout = window.setTimeout(() => {
        elements.toast?.classList.remove('show')
      }, 2600)
    }

    function showError(message) {
      if (!elements.errorBanner) return
      elements.errorBanner.textContent = message
      elements.errorBanner.style.display = 'block'
    }

    function hideError() {
      if (!elements.errorBanner) return
      elements.errorBanner.style.display = 'none'
      elements.errorBanner.textContent = ''
    }

    on(elements.createTabButton, 'click', () => switchAuthTab('create'))
    on(elements.accessTabButton, 'click', () => switchAuthTab('access'))

    elements.toggleEyeButtons.forEach((button) => {
      on(button, 'click', () => toggleEye(button.dataset.toggleEye, button))
    })

    on(elements.createPass, 'input', checkStrength)
    on(elements.createPass, 'keydown', (event) => handleEnter(event, submitCreate))
    on(elements.createPassConfirm, 'keydown', (event) => handleEnter(event, submitCreate))
    on(elements.accessPass, 'keydown', (event) => handleEnter(event, submitAccess))

    on(elements.btnCreate, 'click', () => {
      void submitCreate()
    })
    on(elements.btnAccess, 'click', submitAccess)
    on(elements.btnCopy, 'click', () => {
      void copyEmail()
    })
    on(elements.btnNewMailbox, 'click', newMailbox)
    on(elements.btnQR, 'click', toggleQR)
    on(elements.btnRefresh, 'click', () => {
      void fetchMessages()
    })
    on(elements.btnLock, 'click', lockApp)
    on(elements.btnCopyContent, 'click', () => {
      void copyMailContent()
    })
    on(elements.closeModal, 'click', closeModal)
    on(elements.searchInput, 'input', renderList)
    on(elements.overlay, 'click', (event) => {
      if (event.target === elements.overlay) {
        closeModal()
      }
    })

    elements.extendButtons.forEach((button) => {
      on(button, 'click', () => extendTime(Number(button.dataset.extendMinutes || 0)))
    })

    elements.viewTabs.forEach((button) => {
      on(button, 'click', () => switchTab(button.dataset.viewTab || 'text'))
    })

    on(elements.mailList, 'click', (event) => {
      const starButton = event.target.closest('[data-star-index]')
      if (starButton) {
        toggleStar(Number(starButton.dataset.starIndex))
        return
      }

      const deleteButton = event.target.closest('[data-delete-index]')
      if (deleteButton) {
        deleteMail(Number(deleteButton.dataset.deleteIndex))
        return
      }

      const openTarget = event.target.closest('[data-open-index]')
      if (openTarget) {
        openEmail(Number(openTarget.dataset.openIndex))
      }
    })

    const handleEscapeKey = (event) => {
      if (event.key === 'Escape') {
        closeModal()
      }
    }

    document.addEventListener('keydown', handleEscapeKey)
    cleanupFns.push(() => document.removeEventListener('keydown', handleEscapeKey))

    switchAuthTab('create')
    updateCount()
    void qrCodeReady

    return () => {
      disposed = true
      document.title = previousTitle
      document.body.style.overflow = ''
      clearRuntimeTimers()
      cleanupFns.forEach((cleanup) => cleanup())
    }
  }, [])

  return (
    <div className="email-fast-page" ref={pageRef}>
      <div id="authScreen">
        <div className="auth-logo">
          <div className="auth-logo-icon">✉️</div>
          <div className="auth-title">Email <span>Fast</span></div>
          <div className="auth-sub">// Boîte mail jetable sécurisée</div>
        </div>

        <div className="auth-card">
          <div className="lockout-overlay" id="lockoutOverlay">
            <div className="lockout-icon">🔒</div>
            <div className="lockout-text">Trop de tentatives</div>
            <div className="lockout-timer" id="lockoutTimer">30s</div>
            <div className="lockout-sub">Réessaie dans un instant</div>
          </div>

          <div className="auth-tabs">
            <button type="button" className="auth-tab active" data-auth-tab="create">Nouvelle boîte</button>
            <button type="button" className="auth-tab" data-auth-tab="access">Accéder</button>
          </div>

          <div className="auth-error" id="authError" />

          <div id="tabCreate">
            <label className="field-label" htmlFor="createPass">Mot de passe de protection</label>
            <div className="field-wrap">
              <input className="field-input" id="createPass" type="password" placeholder="Choisis un mot de passe fort" />
              <button type="button" className="eye-btn" data-toggle-eye="createPass">👁</button>
            </div>
            <div className="strength-bar"><div className="strength-fill" id="strengthFill" /></div>

            <label className="field-label" htmlFor="createPassConfirm">Confirmer le mot de passe</label>
            <div className="field-wrap">
              <input className="field-input" id="createPassConfirm" type="password" placeholder="Répète le mot de passe" />
              <button type="button" className="eye-btn" data-toggle-eye="createPassConfirm">👁</button>
            </div>

            <button type="button" className="btn-auth" id="btnCreate">
              ✉️ &nbsp;Créer ma boîte sécurisée
            </button>

            <div className="auth-info">
              🔐 Le mot de passe protège l&apos;accès à ta boîte<br />
              lors de cette session
            </div>
          </div>

          <div id="tabAccess" style={{ display: 'none' }}>
            <label className="field-label" htmlFor="accessPass">Mot de passe</label>
            <div className="field-wrap">
              <input className="field-input" id="accessPass" type="password" placeholder="Entre ton mot de passe" />
              <button type="button" className="eye-btn" data-toggle-eye="accessPass">👁</button>
            </div>
            <button type="button" className="btn-auth" id="btnAccess">
              🔓 &nbsp;Accéder à ma boîte
            </button>
            <div className="auth-info" id="accessInfo" style={{ display: 'none' }} />
          </div>
        </div>
      </div>

      <div id="appScreen">
        <div className="header">
          <div className="hdr-l">
            <div className="hdr-icon">✉️</div>
            <div className="hdr-title">Email <span>Fast</span></div>
          </div>
          <div className="hdr-r">
            <div className="pill"><div className="dot-live" />Actif</div>
            <button type="button" className="btn-lock" id="btnLock">🔒 Verrouiller</button>
          </div>
        </div>

        <div className="main">
          <div className="card">
            <div className="card-line" />
            <div className="card-body">
              <div className="sec-label">Votre adresse temporaire</div>
              <div className="email-row">
                <div className="email-disp" id="emailDisplay">Création...</div>
                <button type="button" className="btn btn-primary" id="btnCopy">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copier
                </button>
                <button type="button" className="btn btn-ghost" id="btnNewMailbox">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                    <path d="M21 2v6h-6" />
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M3 22v-6h6" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                  </svg>
                  Nouvelle
                </button>
              </div>

              <div className="timer-wrap">
                <div className="timer-top">
                  <span className="timer-label" id="timerLabel">Expire dans 10:00</span>
                  <div className="timer-actions">
                    <button type="button" className="btn-xs" data-extend-minutes="5">+5 min</button>
                    <button type="button" className="btn-xs" data-extend-minutes="10">+10 min</button>
                  </div>
                </div>
                <div className="progress-track"><div className="progress-fill" id="progressFill" style={{ width: '100%' }} /></div>
              </div>

              <div className="tools-row">
                <button type="button" className="tool-btn" id="btnQR">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="3" height="3" />
                    <rect x="18" y="14" width="3" height="3" />
                    <rect x="14" y="18" width="3" height="3" />
                    <rect x="18" y="18" width="3" height="3" />
                  </svg>
                  QR Code
                </button>
              </div>

              <div className="qr-panel" id="qrPanel">
                <div id="qrCanvas" />
                <div className="qr-hint">Scanne pour récupérer l&apos;adresse sur ton mobile</div>
              </div>

              <div className="notice">
                <span style={{ fontSize: '14px', flexShrink: 0 }}>ℹ️</span>
                <span>Adresse fournie par <strong>mail.tm</strong> — réelle et fonctionnelle.</span>
              </div>

              <div className="error-banner" id="errorBanner" />
            </div>
          </div>

          <div className="inbox-header">
            <div className="inbox-title-row">
              <span className="inbox-label">Boîte de réception</span>
              <span className="badge" id="inboxCount">0</span>
            </div>
            <button type="button" className="btn-sm" id="btnRefresh">↻ Actualiser</button>
          </div>

          <div className="search-wrap">
            <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input className="search-input" id="searchInput" type="text" placeholder="Rechercher dans les emails..." />
          </div>

          <div className="mail-list" id="mailList">
            <div className="card"><div className="loading-wrap"><div className="spinner" /></div></div>
          </div>
        </div>
      </div>

      <div className="overlay" id="overlay">
        <div className="modal">
          <div className="modal-head">
            <div className="modal-info">
              <div className="modal-subject" id="mSubject">—</div>
              <div className="modal-from" id="mFrom">—</div>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-icon" id="btnCopyContent" title="Copier le contenu">📋</button>
              <button type="button" className="btn-icon" id="btnCloseModal">✕</button>
            </div>
          </div>
          <div className="view-tabs">
            <button type="button" className="tab active" data-view-tab="text">Texte</button>
            <button type="button" className="tab" data-view-tab="html">HTML</button>
          </div>
          <div className="modal-body" id="mBody" />
        </div>
      </div>

      <div className="toast" id="toast" />
    </div>
  )
}
