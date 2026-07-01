import Store from 'electron-store';

interface SystemNotificationDismissState {
  dismissedIds: string[];
}

const MAX_DISMISSED_IDS = 5000;

class SystemNotificationDismissStoreService {
  private store = new Store<SystemNotificationDismissState>({
    name: 'system-notification-dismissals',
    defaults: {
      dismissedIds: [],
    },
  });

  private readDismissedIds(): Set<string> {
    return new Set(this.store.get('dismissedIds', []));
  }

  dismiss(id: string): void {
    if (!id) {
      return;
    }

    const current = this.readDismissedIds();

    if (current.has(id)) {
      return;
    }

    current.add(id);
    this.persistDismissedIds(current);
  }

  dismissMany(ids: string[]): void {
    const current = this.readDismissedIds();
    let changed = false;

    for (const id of ids) {
      if (!id || current.has(id)) {
        continue;
      }

      current.add(id);
      changed = true;
    }

    if (!changed) {
      return;
    }

    this.persistDismissedIds(current);
  }

  filterItems<T extends { id: string }>(items: T[]): T[] {
    const dismissed = this.readDismissedIds();

    return items.filter((item) => !dismissed.has(item.id));
  }

  private persistDismissedIds(ids: Set<string>): void {
    let next = Array.from(ids);

    if (next.length > MAX_DISMISSED_IDS) {
      next = next.slice(next.length - MAX_DISMISSED_IDS);
    }

    this.store.set('dismissedIds', next);
  }
}

export const systemNotificationDismissStore = new SystemNotificationDismissStoreService();
