import type { Mission, MissionAgentNode, MissionAutomationConfig } from '@/types/mission';
import { useMissionStore } from '@/stores/useMissionStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { isMissionAutomationNode } from '@/utils/missionHelpers';

export interface MissionAutomationRunResult {
  ok: boolean;
  output?: Record<string, unknown>;
  error?: string;
  waitingApproval?: boolean;
}

function configString(
  config: MissionAutomationConfig['config'],
  key: string,
  fallback = '',
): string {
  const value = config[key];
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function configNumber(
  config: MissionAutomationConfig['config'],
  key: string,
  fallback: number,
): number {
  const value = config[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function collectUpstreamOutput(mission: Mission, nodeId: string): Record<string, unknown> {
  const incoming = mission.edges.filter((edge) => edge.targetNodeId === nodeId);
  const merged: Record<string, unknown> = {};

  for (const edge of incoming) {
    const source = mission.nodes.find((node) => node.id === edge.sourceNodeId);
    if (!source?.automation?.output) {
      continue;
    }
    Object.assign(merged, source.automation.output);
  }

  return merged;
}

const SAFE_EXPRESSION_KEY = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isSafeGitRef(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 200 &&
    !value.startsWith('-') &&
    !value.includes('..') &&
    /^[A-Za-z0-9._/\-]+$/.test(value)
  );
}

function evaluateExpression(expression: string, context: Record<string, unknown>): unknown {
  const trimmed = expression.trim();
  if (!trimmed) {
    return true;
  }

  if (trimmed in context) {
    return context[trimmed];
  }

  if (trimmed.startsWith('$.')) {
    return context[trimmed.slice(2)];
  }

  try {
    const keys = Object.keys(context).filter(
      (key) =>
        SAFE_EXPRESSION_KEY.test(key) &&
        key !== 'constructor' &&
        key !== '__proto__' &&
        key !== 'prototype',
    );
    const values = keys.map((key) => context[key]);
    const fn = new Function(...keys, `"use strict"; return (${trimmed});`);
    return fn(...values);
  } catch {
    return trimmed === 'true' || trimmed === '1';
  }
}

async function runHttpRequest(
  automation: MissionAutomationConfig,
): Promise<MissionAutomationRunResult> {
  const method = configString(automation.config, 'method', 'GET').toUpperCase() || 'GET';
  const url = configString(automation.config, 'url');
  if (!url) {
    return { ok: false, error: 'URL obrigatória para HTTP Request.' };
  }

  let headers: Record<string, string> = {};
  const headersRaw = configString(automation.config, 'headers');
  if (headersRaw.trim()) {
    try {
      headers = JSON.parse(headersRaw) as Record<string, string>;
    } catch {
      return { ok: false, error: 'Headers inválidos (use JSON).' };
    }
  }

  const body = configString(automation.config, 'body');
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : body || undefined,
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      output: {
        status: response.status,
        ok: response.ok,
        body: json ?? text,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha na requisição HTTP.',
    };
  }
}

async function runShell(
  node: MissionAgentNode,
  automation: MissionAutomationConfig,
): Promise<MissionAutomationRunResult> {
  const command = configString(automation.config, 'command');
  if (!command.trim()) {
    return { ok: false, error: 'Comando shell obrigatório.' };
  }

  const project = useProjectStore.getState().projects.find((entry) => entry.id === node.projectId);
  const cwd = configString(automation.config, 'cwd') || node.worktreePath || project?.path || '';

  if (!cwd) {
    return { ok: false, error: 'Diretório do projeto não encontrado.' };
  }

  if (!window.nexus?.missions?.runShell) {
    return {
      ok: false,
      error: 'Execução de shell indisponível neste ambiente.',
    };
  }

  try {
    const result = await window.nexus.missions.runShell({
      command,
      cwd,
    });
    return {
      ok: result.ok,
      error: result.ok ? undefined : result.stderr || result.error || 'Shell falhou.',
      output: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha ao executar shell.',
    };
  }
}

async function runFileOp(
  node: MissionAgentNode,
  automation: MissionAutomationConfig,
): Promise<MissionAutomationRunResult> {
  const project = useProjectStore.getState().projects.find((entry) => entry.id === node.projectId);
  const root = node.worktreePath || project?.path;
  if (!root || !window.nexus?.files) {
    return { ok: false, error: 'Arquivos indisponíveis.' };
  }

  const pathValue = configString(automation.config, 'path');
  if (!pathValue) {
    return { ok: false, error: 'Caminho do arquivo obrigatório.' };
  }

  const absolute = pathValue.startsWith('/')
    ? pathValue
    : `${root.replace(/\/$/, '')}/${pathValue.replace(/^\.\//, '')}`;

  try {
    if (automation.nodeType.includes('write') || automation.nodeType.includes('create')) {
      const content = configString(automation.config, 'content');
      await window.nexus.files.writeTextFile(absolute, content);
      return { ok: true, output: { path: absolute, written: true } };
    }

    if (automation.nodeType.includes('delete')) {
      await window.nexus.files.deleteEntry(absolute);
      return { ok: true, output: { path: absolute, deleted: true } };
    }

    if (automation.nodeType.includes('move') || automation.nodeType.includes('copy')) {
      const destination = configString(automation.config, 'destination');
      if (!destination) {
        return { ok: false, error: 'Destino obrigatório.' };
      }
      const destAbsolute = destination.startsWith('/')
        ? destination
        : `${root.replace(/\/$/, '')}/${destination.replace(/^\.\//, '')}`;
      if (automation.nodeType.includes('copy')) {
        const textResult = await window.nexus.files.readTextFile(absolute);
        const text =
          typeof textResult === 'string'
            ? textResult
            : textResult && typeof textResult === 'object' && 'content' in textResult
              ? String((textResult as { content?: unknown }).content ?? '')
              : '';
        await window.nexus.files.writeTextFile(destAbsolute, text);
        return { ok: true, output: { from: absolute, to: destAbsolute } };
      }
      await window.nexus.files.moveEntry(absolute, destAbsolute);
      return { ok: true, output: { from: absolute, to: destAbsolute } };
    }

    const textResult = await window.nexus.files.readTextFile(absolute);
    const text =
      typeof textResult === 'string'
        ? textResult
        : textResult && typeof textResult === 'object' && 'content' in textResult
          ? String((textResult as { content?: unknown }).content ?? '')
          : '';
    return { ok: true, output: { path: absolute, content: text } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Falha em operação de arquivo.',
    };
  }
}

export async function runMissionAutomationNode(input: {
  missionId: string;
  nodeId: string;
}): Promise<MissionAutomationRunResult> {
  const store = useMissionStore.getState();
  const mission = store.getMissionById(input.missionId);
  if (!mission) {
    return { ok: false, error: 'Missão não encontrada.' };
  }

  const node = mission.nodes.find((entry) => entry.id === input.nodeId);
  if (!node || !isMissionAutomationNode(node) || !node.automation) {
    return { ok: false, error: 'Nó de automação inválido.' };
  }

  const automation = node.automation;
  const upstream = collectUpstreamOutput(mission, node.id);
  const nodeType = automation.nodeType;
  const category = automation.category;
  const catalogId = configString(automation.config, 'catalogId');

  if (
    category === 'human' ||
    nodeType.includes('approval') ||
    nodeType.includes('confirm') ||
    catalogId.startsWith('human.')
  ) {
    const existing = mission.inbox.find(
      (item) => item.nodeId === node.id && !item.resolvedAt && item.kind === 'approval',
    );
    if (!existing) {
      await store.upsertInboxItem(mission.id, {
        id: crypto.randomUUID(),
        missionId: mission.id,
        nodeId: node.id,
        kind: 'approval',
        title: `Aprovação: ${node.name ?? 'Nó'}`,
        message: configString(automation.config, 'message', 'Confirme para continuar este fluxo.'),
        createdAt: new Date().toISOString(),
        actions: [
          { id: 'approve', label: 'Aprovar' },
          { id: 'reject', label: 'Rejeitar' },
        ],
      });
    }
    return { ok: true, waitingApproval: true };
  }

  if (
    nodeType.includes('delay') ||
    nodeType.includes('wait') ||
    catalogId.includes('delay') ||
    catalogId.includes('wait')
  ) {
    const delayMs = Math.max(0, configNumber(automation.config, 'delayMs', 1000));
    await new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });
    return { ok: true, output: { delayedMs: delayMs, ...upstream } };
  }

  if (nodeType.includes('stop') || catalogId.includes('stop')) {
    return { ok: false, error: 'Fluxo interrompido pelo nó Stop.', output: { stopped: true } };
  }

  if (
    nodeType.includes('if') ||
    nodeType.includes('condition') ||
    catalogId.includes('.if') ||
    catalogId.includes('condition')
  ) {
    const expression = configString(automation.config, 'expression', 'true');
    const result = Boolean(evaluateExpression(expression, upstream));
    return {
      ok: result,
      error: result ? undefined : 'Condição falsa.',
      output: { condition: result, expression, ...upstream },
    };
  }

  if (nodeType.includes('switch') || catalogId.includes('switch')) {
    const value = String(
      evaluateExpression(configString(automation.config, 'value', ''), upstream) ?? '',
    );
    const casesRaw = configString(automation.config, 'cases', '');
    return {
      ok: true,
      output: { switchValue: value, cases: casesRaw, ...upstream },
    };
  }

  if (catalogId.startsWith('http.') || category === 'http' || nodeType.startsWith('http')) {
    if (catalogId.includes('rest') && !configString(automation.config, 'url')) {
      const baseUrl = configString(automation.config, 'baseUrl').replace(/\/$/, '');
      const pathValue = configString(automation.config, 'path');
      const composed = `${baseUrl}${pathValue.startsWith('/') ? pathValue : `/${pathValue}`}`;
      return runHttpRequest({
        ...automation,
        config: { ...automation.config, url: composed },
      });
    }
    return runHttpRequest(automation);
  }

  if (
    catalogId.includes('expression') ||
    catalogId.includes('json_transform') ||
    nodeType.includes('expression') ||
    nodeType.includes('json')
  ) {
    const expression = configString(
      automation.config,
      'expression',
      configString(automation.config, 'code', ''),
    );
    try {
      const result = evaluateExpression(expression, upstream);
      return { ok: true, output: { result, ...upstream } };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Expressão inválida.',
      };
    }
  }

  if (
    catalogId.includes('shell') ||
    nodeType.includes('shell') ||
    (category === 'code' && Boolean(configString(automation.config, 'command')))
  ) {
    return runShell(node, automation);
  }

  if (category === 'code') {
    const code = configString(automation.config, 'code', '');
    if (!code.trim()) {
      return { ok: true, output: { skipped: true, reason: 'Código vazio.', ...upstream } };
    }
    try {
      const result = evaluateExpression(code.replace(/^return\s+/, ''), {
        ...upstream,
        input: upstream,
      });
      return { ok: true, output: { result, ...upstream } };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Falha ao avaliar código.',
      };
    }
  }

  if (category === 'files' || catalogId.startsWith('files.') || nodeType.includes('file')) {
    return runFileOp(node, automation);
  }

  if (category === 'engineering' || catalogId.startsWith('engineering.')) {
    const command =
      configString(automation.config, 'command') ||
      (catalogId.includes('lint')
        ? 'npm run lint'
        : catalogId.includes('type')
          ? 'npx tsc --noEmit'
          : catalogId.includes('test')
            ? 'npm test'
            : catalogId.includes('build')
              ? 'npm run build'
              : '');
    if (!command) {
      return {
        ok: true,
        output: {
          skipped: true,
          reason: 'Configure o comando de engineering neste nó.',
          ...upstream,
        },
      };
    }
    return runShell(node, {
      ...automation,
      config: { ...automation.config, command },
    });
  }

  if (category === 'git' || catalogId.startsWith('git.')) {
    if (catalogId.includes('commit')) {
      const message = configString(automation.config, 'message', 'chore: mission automation');
      const command =
        configString(automation.config, 'command') || `git commit -m ${shellSingleQuote(message)}`;
      return runShell(node, {
        ...automation,
        config: { ...automation.config, command },
      });
    }

    if (catalogId.includes('branch')) {
      const branch = configString(automation.config, 'branch', 'mission-branch');
      if (!isSafeGitRef(branch)) {
        return { ok: false, error: 'Nome de branch inválido.' };
      }
      const command = configString(automation.config, 'command') || `git checkout -b ${branch}`;
      return runShell(node, {
        ...automation,
        config: { ...automation.config, command },
      });
    }

    const command =
      configString(automation.config, 'command') ||
      (catalogId.includes('status')
        ? 'git status --short'
        : catalogId.includes('pull')
          ? 'git pull'
          : catalogId.includes('push')
            ? 'git push'
            : 'git status --short');
    return runShell(node, {
      ...automation,
      config: { ...automation.config, command },
    });
  }

  if (nodeType === 'integration' || automation.provider || catalogId.startsWith('integration.')) {
    const provider = automation.provider ?? 'unknown';
    const action = automation.action ?? configString(automation.config, 'action', '');
    return {
      ok: false,
      error: `Integração ${provider}/${action || 'action'} ainda sem credencial configurada no Nexus.`,
      output: {
        provider,
        action,
        config: automation.config,
        ...upstream,
      },
    };
  }

  if (
    category === 'triggers' ||
    nodeType.includes('trigger') ||
    nodeType.includes('manual') ||
    catalogId.startsWith('trigger.')
  ) {
    return { ok: true, output: { triggered: true, at: new Date().toISOString(), ...upstream } };
  }

  if (
    category === 'flow' ||
    category === 'data' ||
    category === 'visualization' ||
    category === 'nexus' ||
    category === 'brain'
  ) {
    return {
      ok: true,
      output: {
        passthrough: true,
        nodeType,
        catalogId,
        ...upstream,
        ...(configString(automation.config, 'value')
          ? { value: configString(automation.config, 'value') }
          : {}),
      },
    };
  }

  return {
    ok: true,
    output: {
      completed: true,
      nodeType,
      category,
      catalogId,
      ...upstream,
    },
  };
}
