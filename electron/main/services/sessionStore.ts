import Store from 'electron-store';

interface SessionState {
  scrollbacks: Record<string, string>;
}

const SCROLLBACK_LIMIT = 128 * 1024;

function truncateScrollback(scrollback: string): string {
  if (scrollback.length <= SCROLLBACK_LIMIT) {
    return scrollback;
  }

  return scrollback.slice(scrollback.length - SCROLLBACK_LIMIT);
}

class SessionStoreService {
  private store = new Store<SessionState>({
    name: 'session',
    defaults: {
      scrollbacks: {},
    },
  });

  getScrollback(paneId: string): string {
    return this.store.get(`scrollbacks.${paneId}`, '');
  }

  saveScrollbacks(
    entries: Record<string, string>,
    options?: { pruneToPaneIds?: string[] },
  ): void {
    const current = this.store.get('scrollbacks', {} as Record<string, string>);
    const pruneToPaneIds =
      options?.pruneToPaneIds && options.pruneToPaneIds.length > 0
        ? new Set(options.pruneToPaneIds)
        : null;
    const next: Record<string, string> = {};

    if (pruneToPaneIds) {
      for (const [paneId, scrollback] of Object.entries(current)) {
        if (pruneToPaneIds.has(paneId)) {
          next[paneId] = truncateScrollback(scrollback);
        }
      }
    } else {
      for (const [paneId, scrollback] of Object.entries(current)) {
        next[paneId] = truncateScrollback(scrollback);
      }
    }

    for (const [paneId, scrollback] of Object.entries(entries)) {
      if (!scrollback) {
        delete next[paneId];
        continue;
      }

      next[paneId] = truncateScrollback(scrollback);
    }

    this.store.set('scrollbacks', next);
  }

  pruneAndTruncateScrollbacks(alivePaneIds: string[]): void {
    const current = this.store.get('scrollbacks', {} as Record<string, string>);
    const next: Record<string, string> = {};

    if (alivePaneIds.length === 0) {
      for (const [paneId, scrollback] of Object.entries(current)) {
        if (!scrollback) {
          continue;
        }

        next[paneId] = truncateScrollback(scrollback);
      }

      this.store.set('scrollbacks', next);
      return;
    }

    const alive = new Set(alivePaneIds);

    for (const [paneId, scrollback] of Object.entries(current)) {
      if (!alive.has(paneId) || !scrollback) {
        continue;
      }

      next[paneId] = truncateScrollback(scrollback);
    }

    this.store.set('scrollbacks', next);
  }

  removePane(paneId: string): void {
    const current = this.store.get('scrollbacks', {} as Record<string, string>);

    if (!(paneId in current)) {
      return;
    }

    const next = { ...current };
    delete next[paneId];
    this.store.set('scrollbacks', next);
  }
}

export const sessionStore = new SessionStoreService();
