export function streamChunkIndicatesPlanWaiting(chunk: string): boolean {
  if (!chunk) {
    return false;
  }
  if (
    !chunk.includes('createPlan') &&
    !chunk.includes('CreatePlan') &&
    !chunk.includes('create_plan')
  ) {
    return false;
  }

  const lines = chunk.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (recordHasCreatePlan(parsed)) {
        return true;
      }
      const message = parsed.message;
      if (message && typeof message === 'object' && recordHasCreatePlan(message as Record<string, unknown>)) {
        return true;
      }
      const toolCall = parsed.tool_call ?? parsed.toolCall;
      if (toolCall && typeof toolCall === 'object' && recordHasCreatePlan(toolCall as Record<string, unknown>)) {
        return true;
      }
    } catch {
    }
  }

  return (
    chunk.includes('"createPlanToolCall"') ||
    chunk.includes('"createPlan"') ||
    chunk.includes('CreatePlan')
  );
}

function recordHasCreatePlan(record: Record<string, unknown>): boolean {
  if (record.createPlanToolCall || record.createPlan) {
    return true;
  }
  const name = String(record.name ?? record.toolName ?? record.tool_name ?? '');
  return /createplan/i.test(name);
}
