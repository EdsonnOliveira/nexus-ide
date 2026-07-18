import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Terminal, X } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { bridge } from '../lib/supabase';
import { useWebStore, type WebAgentSession, type WebAgentTerminal } from '../store';
import {
  dismissWebAgentTerminal,
  ensureWebAgentRemoteTerminal,
} from './webShellTerminal';

interface WebAgentShellTerminalsProps {
  agent: WebAgentSession;
  deviceId: string | null;
}

function formatElapsed(startedAt: number, now: number): string {
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
}

function WebAgentTerminalModal({
  terminal,
  agentId,
  deviceId,
  projectId,
  onClose,
}: {
  terminal: WebAgentTerminal;
  agentId: string;
  deviceId: string | null;
  projectId: string | null;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const writtenLengthRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const liveTerminal = useWebStore(
    (state) =>
      state.agents.find((agent) => agent.id === agentId)?.terminals.find(
        (entry) => entry.id === terminal.id,
      ) ?? terminal,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const term = new XTerm({
      convertEol: true,
      fontSize: 12,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#0f1115',
        foreground: '#e2e8f0',
        cursor: '#e2e8f0',
      },
      cursorBlink: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;
    writtenLengthRef.current = 0;

    const onResize = () => {
      fit.fit();
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }
    const output = liveTerminal.output ?? '';
    if (output.length < writtenLengthRef.current) {
      term.reset();
      writtenLengthRef.current = 0;
    }
    const delta = output.slice(writtenLengthRef.current);
    if (delta) {
      term.write(delta);
      writtenLengthRef.current = output.length;
    }
  }, [liveTerminal.output]);

  useEffect(() => {
    if (!deviceId) {
      setError('Nenhum Mac online para abrir o terminal.');
      return;
    }

    let cancelled = false;

    const connect = async () => {
      setConnecting(true);
      setError(null);
      try {
        const workspaceId = await bridge.getWorkspaceId();
        if (!workspaceId || cancelled) {
          throw new Error('Workspace não encontrado');
        }
        const current =
          useWebStore.getState().agents.find((agent) => agent.id === agentId)?.terminals.find(
            (entry) => entry.id === terminal.id,
          ) ?? null;
        if (!current) {
          throw new Error('Terminal não encontrado');
        }
        await ensureWebAgentRemoteTerminal(agentId, current, {
          deviceId,
          projectId,
          workspaceId,
        });
      } catch (connectError) {
        if (!cancelled) {
          setError(
            connectError instanceof Error
              ? connectError.message
              : 'Falha ao conectar no terminal remoto',
          );
        }
      } finally {
        if (!cancelled) {
          setConnecting(false);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
    };
  }, [agentId, deviceId, projectId, terminal.id]);

  return createPortal(
    <div className='web-modal web-modal--viewport app-button--enter' role='presentation' onClick={onClose}>
      <div
        className='web-agent-terminal-modal app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-label={liveTerminal.title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className='web-agent-terminal-modal__header'>
          <div className='web-agent-terminal-modal__heading'>
            <span className='web-agent-terminal-modal__title'>{liveTerminal.title}</span>
            <span className='web-agent-terminal-modal__command'>{liveTerminal.command}</span>
          </div>
          <button
            type='button'
            className='web-agent-terminal-modal__close app-button app-button--enter'
            aria-label='Fechar terminal'
            onClick={onClose}
          >
            <X size={16} strokeWidth={2.25} />
          </button>
        </div>
        {error ? <div className='web-agent-terminal-modal__error'>{error}</div> : null}
        {connecting && !liveTerminal.output ? (
          <div className='web-agent-terminal-modal__connecting'>Conectando ao Mac…</div>
        ) : null}
        <div ref={hostRef} className='web-agent-terminal-modal__body' />
      </div>
    </div>,
    document.body,
  );
}

function WebAgentTerminalsPopup({
  anchorRect,
  terminals,
  now,
  onClose,
  onOpenTerminal,
  onDismiss,
}: {
  anchorRect: DOMRect;
  terminals: WebAgentTerminal[];
  now: number;
  onClose: () => void;
  onOpenTerminal: (terminal: WebAgentTerminal) => void;
  onDismiss: (terminal: WebAgentTerminal) => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [animationClass, setAnimationClass] = useState('overlay-popup--in');

  const countLabel =
    terminals.length === 1 ? '1 Terminal Running' : `${terminals.length} Terminals Running`;

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) {
      return;
    }
    const gap = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    let left = anchorRect.right - width;
    let top = anchorRect.bottom + gap;
    if (left < gap) {
      left = gap;
    }
    if (left + width > window.innerWidth - gap) {
      left = Math.max(gap, window.innerWidth - width - gap);
    }
    if (top + height > window.innerHeight - gap) {
      top = Math.max(gap, anchorRect.top - height - gap);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [anchorRect, terminals.length]);

  useEffect(() => {
    const closeWithAnimation = () => {
      setAnimationClass('overlay-popup--out');
      window.setTimeout(onClose, 160);
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      closeWithAnimation();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeWithAnimation();
      }
    };
    const timeoutId = window.setTimeout(() => {
      window.addEventListener('mousedown', handlePointerDown);
    }, 0);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className={`web-agent-terminals-popup context-menu overlay-popup ${animationClass}`}
      role='dialog'
      aria-label={countLabel}
    >
      <div className='web-agent-terminals-popup__header'>{countLabel}</div>
      <ul className='web-agent-terminals-popup__list'>
        {terminals.map((terminal) => (
          <li key={terminal.id} className='web-agent-terminals-popup__item'>
            <button
              type='button'
              className='web-agent-terminals-popup__item-main app-button app-button--enter'
              onClick={() => onOpenTerminal(terminal)}
            >
              <Terminal
                size={14}
                strokeWidth={2.25}
                className='web-agent-terminals-popup__item-icon'
              />
              <span className='web-agent-terminals-popup__item-title'>{terminal.title}</span>
              <span className='web-agent-terminals-popup__item-elapsed'>
                {formatElapsed(terminal.startedAt, now)}
              </span>
            </button>
            <button
              type='button'
              className='web-agent-terminals-popup__item-dismiss app-button app-button--enter'
              aria-label={`Encerrar ${terminal.title}`}
              onClick={() => onDismiss(terminal)}
            >
              <X size={14} strokeWidth={2.25} />
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

function WebAgentShellTerminalsComponent({ agent, deviceId }: WebAgentShellTerminalsProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const [openTerminalId, setOpenTerminalId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const terminals = useMemo(
    () =>
      (agent.terminals ?? []).filter(
        (entry) => entry.status === 'starting' || entry.status === 'running',
      ),
    [agent.terminals],
  );

  const openTerminal = useMemo(
    () => terminals.find((entry) => entry.id === openTerminalId) ?? null,
    [openTerminalId, terminals],
  );

  useEffect(() => {
    if (terminals.length === 0) {
      setPopupOpen(false);
      setOpenTerminalId(null);
      return;
    }

    if (openTerminalId && !terminals.some((entry) => entry.id === openTerminalId)) {
      setOpenTerminalId(null);
    }
  }, [openTerminalId, terminals]);

  useEffect(() => {
    if (terminals.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [terminals.length]);

  const handleOpenPopup = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    setAnchorRect(rect);
    setPopupOpen((current) => !current);
  }, []);

  const handleDismiss = useCallback(
    async (terminal: WebAgentTerminal) => {
      let context: { deviceId: string; projectId: string | null; workspaceId: string } | null =
        null;
      if (deviceId) {
        try {
          const workspaceId = await bridge.getWorkspaceId();
          if (workspaceId) {
            context = {
              deviceId,
              projectId: agent.projectId,
              workspaceId,
            };
          }
        } catch {
        }
      }
      await dismissWebAgentTerminal(agent.id, terminal, context);
      if (openTerminalId === terminal.id) {
        setOpenTerminalId(null);
      }
    },
    [agent.id, agent.projectId, deviceId, openTerminalId],
  );

  if (terminals.length === 0) {
    return null;
  }

  return (
    <>
      <button
        ref={buttonRef}
        type='button'
        className='home-dashboard__agent-card-terminal app-button app-button--enter'
        aria-label={
          terminals.length === 1
            ? '1 terminal rodando'
            : `${terminals.length} terminais rodando`
        }
        aria-expanded={popupOpen}
        onClick={handleOpenPopup}
      >
        <Terminal size={14} strokeWidth={2.25} aria-hidden='true' />
        {terminals.length > 1 ? (
          <span className='home-dashboard__agent-card-terminal-badge'>{terminals.length}</span>
        ) : null}
      </button>

      {popupOpen && anchorRect ? (
        <WebAgentTerminalsPopup
          anchorRect={anchorRect}
          terminals={terminals}
          now={now}
          onClose={() => setPopupOpen(false)}
          onOpenTerminal={(terminal) => {
            setPopupOpen(false);
            setOpenTerminalId(terminal.id);
          }}
          onDismiss={(terminal) => {
            void handleDismiss(terminal);
          }}
        />
      ) : null}

      {openTerminal ? (
        <WebAgentTerminalModal
          terminal={openTerminal}
          agentId={agent.id}
          deviceId={deviceId}
          projectId={agent.projectId}
          onClose={() => setOpenTerminalId(null)}
        />
      ) : null}
    </>
  );
}

export const WebAgentShellTerminals = memo(WebAgentShellTerminalsComponent);
