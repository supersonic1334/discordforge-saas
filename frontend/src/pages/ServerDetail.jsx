import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Shield, Zap, Settings, ChevronDown, ChevronUp,
  RefreshCw, LogOut, Users, Hash, Layers, Server, Search, ScrollText
} from 'lucide-react'
import toast from 'react-hot-toast'
import { modulesAPI, botAPI } from '../services/api'
import { wsService } from '../services/websocket'
import { useGuildStore } from '../stores'
import { getModuleCategoryLabel, getModuleCopy, useI18n } from '../i18n'

const categoryColors = {
  security: { bg: 'bg-red-500/10', border: 'border-red-500/20', text: 'text-red-400', dot: 'bg-red-400' },
  moderation: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' },
  utility: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', dot: 'bg-blue-400' },
}

function mergeModuleSnapshots(previousModules, incomingModules) {
  if (!Array.isArray(incomingModules) || incomingModules.length === 0) {
    return previousModules
  }

  const nextModules = new Map((Array.isArray(previousModules) ? previousModules : []).map((module) => [module.type, module]))
  for (const module of incomingModules) {
    if (!module?.type) continue
    nextModules.set(module.type, module)
  }
  return [...nextModules.values()]
}

function getErrorMessage(error) {
  return error?.response?.data?.error || error?.message || 'Unexpected error'
}

function InteractiveMetaChip({ icon: Icon, children, onClick, accent = 'cyan', title }) {
  const accentClasses = accent === 'green'
    ? 'hover:border-green-400/25 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_16px_30px_rgba(0,0,0,0.28),0_0_18px_rgba(74,222,128,0.08)]'
    : 'hover:border-neon-cyan/25 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_16px_30px_rgba(0,0,0,0.28),0_0_18px_rgba(0,229,255,0.08)]'

  const iconClasses = accent === 'green'
    ? 'text-green-400 bg-green-500/10 border-green-500/20'
    : 'text-neon-cyan bg-neon-cyan/10 border-neon-cyan/20'

  return (
    <motion.button
      type="button"
      title={title}
      onClick={onClick}
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ y: 0, scale: 0.99 }}
      transition={{ duration: 0.16, ease: 'easeOut' }}
      className={`group relative overflow-hidden inline-flex items-center gap-2.5 px-4 py-3 rounded-2xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_24px_rgba(0,0,0,0.2)] transition-all duration-200 ${accentClasses}`}
    >
      <span className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100 ${accent === 'green' ? 'bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.12),transparent_55%)]' : 'bg-[radial-gradient(circle_at_top,rgba(0,229,255,0.12),transparent_55%)]'}`} />
      <span className={`relative flex items-center justify-center w-8 h-8 rounded-xl border ${iconClasses}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className="relative text-sm font-mono text-white/80 group-hover:text-white transition-colors">
        {children}
      </span>
    </motion.button>
  )
}

function ModuleCard({ module, guildId, locale, t, onUpdate }) {
  const [expanded, setExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState(module.simple_config)
  const colors = categoryColors[module.category] || categoryColors.utility
  const moduleCopy = getModuleCopy(module.type, locale, module)

  useEffect(() => {
    setConfig(module.simple_config || {})
  }, [module.simple_config])

  const toggle = async () => {
    setLoading(true)
    try {
      await modulesAPI.toggle(guildId, module.type, !module.enabled)
      onUpdate({ ...module, enabled: !module.enabled })
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
    setLoading(false)
  }

  const saveConfig = async () => {
    try {
      await modulesAPI.config(guildId, module.type, { simple_config: config })
      toast.success(t('serverDetail.configSaved'))
      setExpanded(false)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  return (
    <motion.div
      layout
      className={`glass-card border transition-all duration-300 ${
        module.enabled ? 'border-neon-cyan/20 bg-neon-cyan/[0.02]' : 'border-white/[0.06]'
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg ${colors.bg} border ${colors.border} shrink-0 mt-0.5`}>
            <Shield className={`w-4 h-4 ${colors.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="font-display font-600 text-sm text-white">{moduleCopy.name}</p>
              <span className={`badge ${colors.bg} ${colors.text} border ${colors.border} capitalize`}>
                {getModuleCategoryLabel(module.category, locale)}
              </span>
            </div>
            <p className="text-xs text-white/40 font-body">{moduleCopy.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <label className="toggle-switch">
              <input type="checkbox" checked={module.enabled} onChange={toggle} disabled={loading} />
              <span className="toggle-slider" />
            </label>
          </div>
        </div>

        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 mt-3 text-xs text-white/30 hover:text-white/60 transition-colors"
        >
          <Settings className="w-3 h-3" />
          {t('serverDetail.configure')}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 border-t border-white/[0.06] pt-4 space-y-3">
              <p className="text-xs font-mono text-white/30 uppercase tracking-wider">{t('serverDetail.simpleConfig')}</p>
              {Object.entries(config).map(([key, value]) => (
                <div key={key} className="flex items-center gap-3">
                  <label className="text-xs text-white/50 font-mono w-40 shrink-0">{key}</label>
                  {typeof value === 'boolean' ? (
                    <label className="toggle-switch scale-75">
                      <input
                        type="checkbox"
                        checked={value}
                        onChange={(event) => setConfig({ ...config, [key]: event.target.checked })}
                      />
                      <span className="toggle-slider" />
                    </label>
                  ) : typeof value === 'number' ? (
                    <input
                      type="number"
                      className="input-field py-1.5 text-xs"
                      value={value}
                      onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })}
                    />
                  ) : Array.isArray(value) ? (
                    <span className="text-xs text-white/30 font-mono italic">{t('serverDetail.arrayHelp')}</span>
                  ) : (
                    <input
                      type="text"
                      className="input-field py-1.5 text-xs"
                      value={value || ''}
                      onChange={(event) => setConfig({ ...config, [key]: event.target.value })}
                    />
                  )}
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <button onClick={saveConfig} className="px-4 py-1.5 rounded-lg text-xs font-mono bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan hover:bg-neon-cyan/20 transition-colors">
                  {t('serverDetail.save')}
                </button>
                <button
                  onClick={async () => {
                    await modulesAPI.reset(guildId, module.type)
                    toast.success(t('serverDetail.resetDone'))
                    onUpdate(null)
                  }}
                  className="px-4 py-1.5 rounded-lg text-xs font-mono text-white/30 hover:text-white/60 transition-colors"
                >
                  {t('serverDetail.reset')}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

export default function ServerDetail() {
  const { t, locale } = useI18n()
  const { guildId } = useParams()
  const navigate = useNavigate()
  const { guilds, selectGuild, removeGuild, clearSelectedGuild } = useGuildStore()
  const modulesSectionRef = useRef(null)
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeCategory, setActiveCategory] = useState('all')
  const [leaving, setLeaving] = useState(false)

  const guild = guilds.find((entry) => entry.id === guildId)

  const loadModules = useCallback(async () => {
    setLoading(true)
    try {
      const response = await modulesAPI.list(guildId)
      setModules(response.data.modules)
    } catch {
      toast.error(t('serverDetail.loadFailed'))
    }
    setLoading(false)
  }, [guildId, t])

  useEffect(() => {
    if (guildId) {
      selectGuild(guildId)
      void loadModules()
    }
  }, [guildId, loadModules, selectGuild])

  useEffect(() => {
    const handleRealtimeSync = (payload = {}) => {
      if (String(payload.guildId || '') !== String(guildId || '')) return
      if (Array.isArray(payload.modules) && payload.modules.length > 0) {
        setModules((previous) => mergeModuleSnapshots(previous, payload.modules))
        return
      }
      void loadModules()
    }

    const unsubscribeModules = wsService.on('modules:updated', handleRealtimeSync)
    const unsubscribeSnapshots = wsService.on('team:snapshot_restored', handleRealtimeSync)

    return () => {
      unsubscribeModules()
      unsubscribeSnapshots()
    }
  }, [guildId, loadModules])

  const handleUpdate = (updated, type) => {
    if (!updated) {
      loadModules()
      return
    }
    setModules((previous) => previous.map((module) => module.type === (type || updated.type) ? updated : module))
  }

  const categories = ['all', 'security', 'moderation', 'utility']
  const filtered = activeCategory === 'all' ? modules : modules.filter((module) => module.category === activeCategory)
  const enabledCount = modules.filter((module) => module.enabled).length

  const leaveGuild = async () => {
    if (!window.confirm(`${t('serverDetail.leaveConfirmPrefix')} "${guild?.name}"? ${t('serverDetail.leaveConfirmSuffix')}`)) return
    setLeaving(true)
    try {
      await botAPI.leaveGuild(guildId)
      removeGuild(guildId)
      clearSelectedGuild()
      toast.success(t('serverDetail.leftServer'))
      navigate('/dashboard/servers')
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
    setLeaving(false)
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start gap-4">
        <Link to="/dashboard/servers" className="p-2 rounded-xl text-white/40 hover:text-white hover:bg-white/[0.05] transition-all mt-1">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            {guild?.iconUrl ? (
              <img src={guild.iconUrl} className="w-10 h-10 rounded-xl" alt="" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan/20 to-neon-violet/20 flex items-center justify-center font-display font-700 text-neon-cyan">
                {guild?.name?.[0]}
              </div>
            )}
            <div>
              <h1 className="font-display font-800 text-xl text-white">{guild?.name || t('serverDetail.serverFallback')}</h1>
              <div className="flex flex-wrap gap-3 mt-3">
                <InteractiveMetaChip
                  icon={Server}
                  title={guild?.name || t('serverDetail.serverFallback')}
                  onClick={() => navigate('/dashboard/servers')}
                >
                  <span className="block max-w-[250px] truncate">{guild?.name || t('serverDetail.serverFallback')}</span>
                </InteractiveMetaChip>
                <InteractiveMetaChip
                  icon={Layers}
                  accent="green"
                  title={`${enabledCount}/${modules.length} ${t('serverDetail.modulesActive')}`}
                  onClick={() => modulesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                >
                  {enabledCount}/{modules.length} {t('serverDetail.modulesActive')}
                </InteractiveMetaChip>
              </div>
              <p className="text-xs text-white/30 font-mono flex items-center gap-2 mt-3">
                <Users className="w-3 h-3" /> {guild?.member_count?.toLocaleString(locale)} {t('serverDetail.members')}
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={loadModules} className="p-2 rounded-xl text-white/30 hover:text-white hover:bg-white/[0.05] transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={leaveGuild}
            disabled={leaving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-all text-xs font-mono border border-red-500/10 hover:border-red-500/20"
          >
            <LogOut className="w-3.5 h-3.5" />
            {t('serverDetail.leave')}
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link to="/dashboard/search" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono hover:bg-amber-500/20 transition-colors">
          <Search className="w-3 h-3" /> {t('serverDetail.quickLinks.search', 'Search')}
        </Link>
        <Link to="/dashboard/logs" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-mono hover:bg-violet-500/20 transition-colors">
          <ScrollText className="w-3 h-3" /> {t('serverDetail.quickLinks.logs', 'Logs')}
        </Link>
        <Link to="/dashboard/commands" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono hover:bg-blue-500/20 transition-colors">
          <Hash className="w-3 h-3" /> {t('serverDetail.quickLinks.commands')}
        </Link>
        <Link to="/dashboard/analytics" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20 text-neon-cyan text-xs font-mono hover:bg-neon-cyan/20 transition-colors">
          <Zap className="w-3 h-3" /> {t('serverDetail.quickLinks.analytics')}
        </Link>
      </div>

      <div ref={modulesSectionRef} className="flex gap-2">
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`px-4 py-1.5 rounded-lg text-xs font-mono capitalize transition-all duration-200 ${
              activeCategory === category
                ? 'bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan'
                : 'text-white/40 hover:text-white border border-transparent hover:border-white/10'
            }`}
          >
            {t(`serverDetail.categories.${category}`)} {category === 'all'
              ? `(${modules.length})`
              : `(${modules.filter((module) => module.category === category).length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(6)].map((_, index) => (
            <div key={index} className="glass-card p-4 h-24 skeleton rounded-2xl" />
          ))}
        </div>
      ) : (
        <motion.div layout className="grid gap-4 md:grid-cols-2">
          {filtered.map((module) => (
            <ModuleCard
              key={module.type}
              module={module}
              guildId={guildId}
              locale={locale}
              t={t}
              onUpdate={(updated) => handleUpdate(updated, module.type)}
            />
          ))}
        </motion.div>
      )}
    </div>
  )
}
