import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  BarChart3,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  Gavel,
  GripVertical,
  Layers,
  RotateCcw,
  SlidersHorizontal,
  Terminal,
  Trophy,
} from 'lucide-react'
import { authAPI, logsAPI } from '../services/api'
import { useAuthStore, useGuildStore } from '../stores'
import { useI18n } from '../i18n'

const WIDGET_ORDER = [
  'warnings_total',
  'active_warnings',
  'warning_points',
  'logs_total',
  'bans_total',
  'timeouts_total',
  'kicks_total',
  'commands_used',
  'custom_commands',
  'modules_enabled',
  'mod_actions_chart',
  'top_offenders_list',
  'top_modules_list',
  'top_commands_list',
]

const DEFAULT_VISIBLE = [
  'warnings_total',
  'active_warnings',
  'warning_points',
  'logs_total',
  'bans_total',
  'timeouts_total',
  'commands_used',
  'modules_enabled',
  'mod_actions_chart',
  'top_offenders_list',
]

const WIDE_WIDGETS = new Set([
  'mod_actions_chart',
  'top_offenders_list',
  'top_modules_list',
  'top_commands_list',
])

const COPY = {
  fr: {
    subtitle: '30 derniers jours',
    customize: 'Personnaliser',
    customizeClose: 'Fermer',
    reset: 'Réinitialiser',
    saved: 'Sauvegarde auto par compte',
    dragHint: 'Glisse les blocs, ils se rangent automatiquement sur la grille.',
    toggleHint: 'Active seulement les blocs utiles pour ton analytics.',
    visible: 'Visible',
    hidden: 'Masqué',
    noWidget: 'Aucun bloc affiché',
    noWidgetBody: 'Réactive au moins un bloc pour revoir tes analytics.',
    widgetsTitle: 'Blocs disponibles',
    emptyList: 'Aucune donnée',
    total: 'total',
    uses: 'utilisations',
    points: 'pts',
    enabled: 'actifs',
    actions: 'actions',
    topCommand: 'Commande top',
    topModule: 'Module top',
    topOffender: 'Plus sanctionné',
    widgets: {
      warnings_total: 'Avertissements',
      active_warnings: 'Avertissements actifs',
      warning_points: 'Points de sanction',
      logs_total: 'Logs du bot',
      bans_total: 'Bannissements',
      timeouts_total: 'Timeouts',
      kicks_total: 'Expulsions',
      commands_used: 'Commandes utilisées',
      custom_commands: 'Commandes créées',
      modules_enabled: 'Modules actifs',
      mod_actions_chart: 'Répartition des sanctions',
      top_offenders_list: 'Membres les plus sanctionnés',
      top_modules_list: 'Modules les plus actifs',
      top_commands_list: 'Commandes les plus utilisées',
    },
  },
  en: {
    subtitle: 'last 30 days',
    customize: 'Customize',
    customizeClose: 'Close',
    reset: 'Reset',
    saved: 'Auto-saved for this account',
    dragHint: 'Drag blocks and they snap back cleanly into the grid.',
    toggleHint: 'Keep only the blocks you really want on this analytics view.',
    visible: 'Visible',
    hidden: 'Hidden',
    noWidget: 'No widget visible',
    noWidgetBody: 'Enable at least one block to show your analytics again.',
    widgetsTitle: 'Available blocks',
    emptyList: 'No data',
    total: 'total',
    uses: 'uses',
    points: 'pts',
    enabled: 'enabled',
    actions: 'actions',
    topCommand: 'Top command',
    topModule: 'Top module',
    topOffender: 'Most sanctioned',
    widgets: {
      warnings_total: 'Warnings',
      active_warnings: 'Active warnings',
      warning_points: 'Warning points',
      logs_total: 'Bot logs',
      bans_total: 'Bans',
      timeouts_total: 'Timeouts',
      kicks_total: 'Kicks',
      commands_used: 'Commands used',
      custom_commands: 'Commands created',
      modules_enabled: 'Enabled modules',
      mod_actions_chart: 'Sanction breakdown',
      top_offenders_list: 'Most sanctioned members',
      top_modules_list: 'Most active modules',
      top_commands_list: 'Most used commands',
    },
  },
  es: {
    subtitle: 'ultimos 30 dias',
    customize: 'Personalizar',
    customizeClose: 'Cerrar',
    reset: 'Restablecer',
    saved: 'Guardado automatico por cuenta',
    dragHint: 'Arrastra los bloques y se recolocan solos en la cuadricula.',
    toggleHint: 'Activa solo los bloques utiles para tus analiticas.',
    visible: 'Visible',
    hidden: 'Oculto',
    noWidget: 'Ningun bloque visible',
    noWidgetBody: 'Activa al menos un bloque para volver a mostrar las analiticas.',
    widgetsTitle: 'Bloques disponibles',
    emptyList: 'Sin datos',
    total: 'total',
    uses: 'usos',
    points: 'pts',
    enabled: 'activos',
    actions: 'acciones',
    topCommand: 'Comando top',
    topModule: 'Modulo top',
    topOffender: 'Mas sancionado',
    widgets: {
      warnings_total: 'Advertencias',
      active_warnings: 'Advertencias activas',
      warning_points: 'Puntos de sancion',
      logs_total: 'Logs del bot',
      bans_total: 'Baneos',
      timeouts_total: 'Timeouts',
      kicks_total: 'Expulsiones',
      commands_used: 'Comandos usados',
      custom_commands: 'Comandos creados',
      modules_enabled: 'Modulos activos',
      mod_actions_chart: 'Reparto de sanciones',
      top_offenders_list: 'Miembros mas sancionados',
      top_modules_list: 'Modulos mas activos',
      top_commands_list: 'Comandos mas usados',
    },
  },
}

function normalizeLayout(layout) {
  const baseOrder = [...WIDGET_ORDER];
  const rawOrder = Array.isArray(layout?.order) ? layout.order : baseOrder;
  const rawVisible = Array.isArray(layout?.visible) ? layout.visible : DEFAULT_VISIBLE;

  const order = [];
  rawOrder.forEach((id) => {
    if (WIDGET_ORDER.includes(id) && !order.includes(id)) order.push(id);
  });
  baseOrder.forEach((id) => {
    if (!order.includes(id)) order.push(id);
  });

  const visible = [];
  rawVisible.forEach((id) => {
    if (order.includes(id) && !visible.includes(id)) visible.push(id);
  });

  return {
    version: 1,
    order,
    visible,
  };
}

function arrayMove(items, fromIndex, toIndex) {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function formatCategoryName(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim() || '-';
}

function formatCommandTrigger(command) {
  if (!command) return '-';
  const commandType = command.command_type || 'prefix';
  const commandName = String(command.command_name || '').trim();
  const trigger = String(command.trigger || '').trim();

  if (commandType === 'slash') {
    return `/${commandName || trigger.replace(/^\/+/, '') || 'command'}`;
  }

  const prefix = String(command.command_prefix || '').trim();
  if (prefix && commandName) return `${prefix} ${commandName}`.trim();
  return trigger || `${prefix} ${commandName}`.trim() || '!';
}

function WidgetToggle({ label, visible, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-all ${
        visible
          ? 'bg-neon-cyan/[0.07] border-neon-cyan/30'
          : 'bg-white/[0.03] border-white/[0.08] hover:border-white/15'
      }`}
    >
      <span className="text-sm text-white">{label}</span>
      <span className={`inline-flex items-center gap-1.5 text-xs font-mono ${visible ? 'text-neon-cyan' : 'text-white/35'}`}>
        {visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}

function StatWidget({ widget, dragged, onDragStart, onDragEnter, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(widget.id)}
      onDragEnter={() => onDragEnter(widget.id)}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      className={`glass-card p-5 border transition-all cursor-grab active:cursor-grabbing select-none ${
        dragged ? 'border-neon-cyan/35 bg-neon-cyan/[0.05] scale-[0.985] opacity-75' : 'border-white/[0.08] hover:border-neon-cyan/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl ${widget.iconBg}`}>
            <widget.icon className={`w-4 h-4 ${widget.iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-mono text-white/45 uppercase tracking-wider truncate">{widget.label}</p>
            {widget.hint ? <p className="text-xs text-white/28 truncate mt-1">{widget.hint}</p> : null}
          </div>
        </div>
        <GripVertical className="w-4 h-4 text-white/18 shrink-0" />
      </div>
      <div className="space-y-1">
        <p className="text-3xl font-display font-800 text-white">{widget.value}</p>
        {widget.meta ? <p className="text-xs text-white/35">{widget.meta}</p> : null}
      </div>
      <div className="mt-5 h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div className={`h-full rounded-full ${widget.barClass}`} style={{ width: widget.barWidth }} />
      </div>
    </div>
  );
}

function ListWidget({ widget, dragged, onDragStart, onDragEnter, onDragEnd }) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(widget.id)}
      onDragEnter={() => onDragEnter(widget.id)}
      onDragOver={(event) => event.preventDefault()}
      onDragEnd={onDragEnd}
      className={`glass-card p-5 border transition-all cursor-grab active:cursor-grabbing select-none md:col-span-2 ${
        dragged ? 'border-neon-cyan/35 bg-neon-cyan/[0.05] scale-[0.99] opacity-75' : 'border-white/[0.08] hover:border-neon-cyan/20'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2.5 rounded-xl ${widget.iconBg}`}>
            <widget.icon className={`w-4 h-4 ${widget.iconColor}`} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-display font-700 text-white truncate">{widget.label}</p>
            <p className="text-xs text-white/35 mt-1">{widget.meta}</p>
          </div>
        </div>
        <GripVertical className="w-4 h-4 text-white/18 shrink-0" />
      </div>

      {widget.items.length === 0 ? (
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-sm text-white/30">
          {widget.empty}
        </div>
      ) : (
        <div className="space-y-3">
          {widget.items.map((item, index) => (
            <div key={item.id || `${widget.id}-${index}`} className="flex items-center gap-3">
              <span className="text-xs font-mono text-white/25 w-4 shrink-0">{index + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-white truncate">{item.label}</p>
                  <span className="text-xs font-mono text-white/45 shrink-0">{item.value}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-white/[0.05] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-neon-cyan to-neon-violet transition-all duration-300"
                    style={{ width: `${item.width}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function buildWidgets(analytics, locale, copy) {
  const actionTotals = analytics?.actionTotals || {};
  const warningTotal = Number(analytics?.warnings?.total || 0);
  const warningPoints = Number(analytics?.warnings?.totalPoints || 0);
  const activeWarnings = Number(analytics?.warnings?.active || 0);
  const logsTotal = Number(analytics?.logs?.total || 0);
  const banTotal = Number(actionTotals.ban || 0);
  const timeoutTotal = Number(actionTotals.timeout || 0);
  const kickTotal = Number(actionTotals.kick || 0);
  const commandUses = Number(analytics?.commands?.totalUses || 0);
  const commandsTotal = Number(analytics?.commands?.total || 0);
  const enabledModules = Number(analytics?.modules?.enabled || 0);
  const totalModules = Number(analytics?.modules?.total || 0);
  const totalActions = Number(analytics?.actions?.total || 0);
  const topCommand = analytics?.commands?.topCommand || null;
  const topModule = analytics?.moduleActivity?.[0] || null;
  const topOffender = analytics?.topOffenders?.[0] || null;

  const maxAction = Math.max(...Object.values(actionTotals).map((value) => Number(value || 0)), 1);
  const maxOffender = Math.max(...(analytics?.topOffenders || []).map((entry) => Number(entry.total_points || 0)), 1);
  const maxModule = Math.max(...(analytics?.moduleActivity || []).map((entry) => Number(entry.count || 0)), 1);
  const maxCommand = Math.max(...(analytics?.commandUsage || []).map((entry) => Number(entry.use_count || 0)), 1);

  return {
    warnings_total: {
      id: 'warnings_total',
      type: 'stat',
      icon: AlertTriangle,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
      label: copy.widgets.warnings_total,
      value: warningTotal.toLocaleString(locale),
      meta: copy.subtitle,
      barClass: 'bg-gradient-to-r from-amber-400 to-red-400',
      barWidth: `${Math.min(100, Math.max(14, warningTotal * 8))}%`,
    },
    active_warnings: {
      id: 'active_warnings',
      type: 'stat',
      icon: Activity,
      iconBg: 'bg-red-500/10',
      iconColor: 'text-red-400',
      label: copy.widgets.active_warnings,
      value: activeWarnings.toLocaleString(locale),
      meta: copy.total,
      barClass: 'bg-gradient-to-r from-red-400 to-red-500',
      barWidth: `${Math.min(100, Math.max(14, activeWarnings * 10))}%`,
    },
    warning_points: {
      id: 'warning_points',
      type: 'stat',
      icon: Trophy,
      iconBg: 'bg-orange-500/10',
      iconColor: 'text-orange-400',
      label: copy.widgets.warning_points,
      value: warningPoints.toLocaleString(locale),
      meta: copy.points,
      barClass: 'bg-gradient-to-r from-orange-400 to-amber-400',
      barWidth: `${Math.min(100, Math.max(14, warningPoints * 4))}%`,
    },
    logs_total: {
      id: 'logs_total',
      type: 'stat',
      icon: FileText,
      iconBg: 'bg-neon-cyan/10',
      iconColor: 'text-neon-cyan',
      label: copy.widgets.logs_total,
      value: logsTotal.toLocaleString(locale),
      meta: copy.subtitle,
      barClass: 'bg-gradient-to-r from-neon-cyan to-blue-400',
      barWidth: `${Math.min(100, Math.max(14, logsTotal * 3))}%`,
    },
    bans_total: {
      id: 'bans_total',
      type: 'stat',
      icon: Ban,
      iconBg: 'bg-red-500/10',
      iconColor: 'text-red-400',
      label: copy.widgets.bans_total,
      value: banTotal.toLocaleString(locale),
      meta: copy.actions,
      barClass: 'bg-gradient-to-r from-red-500 to-red-300',
      barWidth: `${Math.min(100, Math.max(14, banTotal * 16))}%`,
    },
    timeouts_total: {
      id: 'timeouts_total',
      type: 'stat',
      icon: Clock3,
      iconBg: 'bg-blue-500/10',
      iconColor: 'text-blue-400',
      label: copy.widgets.timeouts_total,
      value: timeoutTotal.toLocaleString(locale),
      meta: copy.actions,
      barClass: 'bg-gradient-to-r from-blue-400 to-violet-400',
      barWidth: `${Math.min(100, Math.max(14, timeoutTotal * 16))}%`,
    },
    kicks_total: {
      id: 'kicks_total',
      type: 'stat',
      icon: Gavel,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
      label: copy.widgets.kicks_total,
      value: kickTotal.toLocaleString(locale),
      meta: copy.actions,
      barClass: 'bg-gradient-to-r from-amber-400 to-yellow-300',
      barWidth: `${Math.min(100, Math.max(14, kickTotal * 16))}%`,
    },
    commands_used: {
      id: 'commands_used',
      type: 'stat',
      icon: Terminal,
      iconBg: 'bg-neon-violet/10',
      iconColor: 'text-neon-violet',
      label: copy.widgets.commands_used,
      value: commandUses.toLocaleString(locale),
      meta: copy.uses,
      barClass: 'bg-gradient-to-r from-neon-violet to-fuchsia-400',
      barWidth: `${Math.min(100, Math.max(14, commandUses * 4))}%`,
    },
    custom_commands: {
      id: 'custom_commands',
      type: 'stat',
      icon: Terminal,
      iconBg: 'bg-white/[0.06]',
      iconColor: 'text-white/70',
      label: copy.widgets.custom_commands,
      value: commandsTotal.toLocaleString(locale),
      meta: copy.total,
      barClass: 'bg-gradient-to-r from-white/60 to-white/30',
      barWidth: `${Math.min(100, Math.max(14, commandsTotal * 10))}%`,
    },
    modules_enabled: {
      id: 'modules_enabled',
      type: 'stat',
      icon: Layers,
      iconBg: 'bg-green-500/10',
      iconColor: 'text-green-400',
      label: copy.widgets.modules_enabled,
      value: `${enabledModules.toLocaleString(locale)}/${totalModules.toLocaleString(locale)}`,
      meta: copy.enabled,
      barClass: 'bg-gradient-to-r from-green-400 to-neon-cyan',
      barWidth: `${totalModules > 0 ? Math.max(14, (enabledModules / totalModules) * 100) : 14}%`,
      hint: totalModules > 0 ? `${copy.topModule}: ${topModule ? formatCategoryName(topModule.category) : '-'}` : '',
    },
    mod_actions_chart: {
      id: 'mod_actions_chart',
      type: 'list',
      icon: BarChart3,
      iconBg: 'bg-neon-cyan/10',
      iconColor: 'text-neon-cyan',
      label: copy.widgets.mod_actions_chart,
      meta: `${totalActions.toLocaleString(locale)} ${copy.actions}`,
      empty: copy.emptyList,
      items: (analytics?.modActions || []).map((entry) => ({
        id: entry.action_type,
        label: formatCategoryName(entry.action_type),
        value: Number(entry.count || 0).toLocaleString(locale),
        width: Math.max(10, Math.round((Number(entry.count || 0) / maxAction) * 100)),
      })),
    },
    top_offenders_list: {
      id: 'top_offenders_list',
      type: 'list',
      icon: AlertTriangle,
      iconBg: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
      label: copy.widgets.top_offenders_list,
      meta: topOffender ? `${copy.topOffender}: ${topOffender.target_username || topOffender.target_user_id}` : copy.emptyList,
      empty: copy.emptyList,
      items: (analytics?.topOffenders || []).map((entry) => ({
        id: entry.target_user_id,
        label: entry.target_username || entry.target_user_id,
        value: `${Number(entry.total_points || 0).toLocaleString(locale)} ${copy.points}`,
        width: Math.max(10, Math.round((Number(entry.total_points || 0) / maxOffender) * 100)),
      })),
    },
    top_modules_list: {
      id: 'top_modules_list',
      type: 'list',
      icon: Layers,
      iconBg: 'bg-green-500/10',
      iconColor: 'text-green-400',
      label: copy.widgets.top_modules_list,
      meta: topModule ? `${copy.topModule}: ${formatCategoryName(topModule.category)}` : copy.emptyList,
      empty: copy.emptyList,
      items: (analytics?.moduleActivity || []).map((entry) => ({
        id: entry.category,
        label: formatCategoryName(entry.category),
        value: Number(entry.count || 0).toLocaleString(locale),
        width: Math.max(10, Math.round((Number(entry.count || 0) / maxModule) * 100)),
      })),
    },
    top_commands_list: {
      id: 'top_commands_list',
      type: 'list',
      icon: Terminal,
      iconBg: 'bg-neon-violet/10',
      iconColor: 'text-neon-violet',
      label: copy.widgets.top_commands_list,
      meta: topCommand ? `${copy.topCommand}: ${formatCommandTrigger(topCommand)}` : copy.emptyList,
      empty: copy.emptyList,
      items: (analytics?.commandUsage || []).map((entry) => ({
        id: entry.id || entry.trigger,
        label: formatCommandTrigger(entry),
        value: `${Number(entry.use_count || 0).toLocaleString(locale)} ${copy.uses}`,
        width: Math.max(10, Math.round((Number(entry.use_count || 0) / maxCommand) * 100)),
      })),
    },
  };
}

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const { guilds, selectedGuildId } = useGuildStore();
  const [analytics, setAnalytics] = useState(null);
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [layout, setLayout] = useState(() => normalizeLayout(null));
  const [draggedId, setDraggedId] = useState(null);
  const guild = guilds.find((entry) => entry.id === selectedGuildId);
  const copy = COPY[locale] || COPY.en;
  const hydratedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const layoutRef = useRef(layout);
  const draggedIdRef = useRef(null);
  const lastSavedSignatureRef = useRef(JSON.stringify(normalizeLayout(null)));

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    setLayout(normalizeLayout(user?.analytics_layout));
    lastSavedSignatureRef.current = JSON.stringify(normalizeLayout(user?.analytics_layout));
    hydratedRef.current = true;
  }, [user?.id, user?.analytics_layout]);

  useEffect(() => {
    if (!selectedGuildId) {
      setAnalytics(null);
      return;
    }

    setAnalytics(null);
    logsAPI.analytics(selectedGuildId)
      .then((response) => setAnalytics(response.data))
      .catch(() => setAnalytics({}));
  }, [selectedGuildId]);

  useEffect(() => {
    if (!hydratedRef.current || !user?.id) return undefined;

    const signature = JSON.stringify(layout);
    if (signature === lastSavedSignatureRef.current) return undefined;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await authAPI.updatePreferences({
          site_language: user?.site_language || 'auto',
          ai_language: user?.ai_language || 'auto',
          analytics_layout: layout,
        });
        if (JSON.stringify(layoutRef.current) === signature) {
          lastSavedSignatureRef.current = signature;
          if (response.data?.user) setUser(response.data.user);
        }
      } catch {
        // silent on purpose: the local layout still works and will retry on the next change
      }
    }, 350);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [layout, user?.id, user?.site_language, user?.ai_language, setUser]);

  const widgets = useMemo(() => buildWidgets(analytics, locale, copy), [analytics, locale, copy]);
  const visibleWidgets = useMemo(
    () => layout.order.filter((id) => layout.visible.includes(id)).map((id) => widgets[id]).filter(Boolean),
    [layout, widgets]
  );

  const toggleWidget = (widgetId) => {
    setLayout((current) => {
      const visible = current.visible.includes(widgetId)
        ? current.visible.filter((id) => id !== widgetId)
        : [...current.visible, widgetId];

      return {
        ...current,
        visible,
      };
    });
  };

  const resetLayout = () => {
    setLayout(normalizeLayout(null));
  };

  const moveWidget = (sourceId, targetId) => {
    if (!sourceId || !targetId || sourceId === targetId) return;

    setLayout((current) => {
      const visibleOrder = current.order.filter((id) => current.visible.includes(id));
      const sourceIndex = visibleOrder.indexOf(sourceId);
      const targetIndex = visibleOrder.indexOf(targetId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return current;

      const movedVisible = arrayMove(visibleOrder, sourceIndex, targetIndex);
      const hiddenOrder = current.order.filter((id) => !current.visible.includes(id));

      return {
        ...current,
        order: [...movedVisible, ...hiddenOrder],
      };
    });
  };

  const startDrag = (widgetId) => {
    draggedIdRef.current = widgetId;
    setDraggedId(widgetId);
  };

  const endDrag = () => {
    draggedIdRef.current = null;
    setDraggedId(null);
  };

  if (!selectedGuildId) {
    return (
      <div className="p-6 max-w-3xl mx-auto pt-24">
        <div className="glass-card p-10 text-center">
          <BarChart3 className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">{t('analytics.selectServerTitle', 'Choisis d abord un serveur')}</p>
          <p className="text-white/40 mt-2">
            {t('analytics.selectServerPrefix')} {t('layout.nav.servers')}
          </p>
          <Link to="/dashboard/servers" className="inline-flex items-center gap-2 mt-5 px-5 py-3 rounded-xl bg-neon-cyan/10 border border-neon-cyan/25 text-neon-cyan font-mono text-sm hover:bg-neon-cyan/20 transition-all">
            {t('analytics.selectServerAction', 'Choisir un serveur')}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div>
          <h1 className="font-display font-800 text-2xl text-white">{t('analytics.title')}</h1>
          <p className="text-white/40 text-sm mt-1">{guild?.name} - {copy.subtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCustomizer((current) => !current)}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-sm font-mono transition-all ${
              showCustomizer
                ? 'bg-neon-cyan/10 border-neon-cyan/30 text-neon-cyan'
                : 'bg-white/[0.03] border-white/[0.08] text-white/70 hover:border-neon-cyan/20 hover:text-white'
            }`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            {showCustomizer ? copy.customizeClose : copy.customize}
          </button>
          <button
            type="button"
            onClick={resetLayout}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.03] border border-white/[0.08] text-white/60 text-sm font-mono hover:text-white hover:border-white/15 transition-all"
          >
            <RotateCcw className="w-4 h-4" />
            {copy.reset}
          </button>
        </div>
      </div>

      {showCustomizer ? (
        <div className="glass-card p-5 border border-neon-cyan/15 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div>
              <p className="font-display font-700 text-white">{copy.widgetsTitle}</p>
              <p className="text-sm text-white/45 mt-1">{copy.toggleHint}</p>
            </div>
            <div className="text-xs font-mono text-neon-cyan/80">{copy.saved}</div>
          </div>

          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {WIDGET_ORDER.map((widgetId) => (
              <WidgetToggle
                key={widgetId}
                label={copy.widgets[widgetId]}
                visible={layout.visible.includes(widgetId)}
                onClick={() => toggleWidget(widgetId)}
              />
            ))}
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/40">
            {copy.dragHint}
          </div>
        </div>
      ) : null}

      {!analytics ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(8)].map((_, index) => (
            <div key={index} className={`rounded-2xl skeleton ${index > 4 ? 'h-64' : 'h-40'}`} />
          ))}
        </div>
      ) : visibleWidgets.length === 0 ? (
        <div className="glass-card p-10 text-center border border-white/[0.08]">
          <BarChart3 className="w-12 h-12 text-white/10 mx-auto mb-4" />
          <p className="font-display font-700 text-white text-xl">{copy.noWidget}</p>
          <p className="text-white/40 mt-2">{copy.noWidgetBody}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visibleWidgets.map((widget) => {
            if (!widget) return null;

            if (WIDE_WIDGETS.has(widget.id)) {
              return (
                <ListWidget
                  key={widget.id}
                  widget={widget}
                  dragged={draggedId === widget.id}
                  onDragStart={startDrag}
                  onDragEnter={(targetId) => moveWidget(draggedIdRef.current, targetId)}
                  onDragEnd={endDrag}
                />
              );
            }

            return (
              <StatWidget
                key={widget.id}
                widget={widget}
                dragged={draggedId === widget.id}
                onDragStart={startDrag}
                onDragEnter={(targetId) => moveWidget(draggedIdRef.current, targetId)}
                onDragEnd={endDrag}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
