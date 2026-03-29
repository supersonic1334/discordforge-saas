import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Shield,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Workflow,
  Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { playbooksAPI } from '../services/api'
import { useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const UI = {
  fr: {
    title: 'Playbooks',
    subtitle: 'Workflows automatisés qui combinent plusieurs conditions et actions',
    selectServer: 'Sélectionne un serveur',
    selectServerHint: 'Les playbooks sont configurés par serveur.',
    selectServerAction: 'Choisir un serveur',
    loading: 'Chargement...',
    empty: 'Aucun playbook configuré',
    emptyHint: 'Crée ton premier playbook ou utilise un template.',
    newPlaybook: 'Nouveau playbook',
    useTemplate: 'Utiliser un template',
    templates: 'Templates disponibles',
    templatesHint: 'Templates prêts à l\'emploi pour les scénarios courants',
    conditions: 'Conditions',
    conditionsHint: 'Toutes les conditions doivent être vraies pour déclencher',
    actions: 'Actions',
    actionsHint: 'Actions exécutées quand les conditions sont remplies',
    triggers: 'déclenchements',
    lastTriggered: 'Dernier déclenchement',
    never: 'Jamais',
    enabled: 'Actif',
    disabled: 'Inactif',
    delete: 'Supprimer',
    deleteConfirm: 'Supprimer ce playbook ?',
    save: 'Enregistrer',
    cancel: 'Annuler',
    name: 'Nom du playbook',
    description: 'Description',
    cooldown: 'Cooldown (secondes)',
    cooldownHint: 'Délai minimum entre deux déclenchements pour le même utilisateur',
    addCondition: 'Ajouter une condition',
    addAction: 'Ajouter une action',
    created: 'Playbook créé',
    updated: 'Playbook mis à jour',
    deleted: 'Playbook supprimé',
    toggled: 'Playbook mis à jour',
    error: 'Erreur',
    viewLogs: 'Voir les logs',
  },
  en: {
    title: 'Playbooks',
    subtitle: 'Automated workflows combining multiple conditions and actions',
    selectServer: 'Select a server',
    selectServerHint: 'Playbooks are configured per server.',
    selectServerAction: 'Choose a server',
    loading: 'Loading...',
    empty: 'No playbooks configured',
    emptyHint: 'Create your first playbook or use a template.',
    newPlaybook: 'New playbook',
    useTemplate: 'Use a template',
    templates: 'Available templates',
    templatesHint: 'Ready-to-use templates for common scenarios',
    conditions: 'Conditions',
    conditionsHint: 'All conditions must be true to trigger',
    actions: 'Actions',
    actionsHint: 'Actions executed when conditions are met',
    triggers: 'triggers',
    lastTriggered: 'Last triggered',
    never: 'Never',
    enabled: 'Enabled',
    disabled: 'Disabled',
    delete: 'Delete',
    deleteConfirm: 'Delete this playbook?',
    save: 'Save',
    cancel: 'Cancel',
    name: 'Playbook name',
    description: 'Description',
    cooldown: 'Cooldown (seconds)',
    cooldownHint: 'Minimum delay between triggers for the same user',
    addCondition: 'Add condition',
    addAction: 'Add action',
    created: 'Playbook created',
    updated: 'Playbook updated',
    deleted: 'Playbook deleted',
    toggled: 'Playbook updated',
    error: 'Error',
    viewLogs: 'View logs',
  },
}

function PlaybookCard({ playbook, definitions, onToggle, onDelete, onEdit, t }) {
  const [expanded, setExpanded] = useState(false)

  const getConditionName = (type) => {
    return definitions?.conditions?.[type]?.name || type
  }

  const getActionName = (type) => {
    return definitions?.actions?.[type]?.name || type
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`spotlight-card p-5 border transition-all ${
        playbook.enabled 
          ? 'border-neon-cyan/20 bg-neon-cyan/[0.02]' 
          : 'border-white/[0.06] opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              playbook.enabled ? 'bg-neon-cyan/10' : 'bg-white/5'
            }`}>
              <Workflow className={`w-5 h-5 ${playbook.enabled ? 'text-neon-cyan' : 'text-white/40'}`} />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-700 text-white truncate">{playbook.name}</h3>
              {playbook.description && (
                <p className="text-sm text-white/50 truncate">{playbook.description}</p>
              )}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 text-xs text-white/60">
              <Shield className="w-3 h-3" />
              {playbook.conditions?.length || 0} {t.conditions.toLowerCase()}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 text-xs text-white/60">
              <Zap className="w-3 h-3" />
              {playbook.actions?.length || 0} {t.actions.toLowerCase()}
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 text-xs text-white/60">
              <Play className="w-3 h-3" />
              {playbook.trigger_count || 0} {t.triggers}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onToggle(playbook.id, !playbook.enabled)}
            className={`p-2 rounded-xl transition-all ${
              playbook.enabled 
                ? 'bg-neon-cyan/10 text-neon-cyan hover:bg-neon-cyan/20' 
                : 'bg-white/5 text-white/40 hover:bg-white/10'
            }`}
            title={playbook.enabled ? t.enabled : t.disabled}
          >
            {playbook.enabled ? <ToggleRight className="w-5 h-5" /> : <ToggleLeft className="w-5 h-5" />}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 rounded-xl bg-white/5 text-white/60 hover:bg-white/10 transition-all"
          >
            {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {expanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="mt-5 pt-5 border-t border-white/[0.06] space-y-4"
        >
          <div>
            <p className="text-xs font-mono text-white/40 uppercase tracking-wider mb-2">{t.conditions}</p>
            <div className="space-y-2">
              {playbook.conditions?.map((cond, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span className="text-sm text-white">{getConditionName(cond.type)}</span>
                  {cond.params && Object.keys(cond.params).length > 0 && (
                    <span className="text-xs text-white/40 ml-auto">
                      {Object.entries(cond.params).map(([k, v]) => `${k}: ${v}`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-mono text-white/40 uppercase tracking-wider mb-2">{t.actions}</p>
            <div className="space-y-2">
              {playbook.actions?.map((act, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neon-cyan/10 border border-neon-cyan/20">
                  <Zap className="w-4 h-4 text-neon-cyan shrink-0" />
                  <span className="text-sm text-white">{getActionName(act.type)}</span>
                  {act.params && Object.keys(act.params).length > 0 && (
                    <span className="text-xs text-white/40 ml-auto truncate max-w-[200px]">
                      {Object.entries(act.params).map(([k, v]) => `${k}: ${String(v).slice(0, 20)}`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-3">
            <div className="text-xs text-white/30">
              {t.lastTriggered}: {playbook.last_triggered_at 
                ? new Date(playbook.last_triggered_at).toLocaleString() 
                : t.never}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onDelete(playbook.id)}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm hover:bg-red-500/20 transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  )
}

function TemplateCard({ template, onUse, t }) {
  return (
    <div className="p-4 rounded-2xl border border-white/[0.08] bg-white/[0.02] hover:border-neon-violet/30 transition-all">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-neon-violet/10 flex items-center justify-center shrink-0">
          <Sparkles className="w-5 h-5 text-neon-violet" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-display font-600 text-white text-sm">{template.name}</h4>
          <p className="text-xs text-white/50 mt-1">{template.description}</p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-white/40">
              {template.conditions?.length || 0} conditions → {template.actions?.length || 0} actions
            </span>
          </div>
        </div>
        <button
          onClick={() => onUse(template)}
          className="px-3 py-1.5 rounded-lg bg-neon-violet/10 border border-neon-violet/20 text-neon-violet text-xs font-mono hover:bg-neon-violet/20 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export default function PlaybooksPage() {
  const { t: i18nT, locale } = useI18n()
  const t = UI[locale] || UI.fr
  const { selectedGuild } = useGuildStore()

  const [loading, setLoading] = useState(true)
  const [playbooks, setPlaybooks] = useState([])
  const [definitions, setDefinitions] = useState(null)
  const [showTemplates, setShowTemplates] = useState(false)

  const fetchData = async () => {
    if (!selectedGuild?.id) return
    setLoading(true)
    try {
      const [playbooksRes, defsRes] = await Promise.all([
        playbooksAPI.list(selectedGuild.id),
        playbooksAPI.definitions(selectedGuild.id),
      ])
      setPlaybooks(playbooksRes.data?.playbooks || [])
      setDefinitions(defsRes.data || {})
    } catch (err) {
      toast.error(err.response?.data?.error || t.error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [selectedGuild?.id])

  const handleToggle = async (id, enabled) => {
    try {
      await playbooksAPI.toggle(selectedGuild.id, id, enabled)
      setPlaybooks(prev => prev.map(p => p.id === id ? { ...p, enabled } : p))
      toast.success(t.toggled)
    } catch (err) {
      toast.error(err.response?.data?.error || t.error)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm(t.deleteConfirm)) return
    try {
      await playbooksAPI.delete(selectedGuild.id, id)
      setPlaybooks(prev => prev.filter(p => p.id !== id))
      toast.success(t.deleted)
    } catch (err) {
      toast.error(err.response?.data?.error || t.error)
    }
  }

  const handleUseTemplate = async (template) => {
    try {
      const res = await playbooksAPI.fromTemplate(selectedGuild.id, { template_id: template.id })
      setPlaybooks(prev => [res.data.playbook, ...prev])
      toast.success(t.created)
      setShowTemplates(false)
    } catch (err) {
      toast.error(err.response?.data?.error || t.error)
    }
  }

  if (!selectedGuild) {
    return (
      <div className="px-4 py-5 sm:p-6 max-w-6xl mx-auto">
        <div className="feature-hero p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-neon-cyan/10 flex items-center justify-center mx-auto mb-4">
            <Workflow className="w-8 h-8 text-neon-cyan" />
          </div>
          <h2 className="font-display font-700 text-xl text-white">{t.selectServer}</h2>
          <p className="text-white/50 mt-2 mb-4">{t.selectServerHint}</p>
          <Link
            to="/servers"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all"
          >
            {t.selectServerAction}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 py-5 sm:p-6 max-w-6xl mx-auto space-y-5">
      {/* Hero */}
      <div className="feature-hero p-6 sm:p-7">
        <div className="relative z-[1] space-y-4">
          <div className="space-y-3">
            <span className="feature-chip">
              <Workflow className="w-3.5 h-3.5" />
              Automatisation
            </span>
            <div>
              <h1 className="font-display font-800 text-3xl text-white sm:text-4xl">{t.title}</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/55">{t.subtitle}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-neon-violet/10 border border-neon-violet/30 text-neon-violet font-mono text-sm hover:bg-neon-violet/20 transition-all"
            >
              <Sparkles className="w-4 h-4" />
              {t.useTemplate}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-white/5 border border-white/10 text-white/70 font-mono text-sm hover:bg-white/10 transition-all disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Templates */}
      {showTemplates && definitions?.templates && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="spotlight-card p-5"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-display font-700 text-white">{t.templates}</h3>
              <p className="text-sm text-white/50">{t.templatesHint}</p>
            </div>
            <button
              onClick={() => setShowTemplates(false)}
              className="p-2 rounded-lg bg-white/5 text-white/40 hover:bg-white/10 transition-all"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {definitions.templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                onUse={handleUseTemplate}
                t={t}
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* Liste des playbooks */}
      {loading ? (
        <div className="text-center py-12 text-white/50">{t.loading}</div>
      ) : playbooks.length === 0 ? (
        <div className="spotlight-card p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8 text-white/30" />
          </div>
          <h3 className="font-display font-700 text-white">{t.empty}</h3>
          <p className="text-white/50 mt-2">{t.emptyHint}</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {playbooks.map((playbook) => (
            <PlaybookCard
              key={playbook.id}
              playbook={playbook}
              definitions={definitions}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onEdit={() => {}}
              t={t}
            />
          ))}
        </div>
      )}
    </div>
  )
}
