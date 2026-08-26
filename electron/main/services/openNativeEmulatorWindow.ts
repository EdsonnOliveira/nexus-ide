import { spawn } from 'node:child_process';
import type { EmulatorPlatform } from '../../types';
import { resolveXcrunPath } from './emulatorPaths';

function runCommand(
  command: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const child = spawn(command, args, { env: process.env });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
    child.on('error', () => {
      resolve({ stdout, stderr, code: 1 });
    });
  });
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function androidCandidateProcessesScript(): string {
  return `
  set candidateProcesses to {}
  try
    set candidateProcesses to candidateProcesses & (every process whose name contains "qemu-system")
  end try
  try
    set candidateProcesses to candidateProcesses & (every process whose name is "emulator")
  end try
  try
    set candidateProcesses to candidateProcesses & (every process whose name contains "Android Emulator")
  end try
`;
}

async function openIosSimulatorWindow(deviceId: string): Promise<boolean> {
  const xcrun = resolveXcrunPath();

  if (xcrun.found && deviceId.trim()) {
    await runCommand(xcrun.path, ['simctl', 'boot', deviceId]);
    await runCommand(xcrun.path, ['simctl', 'bootstatus', deviceId, '-b']);
  }

  const openResult = await runCommand('/usr/bin/open', [
    '-a',
    'Simulator',
    ...(deviceId.trim() ? ['--args', '-CurrentDeviceUDID', deviceId.trim()] : []),
  ]);

  await runCommand('/usr/bin/osascript', [
    '-e',
    `
tell application "System Events"
  try
    set visible of process "Simulator" to true
  end try
end tell
tell application "Simulator" to activate
`,
  ]);

  return openResult.code === 0;
}

async function hideIosSimulatorWindow(): Promise<boolean> {
  const result = await runCommand('/usr/bin/osascript', [
    '-e',
    `
tell application "System Events"
  try
    set visible of process "Simulator" to false
    return "ok"
  end try
end tell
return "miss"
`,
  ]);

  return result.code === 0 && result.stdout.trim() === 'ok';
}

async function openAndroidEmulatorWindow(deviceId: string): Promise<boolean> {
  const needle = deviceId.trim();
  const escapedNeedle = escapeAppleScriptString(needle);
  const candidates = androidCandidateProcessesScript();

  const script = `
tell application "System Events"
  ${candidates}
  set matched to false
  repeat with proc in candidateProcesses
    try
      set visible of proc to true
      set frontmost of proc to true
      set procWindows to every window of proc
      repeat with w in procWindows
        set windowName to name of w as text
        if "${escapedNeedle}" is "" or windowName contains "${escapedNeedle}" then
          try
            set value of attribute "AXMinimized" of w to false
          end try
          try
            perform action "AXRaise" of w
          end try
          set matched to true
        end if
      end repeat
      if (count of procWindows) is 0 then
        set matched to true
      end if
    end try
    if matched then exit repeat
  end repeat
  if matched then return "ok"
end tell
return "miss"
`;

  const result = await runCommand('/usr/bin/osascript', ['-e', script]);
  return result.code === 0 && result.stdout.trim() === 'ok';
}

async function hideAndroidEmulatorWindow(deviceId: string): Promise<boolean> {
  const needle = deviceId.trim();
  const escapedNeedle = escapeAppleScriptString(needle);
  const candidates = androidCandidateProcessesScript();

  const script = `
tell application "System Events"
  ${candidates}
  set matched to false
  repeat with proc in candidateProcesses
    try
      set procWindows to every window of proc
      repeat with w in procWindows
        set windowName to name of w as text
        if "${escapedNeedle}" is "" or windowName contains "${escapedNeedle}" then
          set matched to true
          exit repeat
        end if
      end repeat
      if matched then
        set visible of proc to false
        return "ok"
      end if
    end try
  end repeat
  repeat with proc in candidateProcesses
    try
      set visible of proc to false
      return "ok"
    end try
  end repeat
end tell
return "miss"
`;

  const result = await runCommand('/usr/bin/osascript', ['-e', script]);
  return result.code === 0 && result.stdout.trim() === 'ok';
}

export async function openNativeEmulatorWindow(
  platform: EmulatorPlatform,
  deviceId: string,
): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }

  if (platform === 'ios') {
    return openIosSimulatorWindow(deviceId);
  }

  return openAndroidEmulatorWindow(deviceId);
}

export async function hideNativeEmulatorWindow(
  platform: EmulatorPlatform,
  deviceId: string,
): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return false;
  }
  if (platform === 'ios') {
    return hideIosSimulatorWindow();
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const hidden = await hideAndroidEmulatorWindow(deviceId);

    if (hidden) {
      return true;
    }

    await delay(250);
  }

  return hideAndroidEmulatorWindow(deviceId);
}
