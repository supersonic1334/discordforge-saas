import { memo, useState, useEffect, useRef } from 'react'
import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard, Server, Shield, Terminal, BarChart3,
  LogOut, Settings, ChevronLeft, ChevronRight,
  Bot, Crown, Menu, Unplug, KeyRound, LifeBuoy, Star, Ban, Send, Users, Search, ScrollText, BellRing, Fingerprint
} from 'lucide-react'
import { useAuthStore, useGuildStore, useBotStore } from '../../stores'
import { wsService } from '../../services/websocket'
import AuthSnowBackdrop from '../AuthSnowBackdrop'
import { useI18n } from '../../i18n'

const SIDEBAR_COLLAPSED_WIDTH = 64
const SIDEBAR_DEFAULT_WIDTH = 240
const SIDEBAR_MIN_WIDTH = 220
const SIDEBAR_MAX_WIDTH = 380
const SIDEBAR_SPRING = { type: 'spring', stiffness: 220, damping: 26, mass: 0.92 }
const SWIPE_MIN_DISTANCE = 72

function isTouchNavigationEnabled() {
  if (typeof window === 'undefined') return false
  const hasTouch = 'ontouchstart' in window || (navigator?.maxTouchPoints || 0) > 0
  return hasTouch && window.innerWidth < 1280
}

function shouldIgnoreSwipeTarget(target) {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('input, textarea, select, button, a, [role="dialog"], [data-no-swipe-back], [contenteditable="true"], .sidebar-scroll-area'))
}

function getRoleLabel(t, role) {
  if (role === 'api_provider') return t('admin.roles.api_provider', 'fournisseur API')
  return t(`admin.roles.${role}`, role || '')
}

function getSidebarStorageKey(userId) {
  return userId ? `discordforge.sidebar-width.${userId}` : 'discordforge.sidebar-width'
}

function getSidebarMaxWidth() {
  if (typeof window === 'undefined') return SIDEBAR_MAX_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.floor(window.innerWidth * 0.42)))
}

function clampSidebarWidth(width) {
  const parsed = Number(width)
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH
  return Math.min(getSidebarMaxWidth(), Math.max(SIDEBAR_MIN_WIDTH, parsed))
}

function StatusDot({ status }) {
  const colors = {
    running: 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]',
    starting: 'bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]',
    reconnecting: 'bg-blue-400 animate-pulse',
    stopped: 'bg-white/20',
    error: 'bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.6)]',
  }
  return <div className={`w-2 h-2 rounded-full ${colors[status] || colors.stopped}`} />
}

const SidebarContent = memo(function SidebarContent({
  collapsed,
  selectedGuild,
  navItems,
  isActive,
  selectedGuildId,
  canAccessAdminPanel,
  canAccessProviderPanel,
  user,
  t,
  navigate,
  clearSelectedGuild,
  setMobileOpen,
  handleNavClick,
  handleLogout,
}) {
  const status = useBotStore((state) => state.status)
  const ping = useBotStore((state) => state.ping)
  const bot = useBotStore((state) => state.bot)
  const brandAvatarSrc = bot?.avatarUrl || '/discordforger-icon.png'
  const brandAvatarAlt = bot?.username || 'DiscordForger'

  const renderSidebarLink = ({ icon: Icon, label, path, needsGuild }) => {
    const active = isActive(path)
    const disabled = needsGuild && !selectedGuildId

    return (
      <motion.div
        key={path}
        whileHover={disabled ? undefined : { x: collapsed ? 0 : 5, y: -2, scale: 1.012 }}
        whileTap={disabled ? undefined : { scale: 0.988 }}
        transition={{ type: 'spring', stiffness: 340, damping: 24 }}
      >
        <Link
          to={path}
          onClick={(event) => handleNavClick(event, disabled)}
          aria-disabled={disabled}
          className={`sidebar-nav-link ${active ? 'sidebar-nav-link-active' : ''} ${disabled ? 'sidebar-nav-link-disabled' : ''} ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? label : undefined}
        >
          <span className="sidebar-nav-link-glow" />
          <span className={`sidebar-nav-icon ${active ? 'sidebar-nav-icon-active' : ''}`}>
            <Icon className="w-4 h-4 shrink-0" />
          </span>
          {!collapsed && (
            <>
              <span className="sidebar-nav-label">{label}</span>
              <motion.span
                initial={false}
                animate={active ? { opacity: 1, scale: 1, x: 0 } : { opacity: 0, scale: 0.7, x: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="sidebar-nav-dot"
              />
            </>
          )}
        </Link>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={`shrink-0 flex items-center gap-3 p-4 border-b border-white/[0.06] ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-neon-cyan/10 to-neon-violet/10 border border-neon-cyan/20 flex items-center justify-center shrink-0 overflow-hidden p-0.5 shadow-[0_8px_24px_rgba(92,138,255,0.16)]">
          <img src={brandAvatarSrc} className="w-full h-full object-cover" alt={brandAvatarAlt} />
        </div>
        {!collapsed && (
          <div>
            <p className="font-display font-700 text-white text-sm">{t('layout.appName')}</p>
            <p className="text-xs text-white/30 font-mono">{bot?.username || t('layout.appTagline')}</p>
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="shrink-0 mx-3 mt-3 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <StatusDot status={status} />
              <span className="text-xs font-mono text-white/60 capitalize">{t(`layout.status.${status}`, status)}</span>
            </div>
            {ping > 0 && <span className="text-xs font-mono text-neon-cyan/60">{ping}ms</span>}
          </div>
          {selectedGuild && (
            <div className="flex items-center gap-2 mt-2 min-w-0">
              <div className="min-w-0 flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
                <Server className="w-3.5 h-3.5 text-neon-cyan/70 shrink-0" />
                <p className="text-[11px] text-white/40 font-mono truncate">{selectedGuild.name}</p>
              </div>
              <button
                type="button"
                title={t('dashboard.changeServer', 'Changer de serveur')}
                aria-label={t('dashboard.changeServer', 'Changer de serveur')}
                onClick={() => {
                  navigate('/dashboard/servers')
                  setMobileOpen(false)
                }}
                className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/55 hover:text-white hover:bg-white/[0.07] flex items-center justify-center transition-all shrink-0"
              >
                <Server className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                title={t('dashboard.disconnectServer', 'Deconnecter ce serveur')}
                aria-label={t('dashboard.disconnectServer', 'Deconnecter ce serveur')}
                onClick={() => {
                  clearSelectedGuild()
                  navigate('/dashboard/servers')
                  setMobileOpen(false)
                }}
                className="w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 flex items-center justify-center transition-all shrink-0"
              >
                <Unplug className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}

      <nav className="sidebar-scroll-area flex-1 min-h-0 px-3 pt-3 pb-5 space-y-1.5 scrollbar-none mt-2">
        {navItems.map(renderSidebarLink)}
      </nav>

      <div className="shrink-0 mt-3 p-3 border-t border-white/[0.06] space-y-1">
        <Link
          to="/dashboard/reviews"
          onClick={() => setMobileOpen(false)}
          className={`group relative overflow-hidden flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
            isActive('/dashboard/reviews')
              ? 'bg-gradient-to-r from-amber-500/16 via-yellow-400/10 to-amber-500/16 border border-amber-400/25 text-amber-200 shadow-[0_0_30px_rgba(250,204,21,0.18)]'
              : 'text-white/55 border border-transparent hover:text-amber-200 hover:border-amber-400/18 hover:bg-gradient-to-r hover:from-amber-500/10 hover:via-yellow-400/6 hover:to-amber-500/10 hover:shadow-[0_0_24px_rgba(250,204,21,0.12)]'
          } ${collapsed ? 'justify-center' : ''}`}
        >
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_left,rgba(250,204,21,0.14),transparent_58%)]" />
          <Star className="relative z-10 w-4 h-4 shrink-0 text-amber-300 fill-amber-300/40 group-hover:fill-amber-300/60 transition-all duration-200 group-hover:scale-105" />
          {!collapsed && (
            <>
              <span className="relative z-10 font-medium">{t('layout.nav.reviews', 'Avis')}</span>
              {isActive('/dashboard/reviews') && <div className="relative z-10 ml-auto w-1.5 h-1.5 rounded-full bg-amber-300" />}
            </>
          )}
        </Link>

        <Link
          to="/dashboard/support"
          onClick={() => setMobileOpen(false)}
          className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
            isActive('/dashboard/support')
              ? 'bg-gradient-to-r from-cyan-500/15 via-cyan-500/10 to-violet-500/15 border border-cyan-500/25 text-cyan-200 shadow-[0_0_28px_rgba(0,229,255,0.12)]'
              : 'text-white/45 border border-transparent hover:text-cyan-200 hover:border-cyan-500/15 hover:bg-gradient-to-r hover:from-cyan-500/8 hover:via-cyan-500/4 hover:to-violet-500/8'
          } ${collapsed ? 'justify-center' : ''}`}
        >
          <LifeBuoy className="w-4 h-4 shrink-0 text-cyan-300 group-hover:scale-105 transition-transform" />
          {!collapsed && t('layout.nav.support', 'Support')}
        </Link>

        {canAccessAdminPanel && (
          <Link
            to="/dashboard/admin"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
              isActive('/dashboard/admin')
                ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                : 'text-white/40 hover:text-amber-400 hover:bg-amber-500/5'
            } ${collapsed ? 'justify-center' : ''}`}
          >
            <Crown className="w-4 h-4 shrink-0" />
            {!collapsed && t('layout.nav.adminPanel')}
          </Link>
        )}

        {canAccessProviderPanel && (
          <Link
            to="/dashboard/provider"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 ${
              isActive('/dashboard/provider')
                ? 'bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan'
                : 'text-white/40 hover:text-neon-cyan hover:bg-neon-cyan/5'
            } ${collapsed ? 'justify-center' : ''}`}
          >
            <KeyRound className="w-4 h-4 shrink-0" />
            {!collapsed && t('layout.nav.providerPanel', 'Fournisseur API')}
          </Link>
        )}

        <Link
          to="/dashboard/settings"
          onClick={() => setMobileOpen(false)}
          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/40 hover:text-white hover:bg-white/[0.05] transition-all duration-200 ${collapsed ? 'justify-center' : ''}`}
        >
          <Settings className="w-4 h-4 shrink-0" />
          {!collapsed && t('layout.nav.settings')}
        </Link>

        <div className={`flex items-center gap-3 px-3 py-2 mt-1 ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-neon-cyan to-neon-violet flex items-center justify-center text-xs font-display font-700 shrink-0">
            {user?.avatar_url
              ? <img src={user.avatar_url} className="w-full h-full rounded-full object-cover" alt="" />
              : user?.username?.[0]?.toUpperCase()}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-display font-600 text-white truncate">{user?.username}</p>
                <p className="text-xs text-white/30 font-mono capitalize">{getRoleLabel(t, user?.role)}</p>
              </div>
              <button onClick={handleLogout} className="text-white/30 hover:text-red-400 transition-colors p-1">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
})

const MobileHeader = memo(function MobileHeader({ hasSelectedGuild, setMobileOpen, t }) {
  const bot = useBotStore((state) => state.bot)
  const brandAvatarSrc = bot?.avatarUrl || '/discordforger-icon.png'
  const brandAvatarAlt = bot?.username || 'DiscordForger'

  if (!hasSelectedGuild) return null

  return (
    <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-surface-1/80 backdrop-blur-xl">
      <button onClick={() => setMobileOpen(true)} className="text-white/50 hover:text-white">
        <Menu className="w-5 h-5" />
      </button>
      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-neon-cyan/10 to-neon-violet/10 border border-neon-cyan/20 flex items-center justify-center overflow-hidden shrink-0 p-0.5 shadow-[0_8px_24px_rgba(92,138,255,0.16)]">
        <img src={brandAvatarSrc} className="w-full h-full object-cover" alt={brandAvatarAlt} />
      </div>
      <span className="font-display font-700 text-white">{t('layout.appName')}</span>
    </div>
  )
})

export default function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH)
  const [sidebarWidthReady, setSidebarWidthReady] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const mainScrollRef = useRef(null)
  const swipeStateRef = useRef({
    tracking: false,
    ignore: false,
    horizontal: false,
    startX: 0,
    startY: 0,
  })
  const { user, logout } = useAuthStore()
  const { guilds, selectedGuildId, clearSelectedGuild, hydrateSelectedGuild } = useGuildStore()
  const fetchStatus = useBotStore((state) => state.fetchStatus)
  const setStatus = useBotStore((state) => state.setStatus)
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const sidebarStorageKey = getSidebarStorageKey(user?.id)
  const canAccessAdminPanel = ['founder', 'admin'].includes(user?.role)
  const canAccessProviderPanel = user?.role === 'api_provider'
  const hasSelectedGuild = !!selectedGuildId
  const canOpenWithoutGuild = (
    location.pathname === '/dashboard/servers'
    || location.pathname === '/dashboard/provider'
    || location.pathname === '/dashboard/reviews'
    || location.pathname === '/dashboard/support'
  )
  const mustStayOnServers = !hasSelectedGuild && !canOpenWithoutGuild

  const selectedGuild = guilds.find((g) => g.id === selectedGuildId)
  const navItems = [
    { icon: LayoutDashboard, label: t('layout.nav.dashboard'), path: '/dashboard' },
    { icon: Server, label: t('layout.nav.servers'), path: '/dashboard/servers' },
    { icon: Users, label: t('layout.nav.team', 'Équipe'), path: '/dashboard/team', needsGuild: true },
    { icon: Shield, label: t('layout.nav.protection', 'Protection'), path: '/dashboard/protection', needsGuild: true },
    { icon: Search, label: t('layout.nav.search', 'Search'), path: '/dashboard/search', needsGuild: true },
    { icon: Fingerprint, label: t('layout.nav.scan', 'Scan'), path: '/dashboard/scan', needsGuild: true },
    { icon: ScrollText, label: t('layout.nav.logs', 'Logs'), path: '/dashboard/logs', needsGuild: true },
    { icon: Send, label: t('layout.nav.messages', 'Messages'), path: '/dashboard/messages', needsGuild: true },
    { icon: BellRing, label: t('layout.nav.notifications', 'Notifications'), path: '/dashboard/notifications', needsGuild: true },
    { icon: Ban, label: t('layout.nav.blocked', 'Contrôle d’accès'), path: '/dashboard/blocked', needsGuild: true },
    { icon: Terminal, label: t('layout.nav.commands'), path: '/dashboard/commands', needsGuild: true },
    { icon: BarChart3, label: t('layout.nav.analytics'), path: '/dashboard/analytics', needsGuild: true },
    { icon: Bot, label: t('layout.nav.aiAssistant'), path: '/dashboard/ai' },
  ]
  useEffect(() => {
    fetchStatus()
    const refreshInterval = setInterval(() => fetchStatus(), 15000)
    const handleBlockedAccess = () => {
      wsService.disconnect()
      setStatus({
        status: 'stopped',
        ping: -1,
        guildCount: 0,
        startedAt: null,
        restartCount: 0,
        lastError: null,
        bot: null,
      })
      window.location.replace('/auth?blocked=1')
    }
    const forceLogout = () => {
      wsService.disconnect()
      setStatus({
        status: 'stopped',
        ping: -1,
        guildCount: 0,
        startedAt: null,
        restartCount: 0,
        lastError: null,
        bot: null,
      })
      logout()
      window.location.replace('/auth')
    }
    const unsub = wsService.on('bot:statusChange', (payload) => {
      setStatus(payload)
    })
    const unsubBlocked = wsService.on('account:blocked', handleBlockedAccess)
    const unsubDeleted = wsService.on('account:deleted', forceLogout)
    const unsubInvalid = wsService.on('session:invalid', forceLogout)
    return () => {
      clearInterval(refreshInterval)
      unsub()
      unsubBlocked()
      unsubDeleted()
      unsubInvalid()
    }
  }, [])

  useEffect(() => {
    hydrateSelectedGuild()
  }, [user?.id, hydrateSelectedGuild])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const stored = Number(window.localStorage.getItem(sidebarStorageKey))
    setSidebarWidth(clampSidebarWidth(stored))
    setSidebarWidthReady(true)
  }, [sidebarStorageKey])

  useEffect(() => {
    if (!sidebarWidthReady || typeof window === 'undefined') return
    window.localStorage.setItem(sidebarStorageKey, String(clampSidebarWidth(sidebarWidth)))
  }, [sidebarStorageKey, sidebarWidth, sidebarWidthReady])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleResize = () => {
      setSidebarWidth((currentWidth) => clampSidebarWidth(currentWidth))
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!isResizing || typeof window === 'undefined') return undefined

    const handleMouseMove = (event) => {
      setSidebarWidth(clampSidebarWidth(event.clientX))
    }

    const stopResize = () => {
      setIsResizing(false)
    }

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    document.body.style.cursor = 'ew-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)

    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
    }
  }, [isResizing])

  useEffect(() => {
    const mainElement = mainScrollRef.current
    if (!mainElement) return
    mainElement.scrollTop = 0
  }, [location.pathname])

  useEffect(() => {
    if (mustStayOnServers) {
      setMobileOpen(false)
      navigate('/dashboard/servers', { replace: true })
    }
  }, [mustStayOnServers, navigate])

  const handleLogout = () => {
    setStatus({
      status: 'stopped',
      ping: -1,
      guildCount: 0,
      startedAt: null,
      restartCount: 0,
      lastError: null,
      bot: null,
    })
    logout()
    navigate('/auth')
  }

  const isActive = (path) => {
    if (path === '/dashboard') return location.pathname === '/dashboard'
    return location.pathname.startsWith(path)
  }

  const handleNavClick = (event, disabled) => {
    if (disabled) {
      event.preventDefault()
      return
    }

    setMobileOpen(false)
  }

  const handleResizeStart = (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    if (collapsed) {
      setCollapsed(false)
      setSidebarWidth(clampSidebarWidth(event.clientX))
    }
    setIsResizing(true)
  }

  const handleTouchStart = (event) => {
    if (!isTouchNavigationEnabled() || mobileOpen) return
    const touch = event.touches?.[0]
    if (!touch) return

    swipeStateRef.current = {
      tracking: true,
      ignore: shouldIgnoreSwipeTarget(event.target),
      horizontal: false,
      startX: touch.clientX,
      startY: touch.clientY,
    }
  }

  const handleTouchMove = (event) => {
    if (!isTouchNavigationEnabled()) return
    const state = swipeStateRef.current
    if (!state.tracking || state.ignore) return

    const touch = event.touches?.[0]
    if (!touch) return
    const deltaX = touch.clientX - state.startX
    const deltaY = touch.clientY - state.startY

    if (!state.horizontal && Math.abs(deltaX) > 12 && Math.abs(deltaX) > Math.abs(deltaY) * 1.3) {
      state.horizontal = true
    }

    if (state.horizontal) {
      event.preventDefault()
    }
  }

  const handleTouchEnd = (event) => {
    if (!isTouchNavigationEnabled()) return
    const state = swipeStateRef.current
    swipeStateRef.current = {
      tracking: false,
      ignore: false,
      horizontal: false,
      startX: 0,
      startY: 0,
    }

    if (!state.tracking || state.ignore) return

    const touch = event.changedTouches?.[0]
    if (!touch) return
    const deltaX = touch.clientX - state.startX
    const deltaY = touch.clientY - state.startY

    if (Math.abs(deltaX) < SWIPE_MIN_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY) * 1.3) return

    if (deltaX < 0 && hasSelectedGuild) {
      setMobileOpen(true)
    }
  }

  return (
    <div className="dashboard-shell relative flex min-h-screen min-h-[100dvh] md:h-screen max-w-full overflow-hidden">
      <AuthSnowBackdrop className="z-[1]" />

      {hasSelectedGuild && (
        <>
          <motion.aside
            animate={{ width: collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth }}
            transition={isResizing ? { duration: 0 } : SIDEBAR_SPRING}
            className={`hidden lg:flex flex-col relative z-20 border-r border-white/[0.06] bg-surface-1/80 backdrop-blur-xl shrink-0 sidebar-shell ${isResizing ? 'sidebar-shell-resizing' : ''}`}
          >
            <SidebarContent
              collapsed={collapsed}
              selectedGuild={selectedGuild}
              navItems={navItems}
              isActive={isActive}
              selectedGuildId={selectedGuildId}
              canAccessAdminPanel={canAccessAdminPanel}
              canAccessProviderPanel={canAccessProviderPanel}
              user={user}
              t={t}
              navigate={navigate}
              clearSelectedGuild={clearSelectedGuild}
              setMobileOpen={setMobileOpen}
              handleNavClick={handleNavClick}
              handleLogout={handleLogout}
            />
            <div
              onMouseDown={handleResizeStart}
              className="absolute top-0 bottom-0 -right-2 w-4 cursor-ew-resize group z-20"
            >
              <div className={`sidebar-resize-rail ${isResizing ? 'sidebar-resize-rail-active' : ''}`} />
            </div>
            <motion.button
              onClick={() => setCollapsed(!collapsed)}
              whileHover={{ scale: 1.08, x: 2 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="absolute -right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-surface-2 border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:border-white/20 transition-all z-30 sidebar-toggle-button"
            >
              <motion.span
                animate={{ rotate: collapsed ? 0 : 180 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </motion.span>
            </motion.button>
          </motion.aside>

          <AnimatePresence>
            {mobileOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setMobileOpen(false)}
                  className="fixed inset-0 bg-black/60 z-30 lg:hidden"
                />
                <motion.aside
                  initial={{ x: -280 }}
                  animate={{ x: 0 }}
                  exit={{ x: -280 }}
                  transition={{ type: 'spring', damping: 30, stiffness: 260, mass: 0.9 }}
                  className="fixed left-0 top-0 bottom-0 w-[min(72vw,280px)] z-40 lg:hidden bg-surface-1/95 backdrop-blur-xl border-r border-white/[0.06] shadow-[6px_0_24px_rgba(0,0,0,0.4)]"
                >
                  <SidebarContent
                    collapsed={collapsed}
                    selectedGuild={selectedGuild}
                    navItems={navItems}
                    isActive={isActive}
                    selectedGuildId={selectedGuildId}
                    canAccessAdminPanel={canAccessAdminPanel}
                    canAccessProviderPanel={canAccessProviderPanel}
                    user={user}
                    t={t}
                    navigate={navigate}
                    clearSelectedGuild={clearSelectedGuild}
                    setMobileOpen={setMobileOpen}
                    handleNavClick={handleNavClick}
                    handleLogout={handleLogout}
                  />
                </motion.aside>
              </>
            )}
          </AnimatePresence>
        </>
      )}

      <div
        className="dashboard-content-shell flex-1 flex flex-col min-w-0 max-w-full overflow-hidden relative z-10"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <MobileHeader hasSelectedGuild={hasSelectedGuild} setMobileOpen={setMobileOpen} t={t} />

        <main ref={mainScrollRef} className="app-main-scroll flex-1 overflow-y-auto overflow-x-hidden scrollbar-none pb-safe-bottom">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
