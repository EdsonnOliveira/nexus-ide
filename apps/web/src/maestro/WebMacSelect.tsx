import { useEffect, useMemo, useState } from 'react';
import { Monitor } from 'lucide-react';
import { isDeviceOnline } from '@nexus/supabase';
import { sanitizeDeviceName, type DeviceRecord } from '@nexus/protocol';
import { WebAskMenuSelect } from './WebAskMenuSelect';

function MacLeading({ online }: { online: boolean }) {
  return (
    <span className='web-ask-mac-leading'>
      <span className={`dot ${online ? 'dot--online' : 'dot--offline'}`} />
      <Monitor size={14} aria-hidden='true' />
    </span>
  );
}

function shortenMacTriggerLabel(name: string): string {
  const match = name.match(/^(MacBook Pro)\b/i);
  if (match) {
    return match[1];
  }
  return name;
}

interface WebMacSelectProps {
  devices: DeviceRecord[];
  deviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
  disabled?: boolean;
  className?: string;
  iconOnly?: boolean;
}

export function WebMacSelect({
  devices,
  deviceId,
  onDeviceChange,
  disabled = false,
  className = '',
  iconOnly = false,
}: WebMacSelectProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const selectedDevice =
    devices.find((device) => device.id === deviceId) ??
    devices.find((device) => device.is_default) ??
    devices[0] ??
    null;
  const selectedOnline = useMemo(
    () => (selectedDevice ? isDeviceOnline(selectedDevice.last_seen_at) : false),
    [nowMs, selectedDevice],
  );

  const deviceOptions = useMemo(
    () =>
      devices.map((device) => {
        const online = isDeviceOnline(device.last_seen_at);
        return {
          value: device.id,
          label: `${sanitizeDeviceName(device.name)}${online ? '' : ' · Offline'}`,
          leading: <MacLeading online={online} />,
          disabled: !device.is_enabled,
        };
      }),
    [devices, nowMs],
  );

  const triggerLabel = selectedDevice
    ? shortenMacTriggerLabel(sanitizeDeviceName(selectedDevice.name))
    : 'Nenhum Mac';

  return (
    <WebAskMenuSelect
      value={selectedDevice?.id ?? ''}
      options={deviceOptions}
      disabled={devices.length === 0 || disabled}
      ariaLabel={iconOnly ? `Mac: ${triggerLabel}` : 'Mac'}
      className={`web-ask-mac-select${iconOnly ? ' web-ask-mac-select--icon-only' : ''} ${className}`.trim()}
      iconOnly={iconOnly}
      triggerLabel={triggerLabel}
      triggerLeading={<MacLeading online={selectedOnline} />}
      onChange={(next) => onDeviceChange(next || null)}
    />
  );
}
