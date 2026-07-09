import { spawn } from 'node:child_process';
import { buildCliPathEnv } from '../utils/cliPathEnv';

export interface MaestroHierarchyAttributes {
  bounds?: string;
  text?: string;
  accessibilityText?: string;
  'resource-id'?: string;
  hintText?: string;
  focused?: string;
  enabled?: string;
}

export interface MaestroHierarchyNode {
  attributes?: MaestroHierarchyAttributes;
  children?: MaestroHierarchyNode[];
  clickable?: boolean;
  enabled?: boolean;
  focused?: boolean;
  checked?: boolean;
  selected?: boolean;
}

function runMaestroHierarchy(deviceId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn('maestro', ['--device', deviceId, 'hierarchy'], {
      env: {
        ...process.env,
        PATH: buildCliPathEnv(process.env.PATH),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill('SIGTERM');
      reject(new Error('maestro hierarchy timed out'));
    }, 90_000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', (code) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (code !== 0 || !stdout.trim()) {
        reject(new Error(stderr.trim() || `maestro hierarchy exited with code ${code ?? 1}`));
        return;
      }

      resolve(stdout);
    });
  });
}

export async function fetchMaestroHierarchy(deviceId: string): Promise<MaestroHierarchyNode> {
  const stdout = await runMaestroHierarchy(deviceId);
  return JSON.parse(stdout) as MaestroHierarchyNode;
}

export function walkMaestroHierarchy(
  node: MaestroHierarchyNode,
  visit: (attributes: MaestroHierarchyAttributes) => void,
): void {
  if (node.attributes) {
    visit(node.attributes);
  }

  for (const child of node.children ?? []) {
    walkMaestroHierarchy(child, visit);
  }
}
