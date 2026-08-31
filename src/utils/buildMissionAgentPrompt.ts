import { getBuiltinRoleById } from '@/constants/agentRoles';
import { getBuiltinTemplateById } from '@/constants/agentTemplates';
import type { Mission, MissionAgentNode, MissionDiscovery, ContextCapsule } from '@/types/mission';
import type { AgentRole, AgentTemplate } from '@/types/mission';

const NEXUS_BASE_INSTRUCTIONS = `Você está operando dentro do Nexus IDE como parte de uma Missão orquestrada.
Siga estritamente o papel e o objetivo atribuídos.
Não ultrapasse as permissões do papel.
Entregue um resultado claro e acionável ao final.`;

export function buildMissionAgentPrompt(input: {
  mission: Mission;
  node: MissionAgentNode;
  roles: AgentRole[];
  templates: AgentTemplate[];
  handoffText?: string;
  discoveries?: MissionDiscovery[];
  capsules?: ContextCapsule[];
}): string {
  const role =
    input.roles.find((entry) => entry.id === input.node.roleId) ??
    getBuiltinRoleById(input.node.roleId);
  const template =
    input.templates.find((entry) => entry.id === input.node.agentTemplateId) ??
    getBuiltinTemplateById(input.node.agentTemplateId);

  const sections: string[] = [NEXUS_BASE_INSTRUCTIONS];

  if (template || input.node.identity?.trim()) {
    const identityText =
      input.node.identity?.trim() || template?.instructions?.trim() || '';
    const identityName =
      input.node.name?.trim() || template?.name || 'Agent';
    if (identityText) {
      sections.push(`# Identidade do Agent\nNome: ${identityName}\n${identityText}`);
    }
  }

  if (role) {
    sections.push(
      `# Papel\nNome: ${role.name}\n${role.instructions}\nPermissões: ${role.permissions.join(', ')}${
        role.expectedOutput ? `\nSaída esperada: ${role.expectedOutput}` : ''
      }`,
    );
  }

  sections.push(
    `# Missão\nTítulo: ${input.mission.title}${
      input.mission.description ? `\nDescrição: ${input.mission.description}` : ''
    }`,
  );

  if (input.handoffText?.trim()) {
    sections.push(`# Handoffs recebidos\n${input.handoffText.trim()}`);
  }

  const sharedDiscoveries = (input.discoveries ?? input.mission.discoveries).filter(
    (discovery) =>
      discovery.sharedWithNodeIds.length === 0 ||
      discovery.sharedWithNodeIds.includes(input.node.id),
  );

  if (sharedDiscoveries.length > 0) {
    sections.push(
      `# Descobertas compartilhadas\n${sharedDiscoveries
        .map((discovery) => `- ${discovery.content}`)
        .join('\n')}`,
    );
  }

  const capsules = input.capsules ?? input.mission.capsules;

  if (capsules.length > 0) {
    sections.push(
      `# Cápsulas de contexto\n${capsules
        .map((capsule) => `- ${capsule.title}: ${capsule.content}`)
        .join('\n')}`,
    );
  }

  if (input.node.injectedContext?.trim()) {
    sections.push(`# Contexto injetado\n${input.node.injectedContext.trim()}`);
  }

  const attachments = input.mission.attachments ?? [];

  if (attachments.length > 0) {
    sections.push(
      `# Evidências do objetivo\nArquivos anexados à missão — use como evidência para o diagnóstico:\n${attachments
        .map((attachment) => `- ${attachment.name} (${attachment.path})`)
        .join('\n')}`,
    );
  }

  sections.push(`# Objetivo do nó\n${input.node.objective}`);

  sections.push(
    `# Iteração\n${input.node.iteration} de ${input.node.maxIterations}\nTentativa ${input.node.attempt + 1} de ${input.node.maxAttempts}`,
  );

  return sections.join('\n\n');
}
