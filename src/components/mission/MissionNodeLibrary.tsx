import { Bot, ChevronDown, ChevronLeft, LayoutGrid, MonitorPlay, Search } from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  MISSION_AUTOMATION_CATALOG,
  MISSION_AUTOMATION_CATEGORY_ORDER,
  getMissionAutomationCategoryLabel,
  searchMissionAutomationCatalog,
  type MissionAutomationCatalogEntry,
} from '@/constants/missionAutomationCatalog';
import type { AgentTemplate, MissionNodeKind } from '@/types/mission';
import { getMissionAgentVisual } from '@/utils/missionAgentVisuals';
import { getMissionToolNodeLabel } from '@/utils/missionHelpers';

export const MISSION_LIBRARY_DRAG_MIME = 'application/nexus-mission-library';

export type MissionLibraryDragPayload =
  | { source: 'agent'; templateId: string }
  | {
      source: 'tool';
      toolKind: Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission' | 'drawing'>;
    }
  | { source: 'automation'; catalogId: string };

type LibraryTabId = 'agents' | 'display' | 'nodes';

const LIBRARY_HINT_DELAY_MS = 500;

const LEADERSHIP_AGENT_TEMPLATE_IDS = new Set([
  'tpl-ceo',
  'tpl-cto',
  'tpl-cfo',
  'tpl-cmo',
  'tpl-coo',
  'tpl-cpo',
]);

const DISPLAY_NODE_DESCRIPTIONS: Record<
  Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission' | 'drawing'>,
  string
> = {
  browser: 'Preview ao vivo de páginas web no grafo.',
  emulator: 'Preview ao vivo do emulador mobile no grafo.',
  terminal: 'Terminal embutido para ver comandos e logs.',
  api: 'Painel de API para testar requests no grafo.',
  note: 'Nota markdown que agents Live podem ler e escrever.',
};

function isLeadershipAgentTemplate(templateId: string): boolean {
  return LEADERSHIP_AGENT_TEMPLATE_IDS.has(templateId);
}

const AUTOMATION_HINTS_BY_ID: Record<string, string> = {
  'trigger.manual': 'Inicia o fluxo sob demanda.',
  'trigger.webhook': 'Inicia o fluxo ao receber um webhook HTTP.',
  'trigger.schedule': 'Inicia o fluxo em horários definidos (cron).',
  'trigger.interval': 'Inicia o fluxo a cada intervalo de tempo.',
  'trigger.app_event': 'Inicia o fluxo quando um evento do app ocorre.',
  'trigger.database_event': 'Inicia o fluxo em mudanças no banco.',
  'trigger.file_changed': 'Inicia o fluxo quando arquivos mudam.',
  'trigger.git_push': 'Inicia o fluxo após um git push.',
  'trigger.pull_request': 'Inicia o fluxo em eventos de pull request.',
  'trigger.issue_created': 'Inicia o fluxo quando uma issue é criada.',
  'trigger.message_received': 'Inicia o fluxo ao receber uma mensagem.',
  'trigger.email_received': 'Inicia o fluxo ao receber um e-mail.',
  'trigger.form_submitted': 'Inicia o fluxo quando um formulário é enviado.',
  'flow.if': 'Segue caminhos diferentes conforme uma condição.',
  'flow.switch': 'Escolhe um caminho com base em um valor.',
  'flow.router': 'Encaminha o fluxo para rotas específicas.',
  'flow.merge': 'Une vários caminhos em um só.',
  'flow.split': 'Divide o fluxo em vários caminhos.',
  'flow.fork': 'Cria ramos paralelos a partir daqui.',
  'flow.join': 'Aguarda ramos paralelos antes de seguir.',
  'flow.parallel': 'Executa passos em paralelo.',
  'flow.loop': 'Repete um bloco um número de vezes.',
  'flow.for_each': 'Repete o fluxo para cada item da lista.',
  'flow.while': 'Repete enquanto a condição for verdadeira.',
  'flow.wait': 'Pausa o fluxo até uma condição ou sinal.',
  'flow.delay': 'Aguarda um tempo antes de continuar.',
  'flow.retry': 'Tenta de novo se o passo anterior falhar.',
  'flow.stop': 'Encerra o fluxo neste ponto.',
  'flow.continue': 'Segue para o próximo passo sem bloquear.',
  'flow.fallback': 'Caminho alternativo se algo falhar.',
  'flow.error_handler': 'Trata erros do fluxo.',
  'flow.try_catch': 'Tenta um bloco e captura falhas.',
  'flow.rate_limit': 'Limita a frequência de execução.',
  'human.approval': 'Pede aprovação humana para continuar.',
  'human.input': 'Solicita uma entrada do usuário.',
  'human.review_required': 'Exige revisão humana antes de seguir.',
  'human.confirmation': 'Pede confirmação simples do usuário.',
  'human.manual_intervention': 'Pausa para intervenção manual.',
  'human.assign_person': 'Atribui a tarefa a uma pessoa.',
  'http.request': 'Faz uma requisição HTTP para uma URL.',
  'http.rest_api': 'Chama um endpoint REST.',
  'http.graphql': 'Executa uma query GraphQL.',
  'http.webhook_response': 'Responde a um webhook recebido.',
  'http.download_file': 'Baixa um arquivo via HTTP.',
  'http.upload_file': 'Envia um arquivo via HTTP.',
  'http.oauth_request': 'Obtém token OAuth para APIs.',
  'code.javascript': 'Executa código JavaScript no fluxo.',
  'code.typescript': 'Executa lógica TypeScript no fluxo.',
  'code.python': 'Executa código Python no fluxo.',
  'code.shell': 'Roda um comando no shell do projeto.',
  'code.custom': 'Executa código customizado.',
  'code.expression': 'Avalia uma expressão e passa o resultado.',
  'code.json_transform': 'Transforma dados JSON no fluxo.',
};

const AUTOMATION_HINTS_BY_CATEGORY: Record<string, string> = {
  triggers: 'Dispara o início do fluxo.',
  flow: 'Controla o caminho e a ordem do fluxo.',
  human: 'Inclui uma etapa humana no fluxo.',
  http: 'Troca dados com APIs HTTP.',
  code: 'Executa código ou comandos.',
  data: 'Transforma, filtra ou organiza dados.',
  brain: 'Lê ou grava contexto e memória da missão.',
  database: 'Opera dados em banco.',
  git: 'Executa ações de Git/GitHub.',
  engineering: 'Roda checagens de engenharia (lint, test, build).',
  deploy: 'Cuida de build, release ou deploy.',
  browser: 'Controla ações no navegador.',
  emulator: 'Controla ações no emulador mobile.',
  messaging: 'Envia ou recebe mensagens.',
  email: 'Envia ou processa e-mails.',
  project: 'Gerencia itens de projeto/tarefas.',
  docs: 'Lê ou atualiza documentação.',
  spreadsheet: 'Opera planilhas.',
  storage: 'Lê ou grava arquivos em storage.',
  security: 'Aplica checagens ou regras de segurança.',
  notifications: 'Envia notificações.',
  payments: 'Opera pagamentos e cobranças.',
  monitoring: 'Monitora métricas ou alertas.',
  forms: 'Lida com formulários.',
  calendar: 'Opera eventos de calendário.',
  search: 'Busca informações.',
  files: 'Lê, escreve ou move arquivos.',
  media: 'Processa mídia (imagem, áudio, vídeo).',
  nexus: 'Usa recursos internos do Nexus.',
  visualization: 'Exibe ou monta visualizações.',
};

function getAutomationDescription(entry: MissionAutomationCatalogEntry): string {
  const byId = AUTOMATION_HINTS_BY_ID[entry.id];
  if (byId) {
    return byId;
  }

  if (entry.provider) {
    const action =
      entry.actions?.find((item) => item.value === entry.action)?.label ??
      entry.action ??
      'ação';
    return `${entry.label}: ${action} via ${entry.provider}.`;
  }

  const byCategory = AUTOMATION_HINTS_BY_CATEGORY[entry.category];
  if (byCategory) {
    return `${entry.label}: ${byCategory}`;
  }

  return entry.label;
}

interface MissionNodeLibraryProps {
  templates: AgentTemplate[];
  onAddAgent: (templateId: string) => void;
  onAddTool: (
    kind: Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission' | 'drawing'>,
  ) => void;
  onAddAutomation: (entry: MissionAutomationCatalogEntry) => void;
  onHide?: () => void;
}

function parseLibraryDragPayload(raw: string): MissionLibraryDragPayload | null {
  try {
    const parsed = JSON.parse(raw) as MissionLibraryDragPayload;
    if (!parsed || typeof parsed !== 'object' || !('source' in parsed)) {
      return null;
    }
    if (parsed.source === 'agent' && typeof parsed.templateId === 'string') {
      return parsed;
    }
    if (
      parsed.source === 'tool' &&
      (parsed.toolKind === 'browser' ||
        parsed.toolKind === 'emulator' ||
        parsed.toolKind === 'terminal' ||
        parsed.toolKind === 'api' ||
        parsed.toolKind === 'note')
    ) {
      return parsed;
    }
    if (parsed.source === 'automation' && typeof parsed.catalogId === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function readMissionLibraryDragPayload(
  dataTransfer: DataTransfer,
): MissionLibraryDragPayload | null {
  const raw = dataTransfer.getData(MISSION_LIBRARY_DRAG_MIME);
  if (!raw) {
    return null;
  }
  return parseLibraryDragPayload(raw);
}

function startLibraryDrag(event: DragEvent, payload: MissionLibraryDragPayload): void {
  event.dataTransfer.setData(MISSION_LIBRARY_DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = 'copy';
}

function LibraryTile({
  label,
  description,
  accent,
  accentSoft,
  accentBorder,
  icon: Icon,
  onClick,
  onDragStart,
}: {
  label: string;
  description: string;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  icon: typeof Bot;
  onClick: () => void;
  onDragStart: (event: DragEvent) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<number | null>(null);
  const [hint, setHint] = useState<{ text: string; top: number; left: number } | null>(null);

  const clearHintTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const hideHint = useCallback(() => {
    clearHintTimer();
    setHint(null);
  }, [clearHintTimer]);

  const showHintSoon = useCallback(() => {
    clearHintTimer();
    timerRef.current = window.setTimeout(() => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect || !description.trim()) {
        return;
      }
      const left = Math.min(
        Math.max(12, rect.left + rect.width / 2),
        window.innerWidth - 12,
      );
      const top = Math.max(12, rect.top - 10);
      setHint({ text: description, top, left });
    }, LIBRARY_HINT_DELAY_MS);
  }, [clearHintTimer, description]);

  useEffect(() => () => clearHintTimer(), [clearHintTimer]);

  const style = {
    '--mission-node-accent': accent,
    '--mission-node-accent-soft': accentSoft,
    '--mission-node-accent-border': accentBorder,
  } as CSSProperties;

  return (
    <>
      <button
        ref={buttonRef}
        type='button'
        className='mission-node-library__tile app-button app-button--enter'
        style={style}
        aria-label={`${label}. ${description}`}
        draggable
        onClick={onClick}
        onDragStart={(event) => {
          hideHint();
          onDragStart(event);
        }}
        onMouseEnter={showHintSoon}
        onMouseLeave={hideHint}
        onFocus={showHintSoon}
        onBlur={hideHint}
      >
        <span className='mission-node-library__tile-icon' aria-hidden='true'>
          <Icon size={22} strokeWidth={1.75} />
        </span>
        <span className='mission-node-library__tile-label'>{label}</span>
      </button>
      {hint
        ? createPortal(
            <div
              className='mission-node-library__hint overlay-popup--in'
              role='tooltip'
              style={{ top: hint.top, left: hint.left }}
            >
              <strong className='mission-node-library__hint-title'>{label}</strong>
              <span className='mission-node-library__hint-text'>{hint.text}</span>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function LibrarySection({
  id,
  label,
  count,
  open,
  onToggle,
  children,
}: {
  id: string;
  label: string;
  count: number;
  open: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  const handleToggle = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      onToggle(id);
    },
    [id, onToggle],
  );

  return (
    <div
      className={`mission-node-library__section${open ? ' mission-node-library__section--open' : ' mission-node-library__section--collapsed'}`}
    >
      <button
        type='button'
        className='mission-node-library__section-toggle app-button'
        aria-expanded={open}
        aria-controls={`mission-library-section-${id}`}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={handleToggle}
      >
        <span className='mission-node-library__section-title'>
          {label} <span className='mission-node-library__section-count'>({count})</span>
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2.25}
          className={`mission-node-library__section-chevron${
            open ? ' mission-node-library__section-chevron--open' : ''
          }`}
          aria-hidden='true'
        />
      </button>
      <div
        id={`mission-library-section-${id}`}
        className={`mission-node-library__section-body${
          open
            ? ' mission-node-library__section-body--open'
            : ' mission-node-library__section-body--closed'
        }`}
        aria-hidden={!open}
      >
        <div className='mission-node-library__section-body-inner'>{children}</div>
      </div>
    </div>
  );
}

function MissionNodeLibraryComponent({
  templates,
  onAddAgent,
  onAddTool,
  onAddAutomation,
  onHide,
}: MissionNodeLibraryProps) {
  const [tab, setTab] = useState<LibraryTabId>('agents');
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    specialists: true,
    leadership: true,
    display: true,
  });

  const agentItems = useMemo(
    () =>
      templates
        .filter((template) => template.id !== 'tpl-custom')
        .filter((template) => {
          if (!query.trim()) {
            return true;
          }
          const needle = query.trim().toLowerCase();
          return (
            template.name.toLowerCase().includes(needle) ||
            template.description.toLowerCase().includes(needle)
          );
        })
        .map((template) => {
          const visual = getMissionAgentVisual({
            agentTemplateId: template.id,
            roleId: template.defaultRoleId,
          });
          return { template, visual };
        }),
    [query, templates],
  );

  const specialistAgents = useMemo(
    () => agentItems.filter((item) => !isLeadershipAgentTemplate(item.template.id)),
    [agentItems],
  );

  const leadershipAgents = useMemo(
    () => agentItems.filter((item) => isLeadershipAgentTemplate(item.template.id)),
    [agentItems],
  );

  const displayItems = useMemo(() => {
    const kinds: Array<
      Exclude<MissionNodeKind, 'agent' | 'automation' | 'mission' | 'drawing'>
    > = ['browser', 'emulator', 'terminal', 'api', 'note'];
    return kinds
      .map((kind) => {
        const visual = getMissionAgentVisual({ kind });
        return { kind, visual, label: getMissionToolNodeLabel(kind) };
      })
      .filter((item) => {
        if (!query.trim()) {
          return true;
        }
        return item.label.toLowerCase().includes(query.trim().toLowerCase());
      });
  }, [query]);

  const automationGroups = useMemo(() => {
    const filtered = query.trim()
      ? searchMissionAutomationCatalog(query)
      : MISSION_AUTOMATION_CATALOG;
    const byCategory = new Map<string, MissionAutomationCatalogEntry[]>();
    for (const entry of filtered) {
      const list = byCategory.get(entry.category) ?? [];
      list.push(entry);
      byCategory.set(entry.category, list);
    }
    return MISSION_AUTOMATION_CATEGORY_ORDER.map((category) => ({
      category,
      label: getMissionAutomationCategoryLabel(category),
      entries: byCategory.get(category) ?? [],
    })).filter((group) => group.entries.length > 0);
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') {
        return;
      }
      event.preventDefault();
      const input = searchInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (tab !== 'nodes' || automationGroups.length === 0) {
      return;
    }
    setOpenSections((current) => {
      if (Object.keys(current).some((key) => key.startsWith('auto:') && current[key])) {
        return current;
      }
      return {
        ...current,
        [`auto:${automationGroups[0].category}`]: true,
      };
    });
  }, [automationGroups, tab]);

  useEffect(() => {
    if (!query.trim()) {
      return;
    }
    setOpenSections((current) => {
      const next = { ...current };
      if (specialistAgents.length > 0) {
        next.specialists = true;
      }
      if (leadershipAgents.length > 0) {
        next.leadership = true;
      }
      if (displayItems.length > 0) {
        next.display = true;
      }
      for (const group of automationGroups) {
        next[`auto:${group.category}`] = true;
      }
      return next;
    });
  }, [
    automationGroups,
    displayItems.length,
    leadershipAgents.length,
    query,
    specialistAgents.length,
  ]);

  const toggleSection = useCallback((id: string) => {
    setOpenSections((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }, []);

  const tabs: Array<{ id: LibraryTabId; label: string; icon: typeof Bot }> = [
    { id: 'agents', label: 'Agents', icon: Bot },
    { id: 'display', label: 'Display', icon: MonitorPlay },
    { id: 'nodes', label: 'Nós', icon: LayoutGrid },
  ];

  const isSearching = Boolean(query.trim());
  const showAgents = isSearching || tab === 'agents';
  const showDisplay = isSearching || tab === 'display';
  const showNodes = isSearching || tab === 'nodes';
  const hasAnyResults =
    specialistAgents.length > 0 ||
    leadershipAgents.length > 0 ||
    displayItems.length > 0 ||
    automationGroups.length > 0;

  const renderAgentTiles = (
    items: typeof agentItems,
  ) => (
    <div className='mission-node-library__grid'>
      {items.map(({ template, visual }) => {
        const Icon = visual.icon;
        return (
          <LibraryTile
            key={template.id}
            label={template.name}
            description={template.description}
            accent={visual.accent}
            accentSoft={visual.accentSoft}
            accentBorder={visual.accentBorder}
            icon={Icon}
            onClick={() => onAddAgent(template.id)}
            onDragStart={(event) =>
              startLibraryDrag(event, {
                source: 'agent',
                templateId: template.id,
              })
            }
          />
        );
      })}
    </div>
  );

  return (
    <aside className='mission-node-library overlay-popup--in app-button--enter' aria-label='Biblioteca de nós'>
      <div className='mission-node-library__header'>
        <div className='mission-node-library__segment' role='tablist' aria-label='Tipo de componente'>
          {tabs.map((entry) => {
            const Icon = entry.icon;
            const active = !isSearching && tab === entry.id;
            const matchCount =
              entry.id === 'agents'
                ? agentItems.length
                : entry.id === 'display'
                  ? displayItems.length
                  : automationGroups.reduce((sum, group) => sum + group.entries.length, 0);
            return (
              <button
                key={entry.id}
                type='button'
                role='tab'
                aria-selected={active}
                className={`mission-node-library__segment-btn app-button${
                  active ? ' mission-node-library__segment-btn--active app-button--enter' : ''
                }${isSearching && matchCount > 0 ? ' mission-node-library__segment-btn--match' : ''}`}
                onClick={() => setTab(entry.id)}
              >
                <Icon size={14} strokeWidth={2.25} aria-hidden='true' />
                <span>{entry.label}</span>
                {isSearching ? (
                  <span className='mission-node-library__segment-count'>{matchCount}</span>
                ) : null}
              </button>
            );
          })}
        </div>
        {onHide ? (
          <button
            type='button'
            className='mission-node-library__hide app-button app-button--enter'
            aria-label='Ocultar biblioteca'
            title='Ocultar biblioteca'
            onClick={onHide}
          >
            <ChevronLeft size={14} strokeWidth={2.25} aria-hidden='true' />
          </button>
        ) : null}
      </div>

      <div className='mission-node-library__search'>
        <Search size={14} strokeWidth={2.25} aria-hidden='true' />
        <input
          ref={searchInputRef}
          className='mission-node-library__search-input'
          value={query}
          placeholder='Buscar em Agents, Display e Nós...'
          aria-label='Buscar na biblioteca'
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      <div className='mission-node-library__body'>
        {isSearching && !hasAnyResults ? (
          <div className='mission-node-library__empty'>Nenhum resultado encontrado</div>
        ) : null}

        {showAgents && !isSearching && agentItems.length === 0 ? (
          <div className='mission-node-library__empty'>Nenhum agent encontrado</div>
        ) : null}

        {showAgents && (specialistAgents.length > 0 || leadershipAgents.length > 0) ? (
          <div className='mission-node-library__groups'>
            {specialistAgents.length > 0 ? (
              <LibrarySection
                id='specialists'
                label={isSearching ? 'Agents · Especialistas' : 'Especialistas'}
                count={specialistAgents.length}
                open={Boolean(openSections.specialists)}
                onToggle={toggleSection}
              >
                {renderAgentTiles(specialistAgents)}
              </LibrarySection>
            ) : null}
            {leadershipAgents.length > 0 ? (
              <LibrarySection
                id='leadership'
                label={isSearching ? 'Agents · Liderança' : 'Liderança'}
                count={leadershipAgents.length}
                open={Boolean(openSections.leadership)}
                onToggle={toggleSection}
              >
                {renderAgentTiles(leadershipAgents)}
              </LibrarySection>
            ) : null}
          </div>
        ) : null}

        {showDisplay && !isSearching && displayItems.length === 0 ? (
          <div className='mission-node-library__empty'>Nenhum display encontrado</div>
        ) : null}

        {showDisplay && displayItems.length > 0 ? (
          <LibrarySection
            id='display'
            label='Display'
            count={displayItems.length}
            open={Boolean(openSections.display)}
            onToggle={toggleSection}
          >
            <div className='mission-node-library__grid'>
              {displayItems.map(({ kind, visual, label }) => {
                const Icon = visual.icon;
                return (
                  <LibraryTile
                    key={kind}
                    label={label}
                    description={DISPLAY_NODE_DESCRIPTIONS[kind]}
                    accent={visual.accent}
                    accentSoft={visual.accentSoft}
                    accentBorder={visual.accentBorder}
                    icon={Icon}
                    onClick={() => onAddTool(kind)}
                    onDragStart={(event) =>
                      startLibraryDrag(event, { source: 'tool', toolKind: kind })
                    }
                  />
                );
              })}
            </div>
          </LibrarySection>
        ) : null}

        {showNodes && !isSearching && automationGroups.length === 0 ? (
          <div className='mission-node-library__empty'>Nenhum nó encontrado</div>
        ) : null}

        {showNodes && automationGroups.length > 0 ? (
          <div className='mission-node-library__groups'>
            {automationGroups.map((group) => {
              const sectionId = `auto:${group.category}`;
              return (
                <LibrarySection
                  key={group.category}
                  id={sectionId}
                  label={isSearching ? `Nós · ${group.label}` : group.label}
                  count={group.entries.length}
                  open={Boolean(openSections[sectionId])}
                  onToggle={toggleSection}
                >
                  <div className='mission-node-library__grid'>
                    {group.entries.map((entry) => {
                      const visual = getMissionAgentVisual({
                        kind: 'automation',
                        automationCategory: entry.category,
                      });
                      const Icon = visual.icon;
                      return (
                        <LibraryTile
                          key={entry.id}
                          label={entry.label}
                          description={getAutomationDescription(entry)}
                          accent={visual.accent}
                          accentSoft={visual.accentSoft}
                          accentBorder={visual.accentBorder}
                          icon={Icon}
                          onClick={() => onAddAutomation(entry)}
                          onDragStart={(event) =>
                            startLibraryDrag(event, {
                              source: 'automation',
                              catalogId: entry.id,
                            })
                          }
                        />
                      );
                    })}
                  </div>
                </LibrarySection>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export const MissionNodeLibrary = memo(MissionNodeLibraryComponent);
