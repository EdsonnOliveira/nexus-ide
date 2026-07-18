import { useEffect, useState } from 'react';
import { Copy, Monitor, Plus, X } from 'lucide-react';
import { isDeviceOnline } from '@nexus/supabase';
import { sanitizeDeviceName } from '@nexus/protocol';
import { bridge } from '../lib/supabase';
import { useWebStore } from '../store';

interface WebMacPairingModalProps {
  open: boolean;
  onClose: () => void;
}

export function WebMacPairingModal({ open, onClose }: WebMacPairingModalProps) {
  const devices = useWebStore((state) => state.devices);
  const workspaces = useWebStore((state) => state.workspaces);
  const projects = useWebStore((state) => state.projects);
  const [name, setName] = useState('MacBook Pro Edson');
  const [pairing, setPairing] = useState<{
    code: string;
    expires_at: string;
    name: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const createPairing = async () => {
    setLoading(true);
    setError(null);
    try {
      const workspaceId =
        projects[0]?.workspace_id ??
        workspaces.find((item) => item.local_id)?.id ??
        workspaces[0]?.id ??
        null;
      const created = await bridge.createDevicePairing(
        sanitizeDeviceName(name) || 'Meu Mac',
        workspaceId,
      );
      setPairing(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao criar pareamento');
    } finally {
      setLoading(false);
    }
  };

  const copyCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className='web-modal' role='presentation' onClick={onClose}>
      <div
        className='web-modal__card app-button--enter'
        role='dialog'
        aria-modal='true'
        aria-label='Cadastrar Mac'
        onClick={(event) => event.stopPropagation()}
      >
        <div className='web-modal__head'>
          <div className='row'>
            <Monitor size={18} />
            <strong>Cadastrar Mac</strong>
          </div>
          <button type='button' className='app-button' aria-label='Fechar' onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <p className='muted' style={{ margin: 0 }}>
          Gere um código e rode o Runtime no Mac com esse código.
        </p>
        <label className='stack'>
          <span className='muted'>Nome do Mac</span>
          <input
            className='input'
            value={name}
            disabled={loading}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error ? <div className='auth__error'>{error}</div> : null}
        <button
          type='button'
          className='app-button app-button--primary app-button--enter'
          disabled={loading}
          onClick={() => void createPairing()}
        >
          <span className='row'>
            <Plus size={16} />
            Gerar código
          </span>
        </button>
        {pairing ? (
          <div className='pairing-card stack'>
            <span className='muted'>Código (válido 15 min)</span>
            <div className='row pairing-card__code'>
              <strong className='pairing-code'>{pairing.code}</strong>
              <button
                type='button'
                className='app-button'
                onClick={() => void copyCode(pairing.code)}
              >
                <Copy size={14} />
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <code className='pairing-cmd'>NEXUS_PAIRING_CODE={pairing.code} npm run runtime</code>
          </div>
        ) : null}
        {devices.length > 0 ? (
          <div className='stack'>
            <strong>Macs cadastrados</strong>
            {devices.map((device) => {
              const online = isDeviceOnline(device.last_seen_at);
              return (
                <div key={device.id} className='list__item'>
                  <div className='row'>
                    <span className={`dot ${online ? 'dot--online' : 'dot--offline'}`} />
                    <strong>{sanitizeDeviceName(device.name)}</strong>
                  </div>
                  <span className='muted'>{online ? 'Online' : 'Offline'}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
