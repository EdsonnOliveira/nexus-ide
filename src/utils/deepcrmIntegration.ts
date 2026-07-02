export function formatDeepcrmIntegrationError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Falha ao conectar';
  const normalized = message
    .replace(/^Error invoking remote method '[^']+': Error: /, '')
    .replace(/^Error invoking remote method '[^']+': /, '');

  if (/Unauthorized|Invalid or missing API token/i.test(normalized)) {
    return 'Token da API inválido ou ausente. Gere um token em Configurações → API e Webhooks no DeepCRM.';
  }

  if (/Configuração do DeepCRM incompleta|Informe o token da API do DeepCRM/i.test(normalized)) {
    return 'Token da API do DeepCRM não configurado. Abra Integração de tarefas e informe o token gerado em API e Webhooks.';
  }

  if (/Token da API do DeepCRM ilegível|ilegível/i.test(normalized)) {
    return 'Token do DeepCRM não pôde ser lido. Abra Integração de tarefas, cole o token novamente e salve.';
  }

  if (/Not Found/i.test(normalized)) {
    return 'Endpoint da API não encontrado. Atualize o Nexus IDE para a versão mais recente.';
  }

  return normalized;
}

export function formatDeepcrmHealthLabel(healthScore?: string, numeric?: number): string | undefined {
  const normalized = healthScore?.trim().toLowerCase();

  if (normalized) {
    if (/healthy|saud|green|good|ok/.test(normalized)) {
      return 'Saudável';
    }

    if (/attention|atenc|warning|yellow|medium/.test(normalized)) {
      return 'Atenção';
    }

    if (/risk|at_risk|danger|red|critical|churn/.test(normalized)) {
      return 'Em risco';
    }

    return healthScore;
  }

  if (typeof numeric === 'number' && Number.isFinite(numeric)) {
    if (numeric >= 70) {
      return 'Saudável';
    }

    if (numeric >= 40) {
      return 'Atenção';
    }

    return 'Em risco';
  }

  return undefined;
}

export function resolveDeepcrmHealthBadgeClass(label?: string): string {
  if (label === 'Saudável') {
    return 'task-detail-modal__health-badge--healthy';
  }

  if (label === 'Atenção') {
    return 'task-detail-modal__health-badge--attention';
  }

  if (label === 'Em risco') {
    return 'task-detail-modal__health-badge--risk';
  }

  return '';
}

export function formatDeepcrmProjectStatus(status?: string): string | undefined {
  const normalized = status?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (normalized === 'active') {
    return 'Ativo';
  }

  if (normalized === 'churned') {
    return 'Encerrado';
  }

  if (normalized === 'paused') {
    return 'Pausado';
  }

  return status;
}

export function formatDeepcrmSubtaskStatus(status?: string): string {
  const normalized = status?.trim().toLowerCase();

  if (normalized === 'todo' || status === 'A fazer') {
    return 'A fazer';
  }

  if (normalized === 'doing' || status === 'Fazendo') {
    return 'Fazendo';
  }

  if (normalized === 'done' || status === 'Concluído') {
    return 'Concluído';
  }

  return status ?? 'A fazer';
}

export function resolveDeepcrmSubtaskBadgeClass(status?: string): string {
  const label = formatDeepcrmSubtaskStatus(status);

  if (label === 'Concluído') {
    return 'task-detail-modal__deepcrm-subtask-badge--done';
  }

  if (label === 'Fazendo') {
    return 'task-detail-modal__deepcrm-subtask-badge--doing';
  }

  return 'task-detail-modal__deepcrm-subtask-badge--todo';
}

export function formatDeepcrmMrr(mrr?: number): string | undefined {
  if (typeof mrr !== 'number' || !Number.isFinite(mrr)) {
    return undefined;
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(mrr);
}

export function buildDeepcrmTaskUrl(taskId: string): string | null {
  const id = taskId.trim().replace(/^DC-P-/, '');

  if (!id) {
    return null;
  }

  return `https://app.deepcrm.app/projects/${encodeURIComponent(id)}`;
}
