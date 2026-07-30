import { useProjectStore } from '@/stores/useProjectStore';
import { useMobileReleaseStore } from '@/stores/useMobileReleaseStore';
import type { MobileActiveRelease, MobileReleaseKind } from '@/types';
import type { StreamJsonShellToolEvent } from '@/utils/agentStreamJsonParser';
import { findProjectIdByPaneId } from '@/utils/findProjectIdByPaneId';
import {
  resolveMobileArtifactAbsolutePath,
  sanitizeMobileArtifactPath,
} from '@/utils/mobileReleaseArtifact';
import { collectProjectPanes } from '@/utils/tabGroups';
import { stripAnsi } from '@/utils/stripAnsi';

const AAB_SUCCESS_PATTERNS = [
  /\bAAB:\s*(.+)/i,
  /AAB pronto para a Play Store:\s*\n?\s*(.+)/i,
];

const APK_SUCCESS_PATTERNS = [
  /\bAPK:\s*(.+)/i,
  /APK pronto(?:\s+para\s+distribui[cç][aã]o)?:\s*\n?\s*(.+)/i,
];

const ERROR_PATTERNS = [
  /BUILD FAILED/i,
  /Gradle build failed/i,
  /xcodebuild: error/i,
  /Export finished but no IPA/i,
  /JDK 21 not found/i,
  /Android SDK not found/i,
  /Could not resolve App Store Connect provider/i,
  /TestFlight upload requires App Store Connect credentials/i,
  /processo encerrou com código [1-9]/i,
];

const PHASE_PATTERNS_BY_KIND: Record<MobileReleaseKind, Array<{ pattern: RegExp; label: string }>> = {
  'ios-testflight': [
    { pattern: /Building web assets/i, label: 'Prepare assets' },
    { pattern: /Syncing Capacitor iOS/i, label: 'Sync iOS' },
    { pattern: /Archiving iOS app|xcodebuild archive/i, label: 'Archive iOS' },
    { pattern: /Exporting IPA|xcodebuild -exportArchive/i, label: 'Export IPA' },
    { pattern: /Uploading to TestFlight/i, label: 'Upload TestFlight' },
    { pattern: /TestFlight upload submitted successfully/i, label: 'Upload TestFlight' },
  ],
  'android-aab': [
    { pattern: /Building web assets/i, label: 'Prepare assets' },
    { pattern: /Syncing Capacitor Android/i, label: 'Sync Android' },
    { pattern: /gradlew bundleRelease|bundleRelease/i, label: 'Bundle AAB' },
  ],
  'android-apk': [
    { pattern: /Building web assets/i, label: 'Prepare assets' },
    { pattern: /Syncing Capacitor Android/i, label: 'Sync Android' },
    { pattern: /gradlew assembleRelease|assembleRelease/i, label: 'Assemble APK' },
  ],
};

const IOS_TESTFLIGHT_SUCCESS_PATTERNS = [/TestFlight upload submitted successfully/i];

const pendingStartKeys = new Set<string>();

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isPackageScriptInvocation(command: string, scriptName: string): boolean {
  const escaped = escapeRegExp(scriptName.toLowerCase());

  return new RegExp(
    `(?:npm\\s+run|pnpm(?:\\s+run)?|yarn(?:\\s+run)?|bun(?:\\s+run)?)\\s+${escaped}\\b`,
  ).test(command);
}

function isDirectScriptInvocation(command: string, scriptBaseName: string): boolean {
  const escaped = escapeRegExp(scriptBaseName.toLowerCase());

  return new RegExp(
    `(?:^|[;&|]\\s*)(?:bash\\s+|sh\\s+)?(?:\\.\\/)?(?:scripts\\/)?${escaped}(?:\\.sh)?(?:\\s|$)`,
  ).test(command);
}

function detectKindsFromCommand(command: string): MobileReleaseKind[] {
  const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();

  if (
    isPackageScriptInvocation(normalized, 'ios:archive:app-store') ||
    isDirectScriptInvocation(normalized, 'ios-archive-app-store')
  ) {
    return ['ios-testflight'];
  }

  if (
    isPackageScriptInvocation(normalized, 'android:bundle') ||
    isPackageScriptInvocation(normalized, 'android-bundle-release') ||
    isDirectScriptInvocation(normalized, 'android-bundle-release') ||
    /(?:^|[;&|]\s*).*\bgradlew\s+bundlerelease\b/.test(normalized)
  ) {
    return ['android-aab'];
  }

  if (
    isPackageScriptInvocation(normalized, 'android:apk') ||
    isPackageScriptInvocation(normalized, 'android-apk-release') ||
    isDirectScriptInvocation(normalized, 'android-apk-release') ||
    (/(?:^|[;&|]\s*).*\bgradlew\s+assemblerelease\b/.test(normalized) &&
      !/\bbundlerelease\b/.test(normalized))
  ) {
    return ['android-apk'];
  }

  return [];
}

function detectKindsFromOutput(plain: string): MobileReleaseKind[] {
  const normalized = plain.toLowerCase();

  if (
    /archiving ios app|uploading to testflight|xcodebuild\s+archive|exporting ipa/.test(normalized)
  ) {
    return ['ios-testflight'];
  }

  if (/gradlew\s+bundlerelease|aab pronto para a play store|\baab:\s*\S+/.test(normalized)) {
    return ['android-aab'];
  }

  if (
    /gradlew\s+assemblerelease|apk pronto|\bapk:\s*\S+/.test(normalized) &&
    !/bundlerelease|\baab:\s*\S+/.test(normalized)
  ) {
    return ['android-apk'];
  }

  return [];
}

function pendingStartKey(paneId: string, kind: MobileReleaseKind): string {
  return `${paneId}:${kind}`;
}

function normalizeProjectPath(projectPath: string, referencePath: string): string {
  const trimmed = projectPath.trim().replace(/\\/g, '/');

  if (!trimmed.startsWith('~')) {
    return trimmed.replace(/\/+$/, '');
  }

  const homeRoot = referencePath.replace(/\\/g, '/').match(/^(\/Users\/[^/]+)/)?.[1];

  if (!homeRoot) {
    return trimmed.replace(/\/+$/, '');
  }

  if (trimmed.startsWith('~/')) {
    return `${homeRoot}${trimmed.slice(1)}`.replace(/\/+$/, '');
  }

  return trimmed.replace(/^~/, homeRoot).replace(/\/+$/, '');
}

function joinProjectPath(basePath: string, segment: string): string {
  const trimmedSegment = segment.trim().replace(/^['"]|['"]$/g, '');

  if (!trimmedSegment) {
    return basePath;
  }

  if (trimmedSegment.startsWith('/')) {
    return trimmedSegment;
  }

  if (trimmedSegment.startsWith('~/') || trimmedSegment.startsWith('~')) {
    return normalizeProjectPath(trimmedSegment, basePath);
  }

  return `${basePath.replace(/\/+$/, '')}/${trimmedSegment.replace(/^\/+/, '')}`;
}

function extractProjectPathFromCommand(command: string, fallbackPath: string): string {
  const cdMatch = command.match(/(?:^|[;&\s|])cd\s+([^\s;&|]+)/i);

  if (!cdMatch?.[1]) {
    return fallbackPath;
  }

  return joinProjectPath(fallbackPath, cdMatch[1]);
}

function resolveProjectPathForPane(paneId: string, command?: string): string | null {
  const projectId = findProjectIdByPaneId(paneId);

  if (!projectId) {
    return null;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

  if (!project) {
    return null;
  }

  let resolvedPath = project.path;

  for (const pane of collectProjectPanes(project.tabs)) {
    if (pane.id !== paneId) {
      continue;
    }

    if (pane.type === 'terminal' && pane.terminalCwd?.trim()) {
      resolvedPath = pane.terminalCwd.trim();
    }

    break;
  }

  if (command?.trim()) {
    resolvedPath = extractProjectPathFromCommand(command, resolvedPath);
  }

  return normalizeProjectPath(resolvedPath, project.path);
}

function parseVersionFromGradle(content: string): {
  version: string | null;
  versionCode: string | null;
} {
  const versionNameMatch = content.match(/versionName\s+["']([^"']+)["']/);
  const versionCodeMatch = content.match(/versionCode\s+(\d+)/);

  return {
    version: versionNameMatch?.[1]?.trim() ?? null,
    versionCode: versionCodeMatch?.[1]?.trim() ?? null,
  };
}

function parseVersionFromPbxproj(content: string): {
  version: string | null;
  versionCode: string | null;
} {
  const marketingMatch = content.match(/MARKETING_VERSION = ([^;\n]+);/);
  const buildMatch = content.match(/CURRENT_PROJECT_VERSION = ([^;\n]+);/);

  return {
    version: marketingMatch?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null,
    versionCode: buildMatch?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null,
  };
}

function parseVersionFromOutput(plain: string, artifactPath?: string | null): {
  version: string | null;
  versionCode: string | null;
} {
  const versionNameMatch = plain.match(/versionName\s+["']([^"']+)["']/i);
  const versionCodeMatch = plain.match(/versionCode\s+(\d+)/i);
  const pkgVersionMatch = plain.match(/"version"\s*:\s*"([^"]+)"/i);
  const artifactTarget = artifactPath ?? plain;
  const artifactMatch = artifactTarget.match(/-(\d+\.\d+\.\d+(?:[^\/.]*?)?)-(\d+)\.(?:aab|apk|ipa)\b/i);

  return {
    version:
      versionNameMatch?.[1]?.trim() ??
      pkgVersionMatch?.[1]?.trim() ??
      artifactMatch?.[1]?.trim() ??
      null,
    versionCode:
      versionCodeMatch?.[1]?.trim() ?? artifactMatch?.[2]?.trim() ?? null,
  };
}

export async function readProjectVersionMeta(projectPath: string): Promise<{
  version: string | null;
  versionCode: string | null;
}> {
  if (!window.nexus?.files || !projectPath.trim()) {
    return { version: null, versionCode: null };
  }

  const normalizedPath = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const pkgResult = await window.nexus.files.readTextFile(`${normalizedPath}/package.json`);

  let version: string | null = null;
  let versionCode: string | null = null;

  if (pkgResult.ok) {
    try {
      const pkg = JSON.parse(pkgResult.content) as { version?: string };
      version = typeof pkg.version === 'string' ? pkg.version.trim() : null;
    } catch {
      version = null;
    }
  }

  const gradleResult = await window.nexus.files.readTextFile(`${normalizedPath}/android/app/build.gradle`);

  if (gradleResult.ok) {
    const gradleVersion = parseVersionFromGradle(gradleResult.content);
    version = version ?? gradleVersion.version;
    versionCode = gradleVersion.versionCode ?? versionCode;
  }

  const pbxprojResult = await window.nexus.files.readTextFile(
    `${normalizedPath}/ios/App/App.xcodeproj/project.pbxproj`,
  );

  if (pbxprojResult.ok) {
    const iosVersion = parseVersionFromPbxproj(pbxprojResult.content);
    version = version ?? iosVersion.version;
    versionCode = versionCode ?? iosVersion.versionCode;
  }

  return { version, versionCode };
}

function syncReleaseVersionFromOutput(
  uid: string,
  plain: string,
  artifactPath?: string | null,
): void {
  const store = useMobileReleaseStore.getState();
  const release = store.releases[uid];

  if (!release) {
    return;
  }

  if (release.version && release.versionCode) {
    return;
  }

  const parsed = parseVersionFromOutput(plain, artifactPath);

  if (!parsed.version && !parsed.versionCode) {
    return;
  }

  store.updateRelease(uid, {
    version: release.version ?? parsed.version,
    versionCode: release.versionCode ?? parsed.versionCode,
  });
}

export async function refreshMobileReleaseVersion(uid: string): Promise<void> {
  const store = useMobileReleaseStore.getState();
  const release = store.releases[uid];

  if (!release || release.version) {
    return;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === release.projectId);

  if (!project) {
    return;
  }

  const projectPath = resolveProjectPathForPane(release.paneId) ?? project.path;
  const versionMeta = await readProjectVersionMeta(projectPath);

  if (!versionMeta.version && !versionMeta.versionCode) {
    if (release.logTail.trim()) {
      syncReleaseVersionFromOutput(uid, stripAnsi(release.logTail), release.artifactPath);
    }

    return;
  }

  store.updateRelease(uid, {
    version: release.version ?? versionMeta.version,
    versionCode: release.versionCode ?? versionMeta.versionCode,
  });
}

function resolveArtifactForRelease(
  release: MobileActiveRelease,
  artifactPath: string | null,
): string | null {
  if (!artifactPath) {
    return null;
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === release.projectId);
  const projectPath = resolveProjectPathForPane(release.paneId) ?? project?.path ?? null;

  return resolveMobileArtifactAbsolutePath(projectPath, artifactPath);
}

function extractArtifactPath(patterns: RegExp[], plain: string): string | null {
  for (const pattern of patterns) {
    const match = plain.match(pattern);

    if (!match) {
      continue;
    }

    const candidate = match[1]?.trim();

    if (candidate) {
      const sanitized = sanitizeMobileArtifactPath(candidate);

      if (sanitized) {
        return sanitized;
      }
    }

    const matchedLine = match[0];
    const lineStart = typeof match.index === 'number' ? match.index : plain.indexOf(matchedLine);
    const lineEnd = plain.indexOf('\n', lineStart >= 0 ? lineStart : 0);
    const line =
      lineStart >= 0
        ? plain.slice(lineStart, lineEnd >= 0 ? lineEnd : undefined).trim()
        : matchedLine;
    const fromLine = sanitizeMobileArtifactPath(line.replace(/^[^:]+:\s*/i, '').trim());

    if (fromLine) {
      return fromLine;
    }
  }

  return null;
}

function createRelease(
  paneId: string,
  kind: MobileReleaseKind,
  meta: { projectId: string; projectName: string; version: string | null; versionCode: string | null },
): MobileActiveRelease {
  const createdAt = Date.now();

  return {
    uid: `${meta.projectId}:${kind}:${createdAt}`,
    projectId: meta.projectId,
    projectName: meta.projectName,
    paneId,
    kind,
    state: 'BUILDING',
    version: meta.version,
    versionCode: meta.versionCode,
    artifactPath: null,
    phase: null,
    createdAt,
    buildingAt: createdAt,
    readyAt: null,
    logTail: '',
  };
}

function getActiveBuildingReleases(paneId: string): MobileActiveRelease[] {
  const store = useMobileReleaseStore.getState();
  const uids = store.activeUidsByPane[paneId] ?? [];

  return uids
    .map((uid) => store.releases[uid])
    .filter((release): release is MobileActiveRelease => Boolean(release && release.state === 'BUILDING'));
}

function hasActiveReleaseOfKind(paneId: string, kind: MobileReleaseKind): boolean {
  return getActiveBuildingReleases(paneId).some((release) => release.kind === kind);
}

async function startMobileReleaseKinds(
  paneId: string,
  kinds: MobileReleaseKind[],
  command?: string,
): Promise<void> {
  const uniqueKinds = [...new Set(kinds)].filter((kind) => {
    const key = pendingStartKey(paneId, kind);

    if (hasActiveReleaseOfKind(paneId, kind) || pendingStartKeys.has(key)) {
      return false;
    }

    pendingStartKeys.add(key);
    return true;
  });

  if (!uniqueKinds.length) {
    return;
  }

  try {
    const projectId = findProjectIdByPaneId(paneId);

    if (!projectId) {
      return;
    }

    const project = useProjectStore.getState().projects.find((entry) => entry.id === projectId);

    if (!project) {
      return;
    }

    const projectPath = resolveProjectPathForPane(paneId, command) ?? project.path;
    const versionMeta = await readProjectVersionMeta(projectPath);
    const store = useMobileReleaseStore.getState();

    for (const kind of uniqueKinds) {
      if (hasActiveReleaseOfKind(paneId, kind)) {
        continue;
      }

      store.startRelease(
        createRelease(paneId, kind, {
          projectId,
          projectName: project.name,
          version: versionMeta.version,
          versionCode: versionMeta.versionCode,
        }),
      );
    }
  } finally {
    for (const kind of uniqueKinds) {
      pendingStartKeys.delete(pendingStartKey(paneId, kind));
    }
  }
}

export function detectMobileReleaseKinds(command: string): MobileReleaseKind[] {
  return detectKindsFromCommand(command);
}

export async function startMobileReleaseFromCommand(paneId: string, command: string): Promise<void> {
  const kinds = detectKindsFromCommand(command);

  if (!kinds.length) {
    return;
  }

  await startMobileReleaseKinds(paneId, kinds, command);
}

function commandMatchesReleaseKind(command: string, kind: MobileReleaseKind): boolean {
  return detectKindsFromCommand(command).includes(kind);
}

function getReleasePlainText(release: MobileActiveRelease, chunkPlain = ''): string {
  const combined = `${release.logTail}${chunkPlain}`;

  return stripAnsi(combined);
}

function isIosTestFlightSuccess(plain: string): boolean {
  return IOS_TESTFLIGHT_SUCCESS_PATTERNS.some((pattern) => pattern.test(plain));
}

function resolveIosTestFlightArtifact(plain: string): string | null {
  return extractArtifactPath([/\bIPA:\s*(.+)/i], plain);
}

function shouldCompleteReleaseFromShell(
  release: MobileActiveRelease,
  command: string,
  plain: string,
  exitCode: number | null,
): { complete: boolean; artifactPath: string | null } {
  const artifactPath = matchKindSuccess(release.kind, plain);

  if (release.kind === 'ios-testflight') {
    if (isIosTestFlightSuccess(plain)) {
      return {
        complete: true,
        artifactPath: artifactPath ?? resolveIosTestFlightArtifact(plain),
      };
    }

    return { complete: false, artifactPath: null };
  }

  if (artifactPath) {
    return { complete: true, artifactPath };
  }

  if (exitCode === 0 && commandMatchesReleaseKind(command, release.kind)) {
    return { complete: true, artifactPath: null };
  }

  return { complete: false, artifactPath: null };
}

function shouldFailReleaseAfterShellExit(
  release: MobileActiveRelease,
  command: string,
  plain: string,
  exitCode: number | null,
): boolean {
  if (exitCode === null) {
    return false;
  }

  const commandMatched = commandMatchesReleaseKind(command, release.kind);
  const outputMatched = detectKindsFromOutput(plain).includes(release.kind);

  if (!commandMatched && !outputMatched) {
    return false;
  }

  if (exitCode !== 0) {
    return true;
  }

  if (release.kind !== 'ios-testflight') {
    return false;
  }

  return !isIosTestFlightSuccess(plain);
}

function resolveLatestPhase(kind: MobileReleaseKind, plain: string): string | null {
  let latestLabel: string | null = null;
  let latestIndex = -1;

  for (const { pattern, label } of PHASE_PATTERNS_BY_KIND[kind]) {
    const match = plain.match(pattern);

    if (!match || match.index === undefined) {
      continue;
    }

    if (match.index >= latestIndex) {
      latestIndex = match.index;
      latestLabel = label;
    }
  }

  return latestLabel;
}

function applyReleaseProgress(release: MobileActiveRelease, fullPlain: string): void {
  const store = useMobileReleaseStore.getState();
  const current = store.releases[release.uid];

  if (!current || current.state !== 'BUILDING') {
    return;
  }

  const phaseLabel = resolveLatestPhase(current.kind, fullPlain);

  if (phaseLabel && phaseLabel !== current.phase) {
    store.updateRelease(release.uid, { phase: phaseLabel });
  }

  if (ERROR_PATTERNS.some((pattern) => pattern.test(fullPlain))) {
    store.completeRelease(release.uid, 'ERROR');
    return;
  }

  syncReleaseVersionFromOutput(release.uid, fullPlain);

  const completion = shouldCompleteReleaseFromShell(current, '', fullPlain, null);

  if (completion.complete) {
    if (completion.artifactPath) {
      syncReleaseVersionFromOutput(release.uid, fullPlain, completion.artifactPath);
    }

    store.completeRelease(
      release.uid,
      'READY',
      resolveArtifactForRelease(current, completion.artifactPath),
    );
  }
}

function matchKindSuccess(kind: MobileReleaseKind, plain: string): string | null {
  switch (kind) {
    case 'android-aab':
      return extractArtifactPath(AAB_SUCCESS_PATTERNS, plain);
    case 'android-apk':
      return extractArtifactPath(APK_SUCCESS_PATTERNS, plain);
    case 'ios-testflight':
      if (!isIosTestFlightSuccess(plain)) {
        return null;
      }

      return extractArtifactPath([/\bIPA:\s*(.+)/i], plain);
    default:
      return null;
  }
}

function processReleaseChunk(paneId: string, plain: string): void {
  const store = useMobileReleaseStore.getState();
  const building = getActiveBuildingReleases(paneId);

  if (!building.length) {
    return;
  }

  for (const release of building) {
    const updated = store.releases[release.uid];

    if (!updated || updated.state !== 'BUILDING') {
      continue;
    }

    const fullPlain = getReleasePlainText(updated, plain);
    applyReleaseProgress(updated, fullPlain);
  }
}

function feedMobileReleaseOutputChunk(paneId: string, chunk: string, plain: string): void {
  const activeBuilding = getActiveBuildingReleases(paneId);

  if (!activeBuilding.length) {
    return;
  }

  useMobileReleaseStore.getState().feedOutput(paneId, chunk);
  processReleaseChunk(paneId, plain);
}

export function feedMobileReleaseOutput(paneId: string, chunk: string): void {
  const plain = stripAnsi(chunk);

  if (!plain) {
    return;
  }

  const building = getActiveBuildingReleases(paneId);

  if (!building.length) {
    const outputKinds = detectKindsFromOutput(plain);

    if (outputKinds.length) {
      void startMobileReleaseKinds(paneId, outputKinds).then(() => {
        feedMobileReleaseOutputChunk(paneId, chunk, plain);
      });
      return;
    }

    return;
  }

  feedMobileReleaseOutputChunk(paneId, chunk, plain);
}

export function handleMobileReleaseShellPrompt(paneId: string): void {
  const building = getActiveBuildingReleases(paneId);

  if (!building.length) {
    return;
  }

  const store = useMobileReleaseStore.getState();

  for (const release of building) {
    store.completeRelease(release.uid, 'ERROR');
  }
}

async function handleMobileReleaseShellToolCompletedEvent(
  paneId: string,
  event: StreamJsonShellToolEvent,
): Promise<void> {
  await startMobileReleaseFromCommand(paneId, event.command);

  if (event.output.trim()) {
    feedMobileReleaseOutput(paneId, event.output);
  }

  const outputPlain = stripAnsi(event.output);
  let building = getActiveBuildingReleases(paneId);

  if (!building.length && outputPlain.trim()) {
    await startMobileReleaseKinds(paneId, detectKindsFromOutput(outputPlain), event.command);
    building = getActiveBuildingReleases(paneId);

    if (building.length && event.output.trim()) {
      useMobileReleaseStore.getState().feedOutput(paneId, event.output);
    }
  }

  if (!building.length) {
    return;
  }

  const store = useMobileReleaseStore.getState();

  for (const release of building) {
    const current = store.releases[release.uid];

    if (!current || current.state !== 'BUILDING') {
      continue;
    }

    const fullPlain = getReleasePlainText(current, outputPlain);
    applyReleaseProgress(current, fullPlain);

    const refreshed = store.releases[release.uid];

    if (!refreshed || refreshed.state !== 'BUILDING') {
      continue;
    }

    if (shouldFailReleaseAfterShellExit(refreshed, event.command, fullPlain, event.exitCode)) {
      store.completeRelease(release.uid, 'ERROR');
      continue;
    }

    const completion = shouldCompleteReleaseFromShell(
      refreshed,
      event.command,
      fullPlain,
      event.exitCode,
    );

    if (!completion.complete) {
      continue;
    }

    if (completion.artifactPath) {
      syncReleaseVersionFromOutput(release.uid, fullPlain, completion.artifactPath);
    }

    store.completeRelease(
      release.uid,
      'READY',
      resolveArtifactForRelease(refreshed, completion.artifactPath),
    );
  }
}

export function finalizeMobileReleasesForPane(
  paneId: string,
  options: { failRemaining?: boolean } = {},
): void {
  const store = useMobileReleaseStore.getState();
  const building = getActiveBuildingReleases(paneId);

  for (const release of building) {
    const current = store.releases[release.uid];

    if (!current || current.state !== 'BUILDING') {
      continue;
    }

    const fullPlain = stripAnsi(current.logTail);
    applyReleaseProgress(current, fullPlain);

    const refreshed = store.releases[release.uid];

    if (!refreshed || refreshed.state !== 'BUILDING') {
      continue;
    }

    if (options.failRemaining) {
      store.completeRelease(release.uid, 'ERROR');
    }
  }
}

export function handleMobileReleaseShellToolEvents(
  paneId: string,
  events: StreamJsonShellToolEvent[],
): void {
  for (const event of events) {
    if (event.type === 'started') {
      void startMobileReleaseFromCommand(paneId, event.command);
      continue;
    }

    void handleMobileReleaseShellToolCompletedEvent(paneId, event);
  }
}
