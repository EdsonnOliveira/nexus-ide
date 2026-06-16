import Store from 'electron-store';

interface SessionState {
  scrollbacks: Record<string, string>;
}

const SCROLLBACK_LIMIT = 512 * 1024;

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

  saveScrollbacks(entries: Record<string, string>): void {
    const current = this.store.get('scrollbacks', {} as Record<string, string>);
    const next = { ...current };

    for (const [paneId, scrollback] of Object.entries(entries)) {
      if (!scrollback) {
        delete next[paneId];
        continue;
      }

      next[paneId] =
        scrollback.length <= SCROLLBACK_LIMIT
          ? scrollback
          : scrollback.slice(scrollback.length - SCROLLBACK_LIMIT);
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
