import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AppleMusicPlayerState = 'playing' | 'paused' | 'stopped';

export interface AppleMusicNowPlaying {
  platformSupported: boolean;
  available: boolean;
  title: string;
  artist: string;
  state: AppleMusicPlayerState;
  artworkUrl: string | null;
}

const DELIMITER = '\u001f';
const ARTWORK_PATH = path.join(os.tmpdir(), 'nexus-apple-music-artwork.jpg');

let cachedArtworkKey = '';
let cachedArtworkDataUrl: string | null = null;

async function runAppleScript(script: string): Promise<string> {
  const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script]);
  return stdout.trim();
}

function parsePlayerState(value: string): AppleMusicPlayerState {
  if (value === 'playing' || value === 'paused' || value === 'stopped') {
    return value;
  }

  return 'stopped';
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function detectImageMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png';
  }

  return null;
}

async function exportAppleMusicArtwork(): Promise<boolean> {
  const artPath = escapeAppleScriptString(ARTWORK_PATH);

  try {
    const output = await runAppleScript(`
tell application "Music"
  try
    if (count of artworks of current track) is 0 then
      return "missing"
    end if
    set artFile to open for access (POSIX file "${artPath}") with write permission
    set eof of artFile to 0
    write (get data of artwork 1 of current track) to artFile
    close access artFile
    return "ok"
  on error errMsg
    try
      close access artFile
    end try
    return "missing"
  end try
end tell
`);

    return output === 'ok';
  } catch {
    return false;
  }
}

async function getArtworkDataUrl(trackKey: string): Promise<string | null> {
  if (!trackKey) {
    return null;
  }

  if (trackKey === cachedArtworkKey) {
    return cachedArtworkDataUrl;
  }

  const exported = await exportAppleMusicArtwork();

  if (!exported) {
    cachedArtworkKey = trackKey;
    cachedArtworkDataUrl = null;
    return null;
  }

  try {
    const buffer = await fs.readFile(ARTWORK_PATH);
    const mimeType = detectImageMimeType(buffer);

    if (!mimeType) {
      cachedArtworkKey = trackKey;
      cachedArtworkDataUrl = null;
      return null;
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    cachedArtworkKey = trackKey;
    cachedArtworkDataUrl = dataUrl;
    return dataUrl;
  } catch {
    cachedArtworkKey = trackKey;
    cachedArtworkDataUrl = null;
    return null;
  }
}

export async function getAppleMusicNowPlaying(): Promise<AppleMusicNowPlaying> {
  if (process.platform !== 'darwin') {
    return {
      platformSupported: false,
      available: false,
      title: '',
      artist: '',
      state: 'stopped',
      artworkUrl: null,
    };
  }

  try {
    const output = await runAppleScript(`
tell application "System Events"
  set musicRunning to (name of processes) contains "Music"
end tell
if not musicRunning then
  return "unavailable"
end if
tell application "Music"
  try
    set currentTrack to current track
    set trackName to name of currentTrack
    set trackArtist to artist of currentTrack
    set trackState to player state as string
    set trackId to database ID of currentTrack as string
    return trackName & "${DELIMITER}" & trackArtist & "${DELIMITER}" & trackState & "${DELIMITER}" & trackId
  on error
    return "unavailable"
  end try
end tell
`);

    if (output === 'unavailable' || !output.includes(DELIMITER)) {
      cachedArtworkKey = '';
      cachedArtworkDataUrl = null;

      return {
        platformSupported: true,
        available: false,
        title: '',
        artist: '',
        state: 'stopped',
        artworkUrl: null,
      };
    }

    const [title, artist, state, trackId] = output.split(DELIMITER);
    const trackKey = trackId ?? `${title ?? ''}:${artist ?? ''}`;
    const artworkUrl = await getArtworkDataUrl(trackKey);

    return {
      platformSupported: true,
      available: true,
      title: title ?? '',
      artist: artist ?? '',
      state: parsePlayerState(state ?? 'stopped'),
      artworkUrl,
    };
  } catch {
    return {
      platformSupported: true,
      available: false,
      title: '',
      artist: '',
      state: 'stopped',
      artworkUrl: null,
    };
  }
}

export async function toggleAppleMusicPlayback(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  await runAppleScript('tell application "Music" to playpause');
}

export async function nextAppleMusicTrack(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  cachedArtworkKey = '';
  cachedArtworkDataUrl = null;
  await runAppleScript('tell application "Music" to next track');
}

export async function previousAppleMusicTrack(): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  cachedArtworkKey = '';
  cachedArtworkDataUrl = null;
  await runAppleScript('tell application "Music" to previous track');
}
