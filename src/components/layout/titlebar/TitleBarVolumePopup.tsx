import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Headphones, Laptop, Speaker, Tv, Volume2, VolumeX } from 'lucide-react';
import { TitleBarPopupShell } from '@/components/layout/titlebar/TitleBarPopupShell';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import type { AudioOutputDeviceItem, SystemStatusSnapshot } from '@/types';
import { useTitleBarPopupDismiss } from '@/components/layout/titlebar/useTitleBarPopupDismiss';

interface TitleBarVolumePopupProps {
  anchorRect: DOMRect;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  snapshot: SystemStatusSnapshot;
  onClose: () => void;
  onRefresh: () => void;
}

function OutputDeviceIcon({ kind }: { kind: AudioOutputDeviceItem['kind'] }) {
  if (kind === 'builtin') {
    return <Laptop size={14} aria-hidden='true' />;
  }

  if (kind === 'headphones') {
    return <Headphones size={14} aria-hidden='true' />;
  }

  if (kind === 'tv') {
    return <Tv size={14} aria-hidden='true' />;
  }

  return <Speaker size={14} aria-hidden='true' />;
}

function TitleBarVolumePopupComponent({
  anchorRect,
  anchorRef,
  snapshot,
  onClose,
  onRefresh,
}: TitleBarVolumePopupProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragVolume, setDragVolume] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [outputDevices, setOutputDevices] = useState<AudioOutputDeviceItem[]>([]);
  const [loadingOutputs, setLoadingOutputs] = useState(true);
  const [switchingDeviceId, setSwitchingDeviceId] = useState<string | null>(null);
  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    onClose,
    (menu) => positionDropdownBelowAnchor(menu, anchorRect, 'end'),
    [anchorRect],
  );

  useTitleBarPopupDismiss(menuRef, anchorRef, requestClose);

  const loadOutputDevices = useCallback(async () => {
    setLoadingOutputs(true);

    try {
      const devices = await window.nexus.systemStatus.listAudioOutputDevices();
      setOutputDevices(devices);
    } finally {
      setLoadingOutputs(false);
    }
  }, []);

  useEffect(() => {
    void loadOutputDevices();
  }, [loadOutputDevices]);

  const displayVolume = dragVolume ?? snapshot.volume;

  const resolveVolumeFromClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;

      if (!track) {
        return snapshot.volume;
      }

      const rect = track.getBoundingClientRect();

      if (rect.width <= 0) {
        return snapshot.volume;
      }

      const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
      return Math.round(ratio * 100);
    },
    [snapshot.volume],
  );

  const commitVolume = useCallback(
    (volume: number) => {
      void window.nexus.systemStatus.setVolume(volume).then(() => {
        onRefresh();
      });
    },
    [onRefresh],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsDragging(true);
      setDragVolume(resolveVolumeFromClientX(event.clientX));
    },
    [resolveVolumeFromClientX],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        return;
      }

      setDragVolume(resolveVolumeFromClientX(event.clientX));
    },
    [isDragging, resolveVolumeFromClientX],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDragging) {
        return;
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const nextVolume = resolveVolumeFromClientX(event.clientX);
      setDragVolume(null);
      setIsDragging(false);
      commitVolume(nextVolume);
    },
    [commitVolume, isDragging, resolveVolumeFromClientX],
  );

  const handleToggleMute = useCallback(() => {
    void window.nexus.systemStatus.setMuted(!snapshot.muted).then(() => {
      onRefresh();
    });
  }, [onRefresh, snapshot.muted]);

  const handleSelectOutputDevice = useCallback(
    (device: AudioOutputDeviceItem) => {
      if (device.active || switchingDeviceId) {
        return;
      }

      setSwitchingDeviceId(device.id);

      void window.nexus.systemStatus.setAudioOutputDevice(device.id).then((ok) => {
        setSwitchingDeviceId(null);

        if (ok) {
          void loadOutputDevices();
        }
      });
    },
    [loadOutputDevices, switchingDeviceId],
  );

  return createPortal(
    <TitleBarPopupShell
      menuRef={menuRef}
      animationClass={animationClass}
      title='Volume'
      popoverClassName='titlebar-panel__popover--wide'
      onClose={requestClose}
      actions={
        <button
          type='button'
          className='agent-cursor-usage__action app-button app-button--enter'
          onClick={handleToggleMute}
        >
          {snapshot.muted ? <VolumeX size={13} aria-hidden='true' /> : <Volume2 size={13} aria-hidden='true' />}
          {snapshot.muted ? 'Ativar som' : 'Silenciar'}
        </button>
      }
    >
      <div className='agent-cursor-usage__summary'>
        <span className='agent-cursor-usage__summary-percent'>{displayVolume}%</span>
        <span className='agent-cursor-usage__summary-plan'>
          {snapshot.muted ? 'Silenciado' : 'Ativo'}
        </span>
      </div>

      <div
        ref={trackRef}
        className={`titlebar-panel__slider${isDragging ? ' titlebar-panel__slider--dragging' : ''}`}
        role='slider'
        aria-label='Volume do sistema'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayVolume}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
      >
        <div className='titlebar-panel__slider-fill' style={{ width: `${displayVolume}%` }} />
        <span
          className='titlebar-panel__slider-thumb'
          style={{ left: `${displayVolume}%` }}
          aria-hidden='true'
        />
      </div>

      {loadingOutputs ? (
        <p className='agent-cursor-usage__period'>Carregando saídas...</p>
      ) : outputDevices.length === 0 ? (
        <p className='agent-cursor-usage__period'>Nenhuma saída de áudio encontrada.</p>
      ) : (
        <div className='titlebar-panel__select-list'>
          <p className='titlebar-panel__section-label'>Saída</p>
          {outputDevices.map((device) => (
            <button
              key={device.id}
              type='button'
              className={`titlebar-panel__select-item titlebar-panel__select-item--output app-button app-button--enter${device.active ? ' titlebar-panel__select-item--active' : ''}`}
              disabled={Boolean(switchingDeviceId)}
              onClick={() => handleSelectOutputDevice(device)}
            >
              <span className='titlebar-panel__output-item'>
                <span className='titlebar-panel__output-icon' aria-hidden='true'>
                  <OutputDeviceIcon kind={device.kind} />
                </span>
                <span className='titlebar-panel__output-name'>{device.name}</span>
              </span>
              {device.active ? <Check size={13} aria-hidden='true' /> : null}
            </button>
          ))}
        </div>
      )}
    </TitleBarPopupShell>,
    document.body,
  );
}

export const TitleBarVolumePopup = memo(TitleBarVolumePopupComponent);
