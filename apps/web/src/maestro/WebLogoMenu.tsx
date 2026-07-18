import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Bell, LogOut, Monitor } from 'lucide-react';
import { WebVercelIcon } from './WebVercelIcon';

interface WebLogoMenuProps {
  children: ReactNode;
  onRegisterMac: () => void;
  onConfigureVercel: () => void;
  onConfigureNotifications: () => void;
  onSignOut: () => void;
}

export function WebLogoMenu({
  children,
  onRegisterMac,
  onConfigureVercel,
  onConfigureNotifications,
  onSignOut,
}: WebLogoMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className='web-logo-menu' ref={rootRef}>
      <button
        type='button'
        className='web-logo-menu__trigger app-button'
        aria-label='Menu Nexus'
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {children}
      </button>
      {open ? (
        <div className='web-logo-menu__dropdown app-button--enter' role='menu'>
          <button
            type='button'
            className='app-button web-logo-menu__item'
            role='menuitem'
            onClick={() => {
              setOpen(false);
              onRegisterMac();
            }}
          >
            <Monitor size={15} />
            Cadastrar Mac
          </button>
          <button
            type='button'
            className='app-button web-logo-menu__item'
            role='menuitem'
            onClick={() => {
              setOpen(false);
              onConfigureVercel();
            }}
          >
            <WebVercelIcon size={15} />
            Vercel
          </button>
          <button
            type='button'
            className='app-button web-logo-menu__item'
            role='menuitem'
            onClick={() => {
              setOpen(false);
              onConfigureNotifications();
            }}
          >
            <Bell size={15} />
            Notificações
          </button>
          <button
            type='button'
            className='app-button web-logo-menu__item'
            role='menuitem'
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={15} />
            Sair
          </button>
        </div>
      ) : null}
    </div>
  );
}
