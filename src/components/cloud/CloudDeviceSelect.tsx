import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Monitor } from 'lucide-react';
import { isDeviceOnline } from '@nexus/supabase';
import { sanitizeDeviceName } from '@nexus/protocol';
import {
  positionDropdownBelowAnchor,
  useAnchoredDropdownMenu,
} from '@/hooks/useAnchoredDropdownMenu';
import { useCloudStore } from '@/stores/useCloudStore';

function CloudDeviceSelectComponent() {
  const configured = useCloudStore((state) => state.configured);
  const devices = useCloudStore((state) => state.devices);
  const selectedDeviceId = useCloudStore((state) => state.selectedDeviceId);
  const setSelectedDeviceId = useCloudStore((state) => state.setSelectedDeviceId);
  const refresh = useCloudStore((state) => state.refresh);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (configured) {
      void refresh();
    }
  }, [configured, refresh]);

  const selected = useMemo(
    () => devices.find((device) => device.id === selectedDeviceId) ?? null,
    [devices, selectedDeviceId],
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    setAnchorRect(null);
  }, []);

  const { menuRef, requestClose, animationClass } = useAnchoredDropdownMenu(
    handleClose,
    (menu) => {
      if (!anchorRect) {
        return;
      }
      positionDropdownBelowAnchor(menu, anchorRect, 'end');
    },
    [anchorRect],
  );

  if (!configured || devices.length === 0) {
    return null;
  }

  return (
    <div className='cloud-device-select'>
      <button
        ref={triggerRef}
        type='button'
        className='cloud-device-select__trigger app-button app-button--enter'
        onClick={() => {
          const rect = triggerRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          setAnchorRect(rect);
          setOpen(true);
        }}
      >
        <Monitor size={14} />
        <span className='anchored-select__trigger-label'>
          {selected ? sanitizeDeviceName(selected.name) : 'Executar em'}
        </span>
        <span
          className={`dot ${selected && isDeviceOnline(selected.last_seen_at) ? 'dot--online' : 'dot--offline'}`}
        />
        <ChevronDown size={14} style={{ transform: open ? 'rotate(180deg)' : undefined }} />
      </button>
      {open && anchorRect
        ? createPortal(
            <div ref={menuRef} className={`context-menu ${animationClass}`}>
              {devices.map((device) => {
                const online = isDeviceOnline(device.last_seen_at);
                const active = device.id === selectedDeviceId;
                return (
                  <button
                    key={device.id}
                    type='button'
                    className={`context-menu__item app-button ${active ? 'context-menu__item--active' : ''}`}
                    disabled={!device.is_enabled}
                    onClick={() => {
                      setSelectedDeviceId(device.id);
                      requestClose();
                    }}
                  >
                    <span className={`dot ${online ? 'dot--online' : 'dot--offline'}`} />
                    <span>
                      {sanitizeDeviceName(device.name)}
                      <span className='muted'> — {online ? 'Online' : 'Offline'}</span>
                    </span>
                    {active ? <Check size={14} /> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export const CloudDeviceSelect = memo(CloudDeviceSelectComponent);
