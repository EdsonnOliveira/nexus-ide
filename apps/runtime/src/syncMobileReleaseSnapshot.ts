import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { NexusClient } from '@nexus/supabase';

function userDataDir(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'nexus-ide');
}

export async function syncMobileReleaseSnapshotFromDisk(
  client: NexusClient,
  userId: string,
  deviceId: string | null,
): Promise<boolean> {
  const filePath = path.join(userDataDir(), 'mobile-release-snapshot.json');

  if (!existsSync(filePath)) {
    return false;
  }

  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as {
      device_id?: string | null;
      active_release?: unknown;
      releases?: unknown[];
    };

    await client.from('mobile_release_snapshots').upsert(
      {
        user_id: userId,
        device_id: parsed.device_id ?? deviceId,
        active_release: parsed.active_release ?? null,
        releases: Array.isArray(parsed.releases) ? parsed.releases : [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    return true;
  } catch {
    return false;
  }
}
