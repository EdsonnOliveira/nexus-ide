import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { ArrowUp, Check, ChevronDown, ChevronRight, Square } from 'lucide-react';
import type { WebAgentSession, WebAgentTurn } from '../store';
import logoCursor from '../assets/logo-cursor.svg';
import { renderWebMarkdown } from './webMarkdown';
import { hydrateWebMarkdownImages } from './webHydrateMarkdownImages';
import { findMarkdownPreviewImage } from './downloadImageSrc';
import { WebMarkdownImageLightbox } from './WebMarkdownImageLightbox';
import { WebAskMenuSelect } from './WebAskMenuSelect';
import { WebAgentPlusMenu, type WebAgentMode } from './WebAgentPlusMenu';

interface WebAgentChatProps {
  agent: WebAgentSession;
  onFollowUp: (agentId: string, prompt: string) => boolean | Promise<boolean>;
  onStop: (agentId: string) => void;
  onModelChange: (agentId: string, modelId: string) => void;
  onModeChange: (agentId: string, modeId: WebAgentMode) => void;
}

const WEB_AGENT_MODELS = [
  { value: 'auto', label: 'Auto' },
  { value: 'composer-2', label: 'Composer 2' },
  { value: 'composer-2-fast', label: 'Composer 2 Fast' },
  { value: 'gpt-5.2', label: 'GPT-5.2' },
  { value: 'claude-4.5-sonnet', label: 'Claude 4.5 Sonnet' },
  { value: 'claude-4.6-sonnet-medium-thinking', label: 'Claude 4.6 Sonnet' },
] as const;

function formatThoughtDuration(ms: number): string {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

function ThoughtBlock({
  streaming,
  startedAt,
  endedAt,
  body,
}: {
  streaming: boolean;
  startedAt: number;
  endedAt?: number;
  body: string;
}) {
  const [expanded, setExpanded] = useState(streaming || !body);
  const [elapsed, setElapsed] = useState(1);

  useEffect(() => {
    if (!streaming) {
      return;
    }
    const tick = () => {
      setElapsed(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, streaming]);

  useEffect(() => {
    setExpanded(streaming);
  }, [streaming]);

  const title = streaming
    ? `Thinking ${elapsed}s`
    : `Thought for ${formatThoughtDuration((endedAt ?? Date.now()) - startedAt)}`;

  return (
    <div
      className={`agent-view__thought${streaming ? ' agent-view__thought--streaming' : ''}${
        expanded ? ' agent-view__thought--expanded' : ''
      }`}
    >
      <button
        type='button'
        className='agent-view__thought-header app-button'
        onClick={() => setExpanded((current) => !current)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span
          className={`agent-view__thought-title${
            streaming ? ' agent-view__thought-title--streaming' : ''
          }`}
        >
          {title}
        </span>
      </button>
      {expanded ? (
        <div className='agent-view__thought-body'>
          {body.trim() ? <div className='agent-view__thought-prose'>{body}</div> : null}
          {streaming && !body.trim() ? (
            <div className='agent-view__thought-waiting'>
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
              <span className='agent-view__thought-waiting-dot' aria-hidden='true' />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function findWebResponseInlineCode(element: EventTarget | null): HTMLElement | null {
  if (!(element instanceof HTMLElement)) {
    return null;
  }

  const code = element.closest('code');

  if (!code || code.classList.contains('hljs') || code.closest('pre')) {
    return null;
  }

  return code;
}

function ResponseBody({
  text,
  streaming,
  deviceId,
  projectId,
}: {
  text: string;
  streaming: boolean;
  deviceId: string | null;
  projectId: string | null;
}) {
  const rendered = useMemo(() => renderWebMarkdown(text), [text]);
  const [html, setHtml] = useState(rendered);
  const copiedTimeoutRef = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ src: string; fileName: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setHtml(rendered);

    void hydrateWebMarkdownImages(rendered, { deviceId, projectId }).then((hydrated) => {
      if (!cancelled) {
        setHtml(hydrated);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [rendered, deviceId, projectId]);

  const handleClick = useCallback(async (event: ReactMouseEvent<HTMLDivElement>) => {
    const image = findMarkdownPreviewImage(event.target);

    if (image) {
      event.preventDefault();
      event.stopPropagation();
      setPreview({
        src: image.currentSrc || image.src,
        fileName:
          image.getAttribute('data-image-ref') ||
          image.getAttribute('data-image-path') ||
          image.getAttribute('alt') ||
          null,
      });
      return;
    }

    const code = findWebResponseInlineCode(event.target);

    if (!code) {
      return;
    }

    const value = code.textContent?.trim() ?? '';

    if (!value) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(value);

      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }

      code.classList.add('markdown-preview__inline-code--copied');
      code.setAttribute('title', 'Copiado');

      copiedTimeoutRef.current = window.setTimeout(() => {
        code.classList.remove('markdown-preview__inline-code--copied');
        code.removeAttribute('title');
        copiedTimeoutRef.current = null;
      }, 1600);
    } catch {
      code.classList.remove('markdown-preview__inline-code--copied');
      code.removeAttribute('title');
    }
  }, []);

  return (
    <div
      className={`agent-view__response${
        streaming ? ' agent-view__response--streaming' : ' agent-view__response--settled'
      }`}
    >
      <div
        className='agent-view__response-body markdown-preview'
        onClick={(event) => void handleClick(event)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {preview ? (
        <WebMarkdownImageLightbox
          src={preview.src}
          fileName={preview.fileName}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  );
}

function TurnView({
  turn,
  deviceId,
  projectId,
}: {
  turn: WebAgentTurn;
  deviceId: string | null;
  projectId: string | null;
}) {
  const multiline = turn.prompt.includes('\n') || turn.prompt.length > 72;
  const running = turn.status === 'running';
  const showThought =
    running || Boolean(turn.thought) || Boolean(turn.response) || turn.status === 'error';
  const thoughtStreaming = running && (turn.thoughtStreaming || !turn.response.trim());
  const responseStreaming = running && Boolean(turn.response.trim());

  return (
    <div className='agent-view__turn app-button--enter'>
      <div className='agent-view__user-prompt'>
        <div
          className={`agent-view__user-bubble${
            multiline ? ' agent-view__user-bubble--multiline' : ''
          }`}
        >
          {turn.prompt}
        </div>
      </div>
      {showThought ? (
        <ThoughtBlock
          streaming={thoughtStreaming}
          startedAt={turn.createdAt}
          endedAt={turn.endedAt}
          body={turn.thought}
        />
      ) : null}
      {turn.response.trim() ? (
        <ResponseBody
          text={turn.response}
          streaming={responseStreaming}
          deviceId={deviceId}
          projectId={projectId}
        />
      ) : null}
      {turn.status === 'error' && !turn.response.trim() ? (
        <div className='agent-view__response agent-view__response--settled'>
          <div className='agent-view__response-body web-agent-error'>
            Falha ao executar o agent neste Mac.
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WebAgentChat({
  agent,
  onFollowUp,
  onStop,
  onModelChange,
  onModeChange,
}: WebAgentChatProps) {
  const [draft, setDraft] = useState('');
  const [sendingFollowUp, setSendingFollowUp] = useState(false);
  const followUpInFlightRef = useRef(false);
  const draftRef = useRef(draft);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const accent = agent.projectColor || '#8b5cf6';
  const canStop = agent.status === 'running' && !draft.trim() && !sendingFollowUp;
  const canSend = Boolean(draft.trim()) && !canStop && !sendingFollowUp;
  const modelId = agent.modelId || 'auto';
  const modeId = agent.modeId || 'agent';
  const modelLabel = WEB_AGENT_MODELS.find((item) => item.value === modelId)?.label ?? 'Auto';
  const modelList = useMemo(
    () => WEB_AGENT_MODELS.map((item) => ({ value: item.value, label: item.label })),
    [],
  );

  draftRef.current = draft;

  const modelOptions = useMemo(
    () =>
      WEB_AGENT_MODELS.map((item) => ({
        value: item.value,
        label: item.label,
        leading:
          item.value === modelId ? (
            <Check size={14} aria-hidden='true' />
          ) : (
            <img
              src={logoCursor}
              alt=''
              className='agent-view__composer-mode-icon'
              draggable={false}
            />
          ),
      })),
    [modelId],
  );

  const turns = useMemo(() => (agent.turns.length > 0 ? agent.turns : []), [agent.turns]);
  const stickToBottomRef = useRef(true);
  const lastTurnIdRef = useRef<string | null>(null);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }

    const atBottom = () =>
      node.scrollHeight - node.scrollTop - node.clientHeight <= 48;

    const handleScroll = () => {
      stickToBottomRef.current = atBottom();
    };

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY >= 0) {
        return;
      }

      window.requestAnimationFrame(() => {
        if (!atBottom()) {
          stickToBottomRef.current = false;
        }
      });
    };

    node.addEventListener('scroll', handleScroll, { passive: true });
    node.addEventListener('wheel', handleWheel, { passive: true });

    const content = node.firstElementChild;
    const observer =
      content instanceof HTMLElement
        ? new ResizeObserver(() => {
            if (!stickToBottomRef.current) {
              return;
            }
            node.scrollTop = node.scrollHeight;
          })
        : null;
    if (content instanceof HTMLElement && observer) {
      observer.observe(content);
    }

    return () => {
      node.removeEventListener('scroll', handleScroll);
      node.removeEventListener('wheel', handleWheel);
      observer?.disconnect();
    };
  }, [agent.id]);

  useEffect(() => {
    const node = transcriptRef.current;
    if (!node) {
      return;
    }

    const lastTurnId = turns[turns.length - 1]?.id ?? null;
    const previousTurnId = lastTurnIdRef.current;
    lastTurnIdRef.current = lastTurnId;

    if (lastTurnId && previousTurnId !== lastTurnId) {
      stickToBottomRef.current = true;
    }

    if (!stickToBottomRef.current) {
      return;
    }

    node.scrollTop = node.scrollHeight;
  }, [agent.turns, turns]);

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canStop) {
      onStop(agent.id);
      return;
    }
    if (followUpInFlightRef.current || sendingFollowUp) {
      return;
    }
    const text = draft.trim();
    if (!text) {
      return;
    }
    const snapshot = draft;
    followUpInFlightRef.current = true;
    setSendingFollowUp(true);
    setDraft('');
    void Promise.resolve(onFollowUp(agent.id, text))
      .then((ok) => {
        if (!ok && draftRef.current === '') {
          setDraft(snapshot);
        }
      })
      .catch(() => {
        if (draftRef.current === '') {
          setDraft(snapshot);
        }
      })
      .finally(() => {
        followUpInFlightRef.current = false;
        setSendingFollowUp(false);
      });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className='agent-view web-agent-view' style={{ ['--agent-accent' as string]: accent }}>
      <div className='agent-view__transcript-shell'>
        <div className='agent-view__transcript' ref={transcriptRef}>
          {turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              deviceId={agent.deviceId}
              projectId={agent.projectId}
            />
          ))}
        </div>
      </div>
      <div className={`agent-view__footer${turns.length === 0 ? ' agent-view__footer--idle' : ''}`}>
        <form className='agent-view__composer' onSubmit={submit}>
          <div className='agent-view__composer-card'>
            <textarea
              className='agent-view__composer-input'
              value={draft}
              rows={1}
              placeholder='Adicionar follow-up'
              spellCheck={false}
              disabled={sendingFollowUp}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className='agent-view__composer-bar'>
              <div className='agent-view__composer-bar-left'>
                <WebAgentPlusMenu
                  mode={modeId}
                  modelId={modelId}
                  models={modelList}
                  onModeChange={(next) => onModeChange(agent.id, next)}
                  onModelChange={(next) => onModelChange(agent.id, next)}
                />
                <WebAskMenuSelect
                  value={modelId}
                  options={modelOptions}
                  ariaLabel='Modelo do agent'
                  className='web-agent-model-select'
                  triggerLabel={modelLabel}
                  triggerLeading={
                    <img
                      src={logoCursor}
                      alt=''
                      className='agent-view__composer-mode-icon'
                      draggable={false}
                    />
                  }
                  onChange={(next) => onModelChange(agent.id, next || 'auto')}
                />
              </div>
              <div className='agent-view__composer-bar-actions'>
                <button
                  type={canStop ? 'button' : 'submit'}
                  className={`agent-view__composer-send app-button app-button--enter${
                    canStop
                      ? ' agent-view__composer-send--stop agent-view__composer-send--ready'
                      : canSend
                        ? ' agent-view__composer-send--ready'
                        : ''
                  }`}
                  aria-label={canStop ? 'Parar agent' : 'Enviar follow-up'}
                  disabled={!canSend && !canStop}
                  onClick={
                    canStop
                      ? (event) => {
                          event.preventDefault();
                          onStop(agent.id);
                        }
                      : undefined
                  }
                >
                  {canStop ? (
                    <Square size={13} strokeWidth={2.25} fill='currentColor' aria-hidden='true' />
                  ) : (
                    <ArrowUp size={16} strokeWidth={2.25} aria-hidden='true' />
                  )}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
