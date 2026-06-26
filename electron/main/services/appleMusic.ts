import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AppleMusicPlayerState = 'playing' | 'paused' | 'stopped';
export type AppleMusicRepeatMode = 'off' | 'one' | 'all';

export interface AppleMusicUpcomingTrack {
  title: string;
  artist: string;
  playlistIndex: number;
  trackId: string;
  artworkUrl: string | null;
}

export interface AppleMusicPlaylist {
  id: string;
  name: string;
  artworkUrl: string | null;
}

export interface AppleMusicNowPlaying {
  platformSupported: boolean;
  musicReady: boolean;
  available: boolean;
  title: string;
  artist: string;
  state: AppleMusicPlayerState;
  artworkUrl: string | null;
  positionSeconds: number;
  durationSeconds: number;
  repeatMode: AppleMusicRepeatMode;
  shuffleEnabled: boolean;
  upcoming: AppleMusicUpcomingTrack[];
}

const DELIMITER = '\u001f';
const TRACK_DELIMITER = '\u001e';
const GROUP_DELIMITER = '\u001d';
const MAX_UPCOMING_TRACKS = 6;
const MAX_PLAYLISTS = 80;
const EXCLUDED_LIBRARY_PLAYLIST_NAMES = new Set(['Music', 'Music Videos']);
const ARTWORK_PATH_PREFIX = path.join(os.tmpdir(), 'nexus-apple-music-artwork');

const artworkCache = new Map<string, string | null>();

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

function parseRepeatMode(value: string): AppleMusicRepeatMode {
  const normalized = value.toLowerCase();

  if (normalized === 'one') {
    return 'one';
  }

  if (normalized === 'all') {
    return 'all';
  }

  return 'off';
}

function parseNumber(value: string | undefined): number {
  if (!value?.trim()) {
    return 0;
  }

  const normalized = value.trim().replace(',', '.');
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function parseBoolean(value: string | undefined): boolean {
  return value?.toLowerCase() === 'true';
}

function parseUpcomingTracks(raw: string | undefined): Omit<AppleMusicUpcomingTrack, 'artworkUrl'>[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(TRACK_DELIMITER)
    .map((entry) => {
      const [title, artist, playlistIndexRaw, trackId] = entry.split(DELIMITER);

      if (!title?.trim()) {
        return null;
      }

      return {
        title: title.trim(),
        artist: artist?.trim() ?? '',
        playlistIndex: parseNumber(playlistIndexRaw),
        trackId: trackId?.trim() ?? '',
      };
    })
    .filter(
      (entry): entry is Omit<AppleMusicUpcomingTrack, 'artworkUrl'> =>
        entry !== null && entry.playlistIndex > 0,
    )
    .slice(0, MAX_UPCOMING_TRACKS);
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

const MUSIC_READY_POLL_MS = 200;
const MUSIC_READY_MAX_ATTEMPTS = 15;

async function ensureMusicAppReady(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    const runningCheck = await runAppleScript(`
tell application "System Events"
  return (name of processes) contains "Music" as string
end tell
`);

    if (runningCheck === 'true') {
      return true;
    }

    await execFileAsync('/usr/bin/open', ['-gj', '-a', 'Music']);

    for (let attempt = 0; attempt < MUSIC_READY_MAX_ATTEMPTS; attempt += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, MUSIC_READY_POLL_MS);
      });

      const check = await runAppleScript(`
tell application "System Events"
  return (name of processes) contains "Music" as string
end tell
`);

      if (check === 'true') {
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function emptyNowPlaying(platformSupported: boolean, musicReady = false): AppleMusicNowPlaying {
  return {
    platformSupported,
    musicReady,
    available: false,
    title: '',
    artist: '',
    state: 'stopped',
    artworkUrl: null,
    positionSeconds: 0,
    durationSeconds: 0,
    repeatMode: 'off',
    shuffleEnabled: false,
    upcoming: [],
  };
}

function getArtworkExportPath(cacheKey: string): string {
  return `${ARTWORK_PATH_PREFIX}-${cacheKey}.jpg`;
}

function clearArtworkCache(): void {
  artworkCache.clear();
}

function parsePlaylists(raw: string | undefined): Omit<AppleMusicPlaylist, 'artworkUrl'>[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(TRACK_DELIMITER)
    .map((entry) => {
      const [id, name] = entry.split(DELIMITER);

      if (!id?.trim() || !name?.trim()) {
        return null;
      }

      return {
        id: id.trim(),
        name: name.trim(),
      };
    })
    .filter((entry): entry is Omit<AppleMusicPlaylist, 'artworkUrl'> => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
    .slice(0, MAX_PLAYLISTS);
}

async function exportAppleMusicPlaylistArtwork(
  playlistId: string,
  cacheKey: string,
): Promise<boolean> {
  const artPath = escapeAppleScriptString(getArtworkExportPath(cacheKey));

  if (!/^\d+$/.test(playlistId)) {
    return false;
  }

  try {
    const output = await runAppleScript(`
tell application "Music"
  try
    set pl to (first playlist whose id is ${playlistId})
    if (count of tracks of pl) is 0 then
      return "missing"
    end if
    set targetTrack to track 1 of pl
    if (count of artworks of targetTrack) is 0 then
      return "missing"
    end if
    set artFile to open for access (POSIX file "${artPath}") with write permission
    set eof of artFile to 0
    write (get data of artwork 1 of targetTrack) to artFile
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

async function getPlaylistArtworkDataUrl(playlistId: string): Promise<string | null> {
  if (!playlistId) {
    return null;
  }

  const cacheKey = `playlist:${playlistId}`;

  if (artworkCache.has(cacheKey)) {
    return artworkCache.get(cacheKey) ?? null;
  }

  const exported = await exportAppleMusicPlaylistArtwork(playlistId, cacheKey);

  if (!exported) {
    artworkCache.set(cacheKey, null);
    return null;
  }

  try {
    const buffer = await fs.readFile(getArtworkExportPath(cacheKey));
    const mimeType = detectImageMimeType(buffer);

    if (!mimeType) {
      artworkCache.set(cacheKey, null);
      return null;
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    artworkCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    artworkCache.set(cacheKey, null);
    return null;
  }
}

async function enrichPlaylists(
  playlists: Omit<AppleMusicPlaylist, 'artworkUrl'>[],
): Promise<AppleMusicPlaylist[]> {
  return Promise.all(
    playlists.map(async (playlist) => ({
      ...playlist,
      artworkUrl: await getPlaylistArtworkDataUrl(playlist.id),
    })),
  );
}

async function exportAppleMusicArtwork(cacheKey: string, playlistIndex?: number): Promise<boolean> {
  const artPath = escapeAppleScriptString(getArtworkExportPath(cacheKey));
  const trackSource =
    playlistIndex !== undefined
      ? `track ${playlistIndex} of current playlist`
      : 'current track';

  try {
    const output = await runAppleScript(`
tell application "Music"
  try
    set targetTrack to ${trackSource}
    if (count of artworks of targetTrack) is 0 then
      return "missing"
    end if
    set artFile to open for access (POSIX file "${artPath}") with write permission
    set eof of artFile to 0
    write (get data of artwork 1 of targetTrack) to artFile
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

async function getArtworkDataUrl(trackKey: string, playlistIndex?: number): Promise<string | null> {
  if (!trackKey) {
    return null;
  }

  const cacheKey =
    playlistIndex !== undefined ? `queue:${playlistIndex}:${trackKey}` : trackKey;

  if (artworkCache.has(cacheKey)) {
    return artworkCache.get(cacheKey) ?? null;
  }

  const exported = await exportAppleMusicArtwork(cacheKey, playlistIndex);

  if (!exported) {
    artworkCache.set(cacheKey, null);
    return null;
  }

  try {
    const buffer = await fs.readFile(getArtworkExportPath(cacheKey));
    const mimeType = detectImageMimeType(buffer);

    if (!mimeType) {
      artworkCache.set(cacheKey, null);
      return null;
    }

    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;
    artworkCache.set(cacheKey, dataUrl);
    return dataUrl;
  } catch {
    artworkCache.set(cacheKey, null);
    return null;
  }
}

async function enrichUpcomingTracks(
  tracks: Omit<AppleMusicUpcomingTrack, 'artworkUrl'>[],
): Promise<AppleMusicUpcomingTrack[]> {
  return Promise.all(
    tracks.map(async (track) => ({
      ...track,
      artworkUrl: await getArtworkDataUrl(track.trackId, track.playlistIndex),
    })),
  );
}

export async function getAppleMusicNowPlaying(): Promise<AppleMusicNowPlaying> {
  if (process.platform !== 'darwin') {
    return emptyNowPlaying(false);
  }

  const musicReady = await ensureMusicAppReady();

  if (!musicReady) {
    return emptyNowPlaying(true, false);
  }

  try {
    const output = await runAppleScript(`
tell application "Music"
  try
    set currentTrack to current track
    set trackName to name of currentTrack
    set trackArtist to artist of currentTrack
    set trackState to player state as string
    set trackId to database ID of currentTrack as string
    set trackPosition to player position as string
    set trackDuration to duration of currentTrack as string
    set trackRepeat to song repeat as string
    set trackShuffle to shuffle enabled as string
    set upcomingBlock to ""
    try
      set currentIndex to index of currentTrack
      set pl to current playlist
      set maxTracks to count of tracks of pl
      repeat with i from (currentIndex + 1) to (currentIndex + ${MAX_UPCOMING_TRACKS})
        if i > maxTracks then exit repeat
        set nextTrack to track i of pl
        set upcomingBlock to upcomingBlock & (name of nextTrack) & "${DELIMITER}" & (artist of nextTrack) & "${DELIMITER}" & i & "${DELIMITER}" & (database ID of nextTrack as string) & "${TRACK_DELIMITER}"
      end repeat
    end try
    return trackName & "${DELIMITER}" & trackArtist & "${DELIMITER}" & trackState & "${DELIMITER}" & trackId & "${DELIMITER}" & trackPosition & "${DELIMITER}" & trackDuration & "${DELIMITER}" & trackRepeat & "${DELIMITER}" & trackShuffle & "${GROUP_DELIMITER}" & upcomingBlock
  on error
    return "no_track"
  end try
end tell
`);

    if (output === 'no_track' || !output.includes(DELIMITER)) {
      clearArtworkCache();
      return emptyNowPlaying(true, true);
    }

    const [mainBlock, upcomingBlock = ''] = output.split(GROUP_DELIMITER);
    const [
      title,
      artist,
      state,
      trackId,
      position,
      duration,
      repeatMode,
      shuffleEnabled,
    ] = mainBlock.split(DELIMITER);
    const trackKey = trackId ?? `${title ?? ''}:${artist ?? ''}`;
    const artworkUrl = await getArtworkDataUrl(trackKey);
    const upcoming = await enrichUpcomingTracks(parseUpcomingTracks(upcomingBlock));

    return {
      platformSupported: true,
      musicReady: true,
      available: true,
      title: title ?? '',
      artist: artist ?? '',
      state: parsePlayerState(state ?? 'stopped'),
      artworkUrl,
      positionSeconds: parseNumber(position),
      durationSeconds: parseNumber(duration),
      repeatMode: parseRepeatMode(repeatMode ?? 'off'),
      shuffleEnabled: parseBoolean(shuffleEnabled),
      upcoming,
    };
  } catch {
    return emptyNowPlaying(true, true);
  }
}

async function withMusicAppReady(action: () => Promise<void>): Promise<void> {
  if (process.platform !== 'darwin') {
    return;
  }

  const musicReady = await ensureMusicAppReady();

  if (!musicReady) {
    return;
  }

  await action();
}

export async function toggleAppleMusicPlayback(): Promise<void> {
  await withMusicAppReady(() => runAppleScript('tell application "Music" to playpause'));
}

export async function nextAppleMusicTrack(): Promise<void> {
  clearArtworkCache();
  await withMusicAppReady(() => runAppleScript('tell application "Music" to next track'));
}

export async function previousAppleMusicTrack(): Promise<void> {
  clearArtworkCache();
  await withMusicAppReady(() => runAppleScript('tell application "Music" to previous track'));
}

export async function setAppleMusicPosition(seconds: number): Promise<void> {
  const safeSeconds = Math.max(0, seconds);

  await withMusicAppReady(() =>
    runAppleScript(`tell application "Music" to set player position to ${safeSeconds}`),
  );
}

export async function cycleAppleMusicRepeat(): Promise<void> {
  await withMusicAppReady(() =>
    runAppleScript(`
tell application "Music"
  if song repeat is off then
    set song repeat to all
  else if song repeat is all then
    set song repeat to one
  else
    set song repeat to off
  end if
end tell
`),
  );
}

export async function playAppleMusicQueueTrack(playlistIndex: number): Promise<void> {
  if (playlistIndex <= 0) {
    return;
  }

  clearArtworkCache();

  await withMusicAppReady(() =>
    runAppleScript(`
tell application "Music"
  set pl to current playlist
  play track ${playlistIndex} of pl
end tell
`),
  );
}

export async function toggleAppleMusicShuffle(): Promise<void> {
  await withMusicAppReady(() =>
    runAppleScript(`
tell application "Music"
  set shuffle enabled to not shuffle enabled
end tell
`),
  );
}

export async function getAppleMusicPlaylists(): Promise<AppleMusicPlaylist[]> {
  if (process.platform !== 'darwin') {
    return [];
  }

  const musicReady = await ensureMusicAppReady();

  if (!musicReady) {
    return [];
  }

  try {
    const excludedNames = [...EXCLUDED_LIBRARY_PLAYLIST_NAMES]
      .map((name) => `"${escapeAppleScriptString(name)}"`)
      .join(', ');

    const output = await runAppleScript(`
tell application "Music"
  try
    set userSource to (first source whose kind is library)
    set outputBlock to ""
    set excludedNames to {${excludedNames}}
    repeat with pl in (user playlists of userSource)
      set plName to name of pl
      if excludedNames does not contain plName then
        set outputBlock to outputBlock & (id of pl as string) & "${DELIMITER}" & plName & "${TRACK_DELIMITER}"
      end if
    end repeat
    return outputBlock
  on error
    return "unavailable"
  end try
end tell
`);

    if (output === 'unavailable') {
      return [];
    }

    return enrichPlaylists(parsePlaylists(output));
  } catch {
    return [];
  }
}

export async function playAppleMusicPlaylist(playlistId: string): Promise<void> {
  const safePlaylistId = playlistId.trim();

  if (!/^\d+$/.test(safePlaylistId)) {
    return;
  }

  clearArtworkCache();

  await withMusicAppReady(() =>
    runAppleScript(`
tell application "Music"
  play (first playlist whose id is ${safePlaylistId})
end tell
`),
  );
}
