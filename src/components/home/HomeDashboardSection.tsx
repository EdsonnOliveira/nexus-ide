import { memo, useEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface HomeDashboardSectionProps {
  icon: LucideIcon;
  title: string;
  accent: string;
  children: ReactNode;
  className?: string;
  enterDelayMs?: number;
  headerAction?: ReactNode;
  headerMeta?: ReactNode;
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current: HTMLElement | null = element.parentElement;

  while (current) {
    const styles = window.getComputedStyle(current);
    const overflowY = styles.overflowY;
    const canScroll =
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      current.scrollHeight > current.clientHeight + 1;

    if (canScroll) {
      return current;
    }

    current = current.parentElement;
  }

  return null;
}

function chainWheelToScrollParent(element: HTMLElement, deltaY: number): boolean {
  const parent = findScrollParent(element);
  if (!parent) {
    return false;
  }

  const before = parent.scrollTop;
  parent.scrollTop += deltaY;
  return parent.scrollTop !== before;
}

function HomeDashboardSectionComponent({
  icon: Icon,
  title,
  accent,
  children,
  className = '',
  enterDelayMs = 0,
  headerAction,
  headerMeta,
}: HomeDashboardSectionProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || event.ctrlKey) {
        return;
      }

      const maxScroll = el.scrollHeight - el.clientHeight;
      const canScrollY = maxScroll > 1;

      if (!canScrollY) {
        if (chainWheelToScrollParent(el, event.deltaY)) {
          event.preventDefault();
        }
        return;
      }

      const atTop = el.scrollTop <= 0;
      const atBottom = el.scrollTop >= maxScroll - 1;

      if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
        if (chainWheelToScrollParent(el, event.deltaY)) {
          event.preventDefault();
        }
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <section
      className={`home-dashboard__section app-button--enter${className ? ` ${className}` : ''}`}
      style={{
        animationDelay: `${enterDelayMs}ms`,
        ['--card-accent' as string]: accent,
      }}
    >
      <header className='home-dashboard__section-header'>
        <span className='home-dashboard__section-icon' aria-hidden='true'>
          <Icon size={16} strokeWidth={2} />
        </span>
        <div className='home-dashboard__section-heading'>
          <h2 className='home-dashboard__section-title'>{title}</h2>
          {headerMeta}
        </div>
        {headerAction ? (
          <div className='home-dashboard__section-action'>{headerAction}</div>
        ) : null}
      </header>
      <div ref={bodyRef} className='home-dashboard__section-body'>
        {children}
      </div>
    </section>
  );
}

export const HomeDashboardSection = memo(HomeDashboardSectionComponent);
