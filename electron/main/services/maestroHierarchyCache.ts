import { fetchMaestroHierarchy, type MaestroHierarchyNode } from './maestroHierarchy';

class MaestroHierarchyCache {
  private deviceId: string | null = null;
  private snapshot: MaestroHierarchyNode | null = null;
  private refreshPromise: Promise<MaestroHierarchyNode | null> | null = null;

  bindDevice(deviceId: string): void {
    if (this.deviceId === deviceId) {
      return;
    }

    this.stop();
    this.deviceId = deviceId;
  }

  stop(): void {
    this.deviceId = null;
    this.snapshot = null;
    this.refreshPromise = null;
  }

  getSnapshot(): MaestroHierarchyNode | null {
    return this.snapshot;
  }

  async waitForPendingSnapshot(): Promise<MaestroHierarchyNode | null> {
    if (this.snapshot) {
      return this.snapshot;
    }

    if (!this.refreshPromise) {
      return null;
    }

    return this.refreshPromise;
  }

  async fetchFresh(): Promise<MaestroHierarchyNode | null> {
    if (!this.deviceId) {
      return null;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const deviceId = this.deviceId;

    this.refreshPromise = fetchMaestroHierarchy(deviceId)
      .then((snapshot) => {
        if (this.deviceId === deviceId) {
          this.snapshot = snapshot;
          return snapshot;
        }

        return null;
      })
      .catch(() => null)
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }
}

export const maestroHierarchyCache = new MaestroHierarchyCache();
