export type MissionAutomationFieldType = 'text' | 'number' | 'boolean' | 'select' | 'textarea';

export interface MissionAutomationField {
  key: string;
  label: string;
  type: MissionAutomationFieldType;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  required?: boolean;
}

export interface MissionAutomationActionDef {
  value: string;
  label: string;
  fields?: MissionAutomationField[];
}

export interface MissionAutomationCatalogEntry {
  id: string;
  label: string;
  category: string;
  categoryLabel: string;
  nodeType: string;
  provider?: string;
  action?: string;
  actions?: MissionAutomationActionDef[];
  defaultConfig: Record<string, string | number | boolean | null>;
  fields: MissionAutomationField[];
  keywords?: string[];
}

export const MISSION_AUTOMATION_CATEGORY_ORDER: string[] = [
  'triggers',
  'flow',
  'human',
  'http',
  'code',
  'data',
  'brain',
  'database',
  'git',
  'engineering',
  'deploy',
  'browser',
  'emulator',
  'messaging',
  'email',
  'project',
  'docs',
  'spreadsheet',
  'storage',
  'security',
  'notifications',
  'payments',
  'monitoring',
  'forms',
  'calendar',
  'search',
  'files',
  'media',
  'nexus',
  'visualization',
];

const CATEGORY_LABELS: Record<string, string> = {
  triggers: 'Triggers',
  flow: 'Flow Control',
  human: 'Interação Humana',
  http: 'HTTP / API',
  code: 'Code',
  data: 'Data',
  brain: 'Memory / Brain',
  database: 'Database',
  git: 'Git / GitHub',
  engineering: 'Engineering',
  deploy: 'Deploy / DevOps',
  browser: 'Browser',
  emulator: 'Emulator / Mobile',
  messaging: 'Messaging',
  email: 'Email',
  project: 'Project Management',
  docs: 'Docs / Knowledge',
  spreadsheet: 'Spreadsheet',
  storage: 'Storage',
  security: 'Security',
  notifications: 'Notifications',
  payments: 'Payments',
  monitoring: 'Monitoring',
  forms: 'Forms',
  calendar: 'Calendar',
  search: 'Search',
  files: 'Files',
  media: 'Media',
  nexus: 'NEXUS Native',
  visualization: 'Visualization',
};

function field(
  key: string,
  label: string,
  type: MissionAutomationFieldType,
  extras?: Partial<Omit<MissionAutomationField, 'key' | 'label' | 'type'>>,
): MissionAutomationField {
  return { key, label, type, ...extras };
}

function text(
  key: string,
  label: string,
  extras?: Partial<Omit<MissionAutomationField, 'key' | 'label' | 'type'>>,
): MissionAutomationField {
  return field(key, label, 'text', extras);
}

function area(
  key: string,
  label: string,
  extras?: Partial<Omit<MissionAutomationField, 'key' | 'label' | 'type'>>,
): MissionAutomationField {
  return field(key, label, 'textarea', extras);
}

function num(
  key: string,
  label: string,
  extras?: Partial<Omit<MissionAutomationField, 'key' | 'label' | 'type'>>,
): MissionAutomationField {
  return field(key, label, 'number', extras);
}

function bool(
  key: string,
  label: string,
  extras?: Partial<Omit<MissionAutomationField, 'key' | 'label' | 'type'>>,
): MissionAutomationField {
  return field(key, label, 'boolean', extras);
}

function select(
  key: string,
  label: string,
  options: Array<{ value: string; label: string }>,
  extras?: Partial<Omit<MissionAutomationField, 'key' | 'label' | 'type' | 'options'>>,
): MissionAutomationField {
  return field(key, label, 'select', { options, ...extras });
}

function action(
  value: string,
  label: string,
  fields?: MissionAutomationField[],
): MissionAutomationActionDef {
  return { value, label, fields };
}

function node(
  partial: Omit<MissionAutomationCatalogEntry, 'defaultConfig' | 'fields'> & {
    defaultConfig?: Record<string, string | number | boolean | null>;
    fields?: MissionAutomationField[];
  },
): MissionAutomationCatalogEntry {
  return {
    ...partial,
    defaultConfig: partial.defaultConfig ?? {},
    fields: partial.fields ?? [],
  };
}

function integration(
  provider: string,
  label: string,
  category: string,
  categoryLabel: string,
  actions: MissionAutomationActionDef[],
  extras?: {
    keywords?: string[];
    fields?: MissionAutomationField[];
    defaultConfig?: Record<string, string | number | boolean | null>;
  },
): MissionAutomationCatalogEntry {
  const first = actions[0]?.value ?? '';
  return node({
    id: `integration.${provider}`,
    label,
    category,
    categoryLabel,
    nodeType: 'integration',
    provider,
    action: first,
    actions,
    defaultConfig: { action: first, ...(extras?.defaultConfig ?? {}) },
    fields: [
      select(
        'action',
        'Ação',
        actions.map((item) => ({ value: item.value, label: item.label })),
        { required: true },
      ),
      ...(extras?.fields ?? []),
    ],
    keywords: extras?.keywords ?? [provider, label],
  });
}

const HTTP_METHODS = [
  { value: 'GET', label: 'GET' },
  { value: 'POST', label: 'POST' },
  { value: 'PUT', label: 'PUT' },
  { value: 'PATCH', label: 'PATCH' },
  { value: 'DELETE', label: 'DELETE' },
];

const msgFields = [
  text('to', 'Destinatário', { required: true, placeholder: 'canal, usuário ou telefone' }),
  area('message', 'Mensagem', { required: true }),
];

const taskFields = [
  text('title', 'Título', { required: true }),
  area('description', 'Descrição'),
  text('assignee', 'Responsável'),
];

const docFields = [
  text('documentId', 'ID do documento'),
  text('title', 'Título'),
  area('content', 'Conteúdo'),
];

const rowFields = [
  text('sheet', 'Planilha / tabela', { required: true }),
  area('values', 'Valores (JSON)', { placeholder: '{}' }),
];

const storageFields = [
  text('bucket', 'Bucket', { required: true }),
  text('path', 'Caminho', { required: true }),
  text('localPath', 'Caminho local'),
];

const dbActionFields = [
  area('query', 'Query / comando', { required: true, placeholder: 'SELECT ...' }),
  text('connection', 'Conexão / URL'),
];

const paymentFields = [
  text('amount', 'Valor', { required: true }),
  text('currency', 'Moeda', { placeholder: 'BRL' }),
  text('customerId', 'Cliente'),
  area('metadata', 'Metadata (JSON)'),
];

export const MISSION_AUTOMATION_CATALOG: MissionAutomationCatalogEntry[] = [
  node({
    id: 'trigger.manual',
    label: 'Manual Trigger',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    keywords: ['manual', 'start', 'iniciar'],
  }),
  node({
    id: 'trigger.webhook',
    label: 'Webhook Trigger',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { path: '/hooks/mission', method: 'POST' },
    fields: [
      text('path', 'Caminho', { required: true, placeholder: '/hooks/mission' }),
      select('method', 'Método', HTTP_METHODS, { required: true }),
      area('secret', 'Segredo'),
    ],
    keywords: ['webhook', 'http'],
  }),
  node({
    id: 'trigger.schedule',
    label: 'Schedule / Cron',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { cron: '0 * * * *', timezone: 'America/Sao_Paulo' },
    fields: [
      text('cron', 'Expressão cron', { required: true, placeholder: '0 * * * *' }),
      text('timezone', 'Fuso horário', { placeholder: 'America/Sao_Paulo' }),
    ],
    keywords: ['cron', 'schedule', 'agendar'],
  }),
  node({
    id: 'trigger.interval',
    label: 'Interval',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { intervalMs: 60000 },
    fields: [num('intervalMs', 'Intervalo (ms)', { required: true, placeholder: '60000' })],
    keywords: ['interval', 'timer'],
  }),
  node({
    id: 'trigger.app_event',
    label: 'App Event',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { eventName: '' },
    fields: [text('eventName', 'Nome do evento', { required: true })],
  }),
  node({
    id: 'trigger.database_event',
    label: 'Database Event',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { table: '', event: 'insert' },
    fields: [
      text('table', 'Tabela', { required: true }),
      select(
        'event',
        'Evento',
        [
          { value: 'insert', label: 'Insert' },
          { value: 'update', label: 'Update' },
          { value: 'delete', label: 'Delete' },
        ],
        { required: true },
      ),
    ],
  }),
  node({
    id: 'trigger.file_changed',
    label: 'File Changed',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { path: '', pattern: '*' },
    fields: [
      text('path', 'Caminho', { required: true }),
      text('pattern', 'Padrão', { placeholder: '**/*.{ts,tsx}' }),
    ],
  }),
  node({
    id: 'trigger.git_push',
    label: 'Git Push',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { branch: 'main', remote: 'origin' },
    fields: [text('branch', 'Branch'), text('remote', 'Remote')],
  }),
  node({
    id: 'trigger.pull_request',
    label: 'Pull Request',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { repository: '', event: 'opened' },
    fields: [
      text('repository', 'Repositório', { required: true }),
      select(
        'event',
        'Evento',
        [
          { value: 'opened', label: 'Opened' },
          { value: 'synchronize', label: 'Synchronize' },
          { value: 'closed', label: 'Closed' },
          { value: 'merged', label: 'Merged' },
        ],
        { required: true },
      ),
    ],
  }),
  node({
    id: 'trigger.issue_created',
    label: 'Issue Created',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { repository: '', labels: '' },
    fields: [text('repository', 'Repositório'), text('labels', 'Labels')],
  }),
  node({
    id: 'trigger.message_received',
    label: 'Message Received',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { channel: '', provider: 'any' },
    fields: [
      text('channel', 'Canal'),
      select(
        'provider',
        'Provedor',
        [
          { value: 'any', label: 'Qualquer' },
          { value: 'slack', label: 'Slack' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'discord', label: 'Discord' },
          { value: 'telegram', label: 'Telegram' },
        ],
      ),
    ],
  }),
  node({
    id: 'trigger.email_received',
    label: 'Email Received',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { inbox: '', from: '', subjectContains: '' },
    fields: [
      text('inbox', 'Caixa de entrada'),
      text('from', 'De'),
      text('subjectContains', 'Assunto contém'),
    ],
  }),
  node({
    id: 'trigger.form_submitted',
    label: 'Form Submitted',
    category: 'triggers',
    categoryLabel: 'Triggers',
    nodeType: 'trigger',
    defaultConfig: { formId: '' },
    fields: [text('formId', 'ID do formulário', { required: true })],
  }),

  node({
    id: 'flow.if',
    label: 'If / Else',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'condition',
    defaultConfig: { expression: '' },
    fields: [area('expression', 'Expressão', { required: true, placeholder: 'status === "ok"' })],
    keywords: ['if', 'else', 'condition'],
  }),
  node({
    id: 'flow.switch',
    label: 'Switch',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'condition',
    defaultConfig: { value: '', cases: '' },
    fields: [
      text('value', 'Valor', { required: true }),
      area('cases', 'Casos (JSON)', { required: true, placeholder: '["a","b"]' }),
    ],
  }),
  node({
    id: 'flow.router',
    label: 'Router',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'condition',
    defaultConfig: { routes: '' },
    fields: [area('routes', 'Rotas (JSON)', { required: true })],
  }),
  node({
    id: 'flow.merge',
    label: 'Merge',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { mode: 'wait_all' },
    fields: [
      select(
        'mode',
        'Modo',
        [
          { value: 'wait_all', label: 'Aguardar todos' },
          { value: 'wait_any', label: 'Aguardar qualquer' },
        ],
      ),
    ],
  }),
  node({
    id: 'flow.split',
    label: 'Split',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { field: '', separator: ',' },
    fields: [text('field', 'Campo', { required: true }), text('separator', 'Separador')],
  }),
  node({
    id: 'flow.fork',
    label: 'Fork',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { branches: 2 },
    fields: [num('branches', 'Ramificações', { required: true })],
  }),
  node({
    id: 'flow.join',
    label: 'Join',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { mode: 'wait_all' },
    fields: [
      select(
        'mode',
        'Modo',
        [
          { value: 'wait_all', label: 'Aguardar todos' },
          { value: 'wait_any', label: 'Aguardar qualquer' },
        ],
      ),
    ],
  }),
  node({
    id: 'flow.parallel',
    label: 'Parallel',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { maxConcurrency: 4 },
    fields: [num('maxConcurrency', 'Concorrência máxima')],
  }),
  node({
    id: 'flow.loop',
    label: 'Loop',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'loop',
    defaultConfig: { count: 1 },
    fields: [num('count', 'Repetições', { required: true })],
  }),
  node({
    id: 'flow.for_each',
    label: 'For Each',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'loop',
    defaultConfig: { itemsPath: '', concurrency: 1 },
    fields: [
      text('itemsPath', 'Caminho dos itens', { required: true, placeholder: 'items' }),
      num('concurrency', 'Concorrência'),
    ],
  }),
  node({
    id: 'flow.while',
    label: 'While',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'loop',
    defaultConfig: { expression: '', maxIterations: 100 },
    fields: [
      area('expression', 'Condição', { required: true }),
      num('maxIterations', 'Máx. iterações'),
    ],
  }),
  node({
    id: 'flow.wait',
    label: 'Wait',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'delay',
    defaultConfig: { until: '' },
    fields: [text('until', 'Aguardar até', { placeholder: 'ISO date ou expressão' })],
  }),
  node({
    id: 'flow.delay',
    label: 'Delay',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'delay',
    defaultConfig: { delayMs: 1000 },
    fields: [num('delayMs', 'Delay (ms)', { required: true, placeholder: '1000' })],
    keywords: ['wait', 'sleep', 'delay'],
  }),
  node({
    id: 'flow.retry',
    label: 'Retry',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { maxAttempts: 3, delayMs: 1000 },
    fields: [num('maxAttempts', 'Tentativas', { required: true }), num('delayMs', 'Delay (ms)')],
  }),
  node({
    id: 'flow.stop',
    label: 'Stop',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { reason: '' },
    fields: [text('reason', 'Motivo')],
  }),
  node({
    id: 'flow.continue',
    label: 'Continue',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
  }),
  node({
    id: 'flow.fallback',
    label: 'Fallback',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { expression: '' },
    fields: [area('expression', 'Condição de fallback')],
  }),
  node({
    id: 'flow.error_handler',
    label: 'Error Handler',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { catchAll: true },
    fields: [bool('catchAll', 'Capturar todos')],
  }),
  node({
    id: 'flow.try_catch',
    label: 'Try / Catch',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { continueOnError: false },
    fields: [bool('continueOnError', 'Continuar em erro')],
  }),
  node({
    id: 'flow.rate_limit',
    label: 'Rate Limit',
    category: 'flow',
    categoryLabel: 'Flow Control',
    nodeType: 'action',
    defaultConfig: { maxPerMinute: 60 },
    fields: [num('maxPerMinute', 'Máx. por minuto', { required: true })],
  }),

  node({
    id: 'human.approval',
    label: 'Approval',
    category: 'human',
    categoryLabel: 'Interação Humana',
    nodeType: 'approval',
    defaultConfig: { message: '', timeoutMs: 0 },
    fields: [area('message', 'Mensagem', { required: true }), num('timeoutMs', 'Timeout (ms)')],
  }),
  node({
    id: 'human.input',
    label: 'Human Input',
    category: 'human',
    categoryLabel: 'Interação Humana',
    nodeType: 'approval',
    defaultConfig: { prompt: '', inputType: 'text' },
    fields: [
      area('prompt', 'Pergunta', { required: true }),
      select(
        'inputType',
        'Tipo de entrada',
        [
          { value: 'text', label: 'Texto' },
          { value: 'boolean', label: 'Sim/Não' },
          { value: 'select', label: 'Seleção' },
        ],
      ),
    ],
  }),
  node({
    id: 'human.review_required',
    label: 'Review Required',
    category: 'human',
    categoryLabel: 'Interação Humana',
    nodeType: 'approval',
    defaultConfig: { checklist: '' },
    fields: [area('checklist', 'Checklist')],
  }),
  node({
    id: 'human.confirmation',
    label: 'Confirmation',
    category: 'human',
    categoryLabel: 'Interação Humana',
    nodeType: 'approval',
    defaultConfig: { message: 'Confirmar continuidade?' },
    fields: [area('message', 'Mensagem', { required: true })],
  }),
  node({
    id: 'human.manual_intervention',
    label: 'Manual Intervention',
    category: 'human',
    categoryLabel: 'Interação Humana',
    nodeType: 'approval',
    defaultConfig: { instructions: '' },
    fields: [area('instructions', 'Instruções', { required: true })],
  }),
  node({
    id: 'human.assign_person',
    label: 'Assign Person',
    category: 'human',
    categoryLabel: 'Interação Humana',
    nodeType: 'approval',
    defaultConfig: { person: '', role: '' },
    fields: [text('person', 'Pessoa', { required: true }), text('role', 'Papel')],
  }),

  node({
    id: 'http.request',
    label: 'HTTP Request',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { method: 'GET', url: '', headers: '', body: '' },
    fields: [
      select('method', 'Método', HTTP_METHODS, { required: true }),
      text('url', 'URL', { required: true, placeholder: 'https://' }),
      area('headers', 'Headers (JSON)', { placeholder: '{}' }),
      area('body', 'Body', { placeholder: '{}' }),
    ],
    keywords: ['http', 'api', 'rest'],
  }),
  node({
    id: 'http.rest_api',
    label: 'REST API',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { method: 'GET', baseUrl: '', path: '', headers: '', body: '' },
    fields: [
      select('method', 'Método', HTTP_METHODS, { required: true }),
      text('baseUrl', 'Base URL', { required: true }),
      text('path', 'Path', { required: true }),
      area('headers', 'Headers (JSON)'),
      area('body', 'Body'),
    ],
  }),
  node({
    id: 'http.graphql',
    label: 'GraphQL',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { url: '', query: '', variables: '' },
    fields: [
      text('url', 'Endpoint', { required: true }),
      area('query', 'Query', { required: true }),
      area('variables', 'Variables (JSON)'),
    ],
  }),
  node({
    id: 'http.webhook_response',
    label: 'Webhook Response',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { statusCode: 200, body: '' },
    fields: [num('statusCode', 'Status HTTP', { required: true }), area('body', 'Body')],
  }),
  node({
    id: 'http.download_file',
    label: 'Download File',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { url: '', destination: '' },
    fields: [
      text('url', 'URL', { required: true }),
      text('destination', 'Destino', { required: true }),
    ],
  }),
  node({
    id: 'http.upload_file',
    label: 'Upload File',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { url: '', filePath: '', fieldName: 'file' },
    fields: [
      text('url', 'URL', { required: true }),
      text('filePath', 'Arquivo', { required: true }),
      text('fieldName', 'Campo form'),
    ],
  }),
  node({
    id: 'http.oauth_request',
    label: 'OAuth Request',
    category: 'http',
    categoryLabel: 'HTTP / API',
    nodeType: 'action',
    defaultConfig: { provider: '', tokenUrl: '', clientId: '', scopes: '' },
    fields: [
      text('provider', 'Provedor'),
      text('tokenUrl', 'Token URL', { required: true }),
      text('clientId', 'Client ID', { required: true }),
      text('scopes', 'Scopes'),
    ],
  }),

  node({
    id: 'code.javascript',
    label: 'JavaScript',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'code',
    defaultConfig: { code: 'return input;' },
    fields: [area('code', 'Código', { required: true })],
  }),
  node({
    id: 'code.typescript',
    label: 'TypeScript',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'code',
    defaultConfig: { code: 'return input;' },
    fields: [area('code', 'Código', { required: true })],
  }),
  node({
    id: 'code.python',
    label: 'Python',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'code',
    defaultConfig: { code: 'return input' },
    fields: [area('code', 'Código', { required: true })],
  }),
  node({
    id: 'code.shell',
    label: 'Shell Command',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'code',
    defaultConfig: { command: '', cwd: '' },
    fields: [
      area('command', 'Comando', { required: true, placeholder: 'npm test' }),
      text('cwd', 'Diretório', { placeholder: '.' }),
    ],
    keywords: ['shell', 'bash', 'terminal', 'command'],
  }),
  node({
    id: 'code.custom',
    label: 'Custom Code',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'code',
    defaultConfig: { language: 'javascript', code: '' },
    fields: [
      select(
        'language',
        'Linguagem',
        [
          { value: 'javascript', label: 'JavaScript' },
          { value: 'typescript', label: 'TypeScript' },
          { value: 'python', label: 'Python' },
          { value: 'shell', label: 'Shell' },
        ],
      ),
      area('code', 'Código', { required: true }),
    ],
  }),
  node({
    id: 'code.expression',
    label: 'Expression',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'transform',
    defaultConfig: { expression: '' },
    fields: [area('expression', 'Expressão', { required: true })],
  }),
  node({
    id: 'code.json_transform',
    label: 'JSON Transform',
    category: 'code',
    categoryLabel: 'Code',
    nodeType: 'transform',
    defaultConfig: { expression: '' },
    fields: [
      area('expression', 'Expressão', { required: true, placeholder: '$.items[*].id' }),
    ],
    keywords: ['json', 'transform', 'jq'],
  }),

  node({
    id: 'data.set',
    label: 'Set Data',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { key: '', value: '' },
    fields: [text('key', 'Chave', { required: true }), area('value', 'Valor', { required: true })],
  }),
  node({
    id: 'data.map_fields',
    label: 'Map Fields',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { mapping: '' },
    fields: [area('mapping', 'Mapeamento (JSON)', { required: true })],
  }),
  node({
    id: 'data.filter',
    label: 'Filter',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { expression: '' },
    fields: [area('expression', 'Expressão de filtro', { required: true })],
  }),
  node({
    id: 'data.sort',
    label: 'Sort',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { field: '', direction: 'asc' },
    fields: [
      text('field', 'Campo', { required: true }),
      select(
        'direction',
        'Direção',
        [
          { value: 'asc', label: 'Ascendente' },
          { value: 'desc', label: 'Descendente' },
        ],
      ),
    ],
  }),
  node({
    id: 'data.aggregate',
    label: 'Aggregate',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { field: '', operation: 'sum' },
    fields: [
      text('field', 'Campo', { required: true }),
      select(
        'operation',
        'Operação',
        [
          { value: 'sum', label: 'Soma' },
          { value: 'avg', label: 'Média' },
          { value: 'count', label: 'Contagem' },
          { value: 'min', label: 'Mínimo' },
          { value: 'max', label: 'Máximo' },
        ],
      ),
    ],
  }),
  node({
    id: 'data.group',
    label: 'Group',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { field: '' },
    fields: [text('field', 'Campo', { required: true })],
  }),
  node({
    id: 'data.deduplicate',
    label: 'Deduplicate',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { field: '' },
    fields: [text('field', 'Campo chave')],
  }),
  node({
    id: 'data.compare',
    label: 'Compare',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { left: '', right: '', operator: 'eq' },
    fields: [
      text('left', 'Esquerda', { required: true }),
      text('right', 'Direita', { required: true }),
      select(
        'operator',
        'Operador',
        [
          { value: 'eq', label: 'Igual' },
          { value: 'neq', label: 'Diferente' },
          { value: 'gt', label: 'Maior' },
          { value: 'lt', label: 'Menor' },
        ],
      ),
    ],
  }),
  node({
    id: 'data.merge',
    label: 'Merge Data',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { mode: 'shallow' },
    fields: [
      select(
        'mode',
        'Modo',
        [
          { value: 'shallow', label: 'Shallow' },
          { value: 'deep', label: 'Deep' },
          { value: 'concat', label: 'Concat' },
        ],
      ),
    ],
  }),
  node({
    id: 'data.parse_json',
    label: 'Parse JSON',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { source: '' },
    fields: [area('source', 'Fonte', { required: true })],
  }),
  node({
    id: 'data.parse_xml',
    label: 'Parse XML',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { source: '' },
    fields: [area('source', 'Fonte', { required: true })],
  }),
  node({
    id: 'data.csv',
    label: 'CSV',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { source: '', delimiter: ',', hasHeader: true },
    fields: [
      area('source', 'CSV', { required: true }),
      text('delimiter', 'Delimitador'),
      bool('hasHeader', 'Possui cabeçalho'),
    ],
  }),
  node({
    id: 'data.regex',
    label: 'Regex',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { pattern: '', flags: 'g', source: '' },
    fields: [
      text('pattern', 'Padrão', { required: true }),
      text('flags', 'Flags'),
      area('source', 'Fonte'),
    ],
  }),
  node({
    id: 'data.validate_schema',
    label: 'Validate Schema',
    category: 'data',
    categoryLabel: 'Data',
    nodeType: 'transform',
    defaultConfig: { schema: '' },
    fields: [area('schema', 'Schema JSON', { required: true })],
  }),

  node({
    id: 'brain.read_context',
    label: 'Read Context',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { key: '' },
    fields: [text('key', 'Chave', { required: true })],
  }),
  node({
    id: 'brain.write_context',
    label: 'Write Context',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { key: '', value: '' },
    fields: [text('key', 'Chave', { required: true }), area('value', 'Valor', { required: true })],
  }),
  node({
    id: 'brain.search',
    label: 'Search Brain',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { query: '', limit: 10 },
    fields: [text('query', 'Consulta', { required: true }), num('limit', 'Limite')],
  }),
  node({
    id: 'brain.save_discovery',
    label: 'Save Discovery',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { content: '', tags: '' },
    fields: [area('content', 'Conteúdo', { required: true }), text('tags', 'Tags')],
  }),
  node({
    id: 'brain.read_decision',
    label: 'Read Decision',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { decisionId: '' },
    fields: [text('decisionId', 'ID da decisão')],
  }),
  node({
    id: 'brain.create_decision',
    label: 'Create Decision',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { title: '', content: '' },
    fields: [text('title', 'Título', { required: true }), area('content', 'Conteúdo', { required: true })],
  }),
  node({
    id: 'brain.read_documentation',
    label: 'Read Documentation',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { path: '' },
    fields: [text('path', 'Caminho', { required: true })],
  }),
  node({
    id: 'brain.update_documentation',
    label: 'Update Documentation',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { path: '', content: '' },
    fields: [text('path', 'Caminho', { required: true }), area('content', 'Conteúdo', { required: true })],
  }),
  node({
    id: 'brain.vector_search',
    label: 'Vector Search',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { query: '', topK: 5 },
    fields: [text('query', 'Consulta', { required: true }), num('topK', 'Top K')],
  }),
  node({
    id: 'brain.embedding',
    label: 'Embedding',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { text: '', model: '' },
    fields: [area('text', 'Texto', { required: true }), text('model', 'Modelo')],
  }),
  node({
    id: 'brain.context_capsule',
    label: 'Context Capsule',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { name: '', content: '' },
    fields: [text('name', 'Nome', { required: true }), area('content', 'Conteúdo')],
  }),
  node({
    id: 'brain.shared_context',
    label: 'Shared Context',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { scope: 'mission', key: '' },
    fields: [
      select(
        'scope',
        'Escopo',
        [
          { value: 'mission', label: 'Missão' },
          { value: 'project', label: 'Projeto' },
          { value: 'global', label: 'Global' },
        ],
      ),
      text('key', 'Chave', { required: true }),
    ],
  }),
  node({
    id: 'brain.save',
    label: 'Save to Brain',
    category: 'brain',
    categoryLabel: 'Memory / Brain',
    nodeType: 'brain',
    defaultConfig: { content: '', collection: '' },
    fields: [area('content', 'Conteúdo', { required: true }), text('collection', 'Coleção')],
  }),

  integration('postgresql', 'PostgreSQL', 'database', 'Database', [
    action('query', 'Query', dbActionFields),
    action('insert', 'Insert', dbActionFields),
    action('update', 'Update', dbActionFields),
    action('delete', 'Delete', dbActionFields),
  ]),
  integration('mysql', 'MySQL', 'database', 'Database', [
    action('query', 'Query', dbActionFields),
    action('insert', 'Insert', dbActionFields),
    action('update', 'Update', dbActionFields),
    action('delete', 'Delete', dbActionFields),
  ]),
  integration('sqlite', 'SQLite', 'database', 'Database', [
    action('query', 'Query', dbActionFields),
    action('insert', 'Insert', dbActionFields),
    action('update', 'Update', dbActionFields),
    action('delete', 'Delete', dbActionFields),
  ]),
  integration('mongodb', 'MongoDB', 'database', 'Database', [
    action('find', 'Find', [
      text('collection', 'Collection', { required: true }),
      area('filter', 'Filter (JSON)'),
    ]),
    action('insert', 'Insert', [
      text('collection', 'Collection', { required: true }),
      area('document', 'Document (JSON)', { required: true }),
    ]),
    action('update', 'Update', [
      text('collection', 'Collection', { required: true }),
      area('filter', 'Filter (JSON)'),
      area('update', 'Update (JSON)', { required: true }),
    ]),
    action('delete', 'Delete', [
      text('collection', 'Collection', { required: true }),
      area('filter', 'Filter (JSON)', { required: true }),
    ]),
  ]),
  integration('redis', 'Redis', 'database', 'Database', [
    action('get', 'Get', [text('key', 'Chave', { required: true })]),
    action('set', 'Set', [
      text('key', 'Chave', { required: true }),
      area('value', 'Valor', { required: true }),
    ]),
    action('delete', 'Delete', [text('key', 'Chave', { required: true })]),
    action('publish', 'Publish', [
      text('channel', 'Canal', { required: true }),
      area('message', 'Mensagem', { required: true }),
    ]),
  ]),
  integration('supabase', 'Supabase', 'database', 'Database', [
    action('select', 'Select', [
      text('table', 'Tabela', { required: true }),
      area('filter', 'Filtro'),
    ]),
    action('insert', 'Insert', [
      text('table', 'Tabela', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
    ]),
    action('update', 'Update', [
      text('table', 'Tabela', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
      area('filter', 'Filtro'),
    ]),
    action('delete', 'Delete', [
      text('table', 'Tabela', { required: true }),
      area('filter', 'Filtro', { required: true }),
    ]),
    action('rpc', 'RPC', [
      text('functionName', 'Função', { required: true }),
      area('args', 'Args (JSON)'),
    ]),
  ]),
  integration('firebase', 'Firebase', 'database', 'Database', [
    action('get', 'Get', [text('path', 'Path', { required: true })]),
    action('set', 'Set', [
      text('path', 'Path', { required: true }),
      area('value', 'Valor (JSON)', { required: true }),
    ]),
    action('update', 'Update', [
      text('path', 'Path', { required: true }),
      area('value', 'Valor (JSON)', { required: true }),
    ]),
    action('delete', 'Delete', [text('path', 'Path', { required: true })]),
  ]),
  node({
    id: 'database.sql_query',
    label: 'SQL Query',
    category: 'database',
    categoryLabel: 'Database',
    nodeType: 'database',
    defaultConfig: { connection: '', query: '' },
    fields: [
      text('connection', 'Conexão'),
      area('query', 'Query', { required: true }),
    ],
  }),
  node({
    id: 'database.insert',
    label: 'Insert',
    category: 'database',
    categoryLabel: 'Database',
    nodeType: 'database',
    defaultConfig: { table: '', values: '' },
    fields: [
      text('table', 'Tabela', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
    ],
  }),
  node({
    id: 'database.update',
    label: 'Update',
    category: 'database',
    categoryLabel: 'Database',
    nodeType: 'database',
    defaultConfig: { table: '', values: '', where: '' },
    fields: [
      text('table', 'Tabela', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
      area('where', 'Where'),
    ],
  }),
  node({
    id: 'database.delete',
    label: 'Delete',
    category: 'database',
    categoryLabel: 'Database',
    nodeType: 'database',
    defaultConfig: { table: '', where: '' },
    fields: [
      text('table', 'Tabela', { required: true }),
      area('where', 'Where', { required: true }),
    ],
  }),
  node({
    id: 'database.transaction',
    label: 'Transaction',
    category: 'database',
    categoryLabel: 'Database',
    nodeType: 'database',
    defaultConfig: { connection: '', statements: '' },
    fields: [
      text('connection', 'Conexão'),
      area('statements', 'Statements', { required: true }),
    ],
  }),

  node({
    id: 'git.command',
    label: 'Git Command',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { command: '', cwd: '' },
    fields: [
      area('command', 'Comando', { required: true, placeholder: 'status' }),
      text('cwd', 'Diretório'),
    ],
  }),
  integration(
    'github',
    'GitHub',
    'git',
    'Git / GitHub',
    [
      action('create_issue', 'Create Issue', [
        text('repository', 'Repositório', { required: true }),
        text('title', 'Título', { required: true }),
        area('body', 'Corpo'),
        text('labels', 'Labels'),
      ]),
      action('update_issue', 'Update Issue', [
        text('repository', 'Repositório', { required: true }),
        text('issueNumber', 'Número', { required: true }),
        text('title', 'Título'),
        area('body', 'Corpo'),
        select(
          'state',
          'Estado',
          [
            { value: 'open', label: 'Open' },
            { value: 'closed', label: 'Closed' },
          ],
        ),
      ]),
      action('create_pull_request', 'Create Pull Request', [
        text('repository', 'Repositório', { required: true }),
        text('title', 'Título', { required: true }),
        text('head', 'Head branch', { required: true }),
        text('base', 'Base branch', { required: true }),
        area('body', 'Corpo'),
      ]),
      action('review_pull_request', 'Review Pull Request', [
        text('repository', 'Repositório', { required: true }),
        text('pullNumber', 'PR #', { required: true }),
        select(
          'event',
          'Evento',
          [
            { value: 'APPROVE', label: 'Approve' },
            { value: 'REQUEST_CHANGES', label: 'Request changes' },
            { value: 'COMMENT', label: 'Comment' },
          ],
          { required: true },
        ),
        area('body', 'Comentário'),
      ]),
      action('merge_pull_request', 'Merge Pull Request', [
        text('repository', 'Repositório', { required: true }),
        text('pullNumber', 'PR #', { required: true }),
        select(
          'mergeMethod',
          'Método',
          [
            { value: 'merge', label: 'Merge' },
            { value: 'squash', label: 'Squash' },
            { value: 'rebase', label: 'Rebase' },
          ],
        ),
      ]),
      action('comment', 'Comment', [
        text('repository', 'Repositório', { required: true }),
        text('issueNumber', 'Issue/PR #', { required: true }),
        area('body', 'Comentário', { required: true }),
      ]),
      action('create_branch', 'Create Branch', [
        text('repository', 'Repositório', { required: true }),
        text('branch', 'Branch', { required: true }),
        text('from', 'A partir de', { placeholder: 'main' }),
      ]),
      action('commit', 'Commit', [
        text('repository', 'Repositório'),
        text('message', 'Mensagem', { required: true }),
        text('branch', 'Branch'),
      ]),
      action('release', 'Release', [
        text('repository', 'Repositório', { required: true }),
        text('tag', 'Tag', { required: true }),
        text('name', 'Nome'),
        area('body', 'Notas'),
      ]),
    ],
    { keywords: ['github', 'pr', 'issue'] },
  ),
  node({
    id: 'git.clone',
    label: 'Clone Repository',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { url: '', destination: '' },
    fields: [
      text('url', 'URL', { required: true }),
      text('destination', 'Destino'),
    ],
  }),
  node({
    id: 'git.create_branch',
    label: 'Create Branch',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { branch: '', from: 'main' },
    fields: [
      text('branch', 'Branch', { required: true }),
      text('from', 'A partir de'),
    ],
  }),
  node({
    id: 'git.commit',
    label: 'Commit',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { message: '', addAll: true },
    fields: [
      text('message', 'Mensagem', { required: true }),
      bool('addAll', 'Adicionar todos'),
    ],
  }),
  node({
    id: 'git.push',
    label: 'Push',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { remote: 'origin', branch: '' },
    fields: [text('remote', 'Remote'), text('branch', 'Branch')],
  }),
  node({
    id: 'git.pull',
    label: 'Pull',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { remote: 'origin', branch: '' },
    fields: [text('remote', 'Remote'), text('branch', 'Branch')],
  }),
  node({
    id: 'git.merge',
    label: 'Merge',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { branch: '', into: '' },
    fields: [
      text('branch', 'Branch origem', { required: true }),
      text('into', 'Branch destino'),
    ],
  }),
  node({
    id: 'git.create_pull_request',
    label: 'Create Pull Request',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { title: '', head: '', base: 'main', body: '' },
    fields: [
      text('title', 'Título', { required: true }),
      text('head', 'Head', { required: true }),
      text('base', 'Base'),
      area('body', 'Corpo'),
    ],
  }),
  node({
    id: 'git.review_pull_request',
    label: 'Review Pull Request',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { pullNumber: '', event: 'COMMENT', body: '' },
    fields: [
      text('pullNumber', 'PR #', { required: true }),
      select(
        'event',
        'Evento',
        [
          { value: 'APPROVE', label: 'Approve' },
          { value: 'REQUEST_CHANGES', label: 'Request changes' },
          { value: 'COMMENT', label: 'Comment' },
        ],
      ),
      area('body', 'Comentário'),
    ],
  }),
  node({
    id: 'git.comment_pull_request',
    label: 'Comment Pull Request',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { pullNumber: '', body: '' },
    fields: [
      text('pullNumber', 'PR #', { required: true }),
      area('body', 'Comentário', { required: true }),
    ],
  }),
  node({
    id: 'git.create_issue',
    label: 'Create Issue',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { title: '', body: '', labels: '' },
    fields: [
      text('title', 'Título', { required: true }),
      area('body', 'Corpo'),
      text('labels', 'Labels'),
    ],
  }),
  node({
    id: 'git.update_issue',
    label: 'Update Issue',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { issueNumber: '', title: '', body: '', state: 'open' },
    fields: [
      text('issueNumber', 'Número', { required: true }),
      text('title', 'Título'),
      area('body', 'Corpo'),
      select(
        'state',
        'Estado',
        [
          { value: 'open', label: 'Open' },
          { value: 'closed', label: 'Closed' },
        ],
      ),
    ],
  }),
  node({
    id: 'git.create_release',
    label: 'Create Release',
    category: 'git',
    categoryLabel: 'Git / GitHub',
    nodeType: 'action',
    defaultConfig: { tag: '', name: '', body: '' },
    fields: [
      text('tag', 'Tag', { required: true }),
      text('name', 'Nome'),
      area('body', 'Notas'),
    ],
  }),

  node({
    id: 'engineering.run_tests',
    label: 'Run Tests',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm test', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.unit_tests',
    label: 'Unit Tests',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm run test:unit', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.integration_tests',
    label: 'Integration Tests',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm run test:integration', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.e2e_tests',
    label: 'E2E Tests',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm run test:e2e', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.build',
    label: 'Build',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm run build', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.lint',
    label: 'Lint',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm run lint', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.type_check',
    label: 'Type Check',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npx tsc --noEmit', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.format',
    label: 'Format',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npx prettier --write .', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.code_coverage',
    label: 'Code Coverage',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm run test:coverage', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.dependency_audit',
    label: 'Dependency Audit',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: 'npm audit', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'engineering.security_scan',
    label: 'Security Scan',
    category: 'engineering',
    categoryLabel: 'Engineering',
    nodeType: 'action',
    defaultConfig: { command: '', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),

  node({
    id: 'deploy.deploy',
    label: 'Deploy',
    category: 'deploy',
    categoryLabel: 'Deploy / DevOps',
    nodeType: 'action',
    defaultConfig: { command: '', environment: 'production' },
    fields: [
      area('command', 'Comando', { required: true }),
      text('environment', 'Ambiente'),
    ],
  }),
  integration('vercel', 'Vercel', 'deploy', 'Deploy / DevOps', [
    action('deploy', 'Deploy', [
      text('project', 'Projeto'),
      select(
        'environment',
        'Ambiente',
        [
          { value: 'production', label: 'Production' },
          { value: 'preview', label: 'Preview' },
        ],
      ),
    ]),
    action('promote', 'Promote', [text('deploymentId', 'Deployment ID', { required: true })]),
    action('rollback', 'Rollback', [text('deploymentId', 'Deployment ID')]),
  ]),
  integration('render', 'Render', 'deploy', 'Deploy / DevOps', [
    action('deploy', 'Deploy', [text('serviceId', 'Service ID', { required: true })]),
    action('restart', 'Restart', [text('serviceId', 'Service ID', { required: true })]),
  ]),
  integration('aws', 'AWS', 'deploy', 'Deploy / DevOps', [
    action('deploy', 'Deploy', [
      text('service', 'Serviço', { required: true }),
      area('config', 'Config (JSON)'),
    ]),
    action('invalidate_cdn', 'Invalidate CDN', [text('distributionId', 'Distribution ID')]),
  ]),
  integration('docker', 'Docker', 'deploy', 'Deploy / DevOps', [
    action('build', 'Build', [
      text('dockerfile', 'Dockerfile', { placeholder: 'Dockerfile' }),
      text('tag', 'Tag', { required: true }),
    ]),
    action('run', 'Run', [
      text('image', 'Image', { required: true }),
      text('name', 'Container name'),
      area('args', 'Args'),
    ]),
    action('push', 'Push', [text('image', 'Image', { required: true })]),
  ]),
  integration('kubernetes', 'Kubernetes', 'deploy', 'Deploy / DevOps', [
    action('apply', 'Apply', [area('manifest', 'Manifest', { required: true })]),
    action('rollout', 'Rollout', [
      text('deployment', 'Deployment', { required: true }),
      text('namespace', 'Namespace'),
    ]),
    action('delete', 'Delete', [
      text('resource', 'Recurso', { required: true }),
      text('namespace', 'Namespace'),
    ]),
  ]),
  integration('railway', 'Railway', 'deploy', 'Deploy / DevOps', [
    action('deploy', 'Deploy', [text('service', 'Serviço')]),
    action('restart', 'Restart', [text('service', 'Serviço')]),
  ]),
  integration('cloudflare', 'Cloudflare', 'deploy', 'Deploy / DevOps', [
    action('deploy_pages', 'Deploy Pages', [text('project', 'Projeto', { required: true })]),
    action('purge_cache', 'Purge Cache', [text('zoneId', 'Zone ID')]),
  ]),
  node({
    id: 'deploy.ci_cd',
    label: 'CI / CD',
    category: 'deploy',
    categoryLabel: 'Deploy / DevOps',
    nodeType: 'action',
    defaultConfig: { pipeline: '', ref: 'main' },
    fields: [text('pipeline', 'Pipeline', { required: true }), text('ref', 'Ref')],
  }),
  node({
    id: 'deploy.health_check',
    label: 'Health Check',
    category: 'deploy',
    categoryLabel: 'Deploy / DevOps',
    nodeType: 'action',
    defaultConfig: { url: '', expectedStatus: 200 },
    fields: [
      text('url', 'URL', { required: true }),
      num('expectedStatus', 'Status esperado'),
    ],
  }),
  node({
    id: 'deploy.rollback',
    label: 'Rollback',
    category: 'deploy',
    categoryLabel: 'Deploy / DevOps',
    nodeType: 'action',
    defaultConfig: { target: '', version: '' },
    fields: [text('target', 'Alvo', { required: true }), text('version', 'Versão')],
  }),

  node({
    id: 'browser.open',
    label: 'Browser',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { url: 'about:blank' },
    fields: [text('url', 'URL', { required: true })],
  }),
  node({
    id: 'browser.navigate',
    label: 'Navigate',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { url: '' },
    fields: [text('url', 'URL', { required: true })],
  }),
  node({
    id: 'browser.click',
    label: 'Click',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { selector: '' },
    fields: [text('selector', 'Seletor', { required: true })],
  }),
  node({
    id: 'browser.type',
    label: 'Type',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { selector: '', text: '' },
    fields: [
      text('selector', 'Seletor', { required: true }),
      area('text', 'Texto', { required: true }),
    ],
  }),
  node({
    id: 'browser.screenshot',
    label: 'Screenshot',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { path: '', fullPage: true },
    fields: [text('path', 'Salvar em'), bool('fullPage', 'Página inteira')],
  }),
  node({
    id: 'browser.extract_page',
    label: 'Extract Page',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { selector: '', attribute: 'text' },
    fields: [text('selector', 'Seletor'), text('attribute', 'Atributo')],
  }),
  node({
    id: 'browser.download',
    label: 'Download',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { selector: '', destination: '' },
    fields: [text('selector', 'Seletor'), text('destination', 'Destino')],
  }),
  node({
    id: 'browser.upload',
    label: 'Upload',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { selector: '', filePath: '' },
    fields: [
      text('selector', 'Seletor', { required: true }),
      text('filePath', 'Arquivo', { required: true }),
    ],
  }),
  node({
    id: 'browser.test',
    label: 'Browser Test',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'browser',
    defaultConfig: { script: '' },
    fields: [area('script', 'Script de teste', { required: true })],
  }),
  node({
    id: 'browser.preview',
    label: 'Browser Preview',
    category: 'browser',
    categoryLabel: 'Browser',
    nodeType: 'preview',
    defaultConfig: { url: '' },
    fields: [text('url', 'URL', { required: true })],
  }),

  node({
    id: 'emulator.ios',
    label: 'iOS Simulator',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { device: '', udid: '' },
    fields: [text('device', 'Dispositivo'), text('udid', 'UDID')],
  }),
  node({
    id: 'emulator.android',
    label: 'Android Emulator',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { avd: '' },
    fields: [text('avd', 'AVD', { required: true })],
  }),
  node({
    id: 'emulator.launch_app',
    label: 'Launch App',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { bundleId: '', platform: 'ios' },
    fields: [
      text('bundleId', 'Bundle / package', { required: true }),
      select(
        'platform',
        'Plataforma',
        [
          { value: 'ios', label: 'iOS' },
          { value: 'android', label: 'Android' },
        ],
      ),
    ],
  }),
  node({
    id: 'emulator.tap',
    label: 'Tap',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { x: 0, y: 0 },
    fields: [num('x', 'X', { required: true }), num('y', 'Y', { required: true })],
  }),
  node({
    id: 'emulator.swipe',
    label: 'Swipe',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { x1: 0, y1: 0, x2: 0, y2: 0 },
    fields: [
      num('x1', 'X1', { required: true }),
      num('y1', 'Y1', { required: true }),
      num('x2', 'X2', { required: true }),
      num('y2', 'Y2', { required: true }),
    ],
  }),
  node({
    id: 'emulator.type',
    label: 'Type',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { text: '' },
    fields: [area('text', 'Texto', { required: true })],
  }),
  node({
    id: 'emulator.screenshot',
    label: 'Screenshot',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { path: '' },
    fields: [text('path', 'Salvar em')],
  }),
  node({
    id: 'emulator.install_build',
    label: 'Install Build',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { path: '', platform: 'ios' },
    fields: [
      text('path', 'Caminho do build', { required: true }),
      select(
        'platform',
        'Plataforma',
        [
          { value: 'ios', label: 'iOS' },
          { value: 'android', label: 'Android' },
        ],
      ),
    ],
  }),
  node({
    id: 'emulator.run_mobile_test',
    label: 'Run Mobile Test',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'emulator',
    defaultConfig: { command: '', cwd: '' },
    fields: [area('command', 'Comando', { required: true }), text('cwd', 'Diretório')],
  }),
  node({
    id: 'emulator.preview',
    label: 'Emulator Preview',
    category: 'emulator',
    categoryLabel: 'Emulator / Mobile',
    nodeType: 'preview',
    defaultConfig: { platform: 'ios', deviceId: '' },
    fields: [
      select(
        'platform',
        'Plataforma',
        [
          { value: 'ios', label: 'iOS' },
          { value: 'android', label: 'Android' },
        ],
      ),
      text('deviceId', 'Device ID'),
    ],
  }),

  integration(
    'whatsapp',
    'WhatsApp',
    'messaging',
    'Messaging',
    [
      action('send_text', 'Send Text', msgFields),
      action('send_template', 'Send Template', [
        text('to', 'Destinatário', { required: true }),
        text('template', 'Template', { required: true }),
        area('variables', 'Variáveis (JSON)'),
      ]),
      action('send_image', 'Send Image', [
        text('to', 'Destinatário', { required: true }),
        text('imageUrl', 'URL da imagem', { required: true }),
        text('caption', 'Legenda'),
      ]),
      action('send_document', 'Send Document', [
        text('to', 'Destinatário', { required: true }),
        text('documentUrl', 'URL do documento', { required: true }),
        text('filename', 'Nome do arquivo'),
      ]),
      action('send_audio', 'Send Audio', [
        text('to', 'Destinatário', { required: true }),
        text('audioUrl', 'URL do áudio', { required: true }),
      ]),
      action('receive_message', 'Receive Message', [text('from', 'De')]),
      action('mark_as_read', 'Mark as Read', [
        text('messageId', 'ID da mensagem', { required: true }),
      ]),
    ],
    { keywords: ['whatsapp', 'wpp'] },
  ),
  integration(
    'slack',
    'Slack',
    'messaging',
    'Messaging',
    [
      action('send_message', 'Send Message', [
        text('channel', 'Canal', { required: true }),
        area('message', 'Mensagem', { required: true }),
      ]),
      action('reply', 'Reply', [
        text('channel', 'Canal', { required: true }),
        text('threadTs', 'Thread TS', { required: true }),
        area('message', 'Mensagem', { required: true }),
      ]),
      action('create_channel', 'Create Channel', [
        text('name', 'Nome', { required: true }),
        bool('isPrivate', 'Privado'),
      ]),
      action('find_user', 'Find User', [text('email', 'Email', { required: true })]),
      action('add_reaction', 'Add Reaction', [
        text('channel', 'Canal', { required: true }),
        text('timestamp', 'Timestamp', { required: true }),
        text('emoji', 'Emoji', { required: true }),
      ]),
      action('upload_file', 'Upload File', [
        text('channel', 'Canal', { required: true }),
        text('filePath', 'Arquivo', { required: true }),
        text('title', 'Título'),
      ]),
      action('get_messages', 'Get Messages', [
        text('channel', 'Canal', { required: true }),
        num('limit', 'Limite'),
      ]),
    ],
    { keywords: ['slack'] },
  ),
  integration('discord', 'Discord', 'messaging', 'Messaging', [
    action('send_message', 'Send Message', [
      text('channelId', 'Canal', { required: true }),
      area('message', 'Mensagem', { required: true }),
    ]),
    action('reply', 'Reply', [
      text('channelId', 'Canal', { required: true }),
      text('messageId', 'Mensagem', { required: true }),
      area('message', 'Resposta', { required: true }),
    ]),
    action('create_channel', 'Create Channel', [
      text('guildId', 'Servidor', { required: true }),
      text('name', 'Nome', { required: true }),
    ]),
  ]),
  integration('telegram', 'Telegram', 'messaging', 'Messaging', [
    action('send_message', 'Send Message', msgFields),
    action('send_photo', 'Send Photo', [
      text('to', 'Chat ID', { required: true }),
      text('photoUrl', 'URL da foto', { required: true }),
      text('caption', 'Legenda'),
    ]),
    action('send_document', 'Send Document', [
      text('to', 'Chat ID', { required: true }),
      text('documentUrl', 'URL', { required: true }),
    ]),
  ]),
  integration('microsoft_teams', 'Microsoft Teams', 'messaging', 'Messaging', [
    action('send_message', 'Send Message', [
      text('channelId', 'Canal', { required: true }),
      area('message', 'Mensagem', { required: true }),
    ]),
    action('create_meeting', 'Create Meeting', [
      text('subject', 'Assunto', { required: true }),
      text('start', 'Início'),
      text('end', 'Fim'),
    ]),
  ]),
  integration('sms', 'SMS', 'messaging', 'Messaging', [
    action('send', 'Send', msgFields),
    action('receive', 'Receive', [text('from', 'De')]),
  ]),
  node({
    id: 'messaging.send_message',
    label: 'Send Message',
    category: 'messaging',
    categoryLabel: 'Messaging',
    nodeType: 'action',
    defaultConfig: { provider: 'slack', to: '', message: '' },
    fields: [
      select(
        'provider',
        'Provedor',
        [
          { value: 'slack', label: 'Slack' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'discord', label: 'Discord' },
          { value: 'telegram', label: 'Telegram' },
          { value: 'sms', label: 'SMS' },
        ],
      ),
      ...msgFields,
    ],
  }),
  node({
    id: 'messaging.receive_message',
    label: 'Receive Message',
    category: 'messaging',
    categoryLabel: 'Messaging',
    nodeType: 'action',
    defaultConfig: { provider: 'slack', channel: '' },
    fields: [
      select(
        'provider',
        'Provedor',
        [
          { value: 'slack', label: 'Slack' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'discord', label: 'Discord' },
          { value: 'telegram', label: 'Telegram' },
        ],
      ),
      text('channel', 'Canal'),
    ],
  }),

  integration('gmail', 'Gmail', 'email', 'Email', [
    action('send', 'Send Email', [
      text('to', 'Para', { required: true }),
      text('subject', 'Assunto', { required: true }),
      area('body', 'Corpo', { required: true }),
    ]),
    action('read', 'Read Email', [text('query', 'Consulta'), num('limit', 'Limite')]),
    action('reply', 'Reply Email', [
      text('threadId', 'Thread ID', { required: true }),
      area('body', 'Corpo', { required: true }),
    ]),
  ]),
  integration('outlook', 'Outlook', 'email', 'Email', [
    action('send', 'Send Email', [
      text('to', 'Para', { required: true }),
      text('subject', 'Assunto', { required: true }),
      area('body', 'Corpo', { required: true }),
    ]),
    action('read', 'Read Email', [text('folder', 'Pasta'), num('limit', 'Limite')]),
    action('reply', 'Reply Email', [
      text('messageId', 'Message ID', { required: true }),
      area('body', 'Corpo', { required: true }),
    ]),
  ]),
  integration('smtp', 'SMTP', 'email', 'Email', [
    action('send', 'Send Email', [
      text('host', 'Host', { required: true }),
      num('port', 'Porta'),
      text('to', 'Para', { required: true }),
      text('subject', 'Assunto', { required: true }),
      area('body', 'Corpo', { required: true }),
    ]),
  ]),
  integration('imap', 'IMAP', 'email', 'Email', [
    action('read', 'Read Email', [
      text('host', 'Host', { required: true }),
      text('folder', 'Pasta', { placeholder: 'INBOX' }),
      num('limit', 'Limite'),
    ]),
  ]),
  node({
    id: 'email.send',
    label: 'Send Email',
    category: 'email',
    categoryLabel: 'Email',
    nodeType: 'action',
    defaultConfig: { to: '', subject: '', body: '' },
    fields: [
      text('to', 'Para', { required: true }),
      text('subject', 'Assunto', { required: true }),
      area('body', 'Corpo', { required: true }),
    ],
  }),
  node({
    id: 'email.read',
    label: 'Read Email',
    category: 'email',
    categoryLabel: 'Email',
    nodeType: 'action',
    defaultConfig: { query: '', limit: 10 },
    fields: [text('query', 'Consulta'), num('limit', 'Limite')],
  }),
  node({
    id: 'email.reply',
    label: 'Reply Email',
    category: 'email',
    categoryLabel: 'Email',
    nodeType: 'action',
    defaultConfig: { messageId: '', body: '' },
    fields: [
      text('messageId', 'Message ID', { required: true }),
      area('body', 'Corpo', { required: true }),
    ],
  }),
  node({
    id: 'email.attachment',
    label: 'Attachment',
    category: 'email',
    categoryLabel: 'Email',
    nodeType: 'action',
    defaultConfig: { messageId: '', path: '' },
    fields: [
      text('messageId', 'Message ID'),
      text('path', 'Caminho do anexo', { required: true }),
    ],
  }),

  integration('jira', 'Jira', 'project', 'Project Management', [
    action('create_task', 'Create Task', taskFields),
    action('update_task', 'Update Task', [
      text('issueKey', 'Issue key', { required: true }),
      ...taskFields,
    ]),
    action('move_task', 'Move Task', [
      text('issueKey', 'Issue key', { required: true }),
      text('status', 'Status', { required: true }),
    ]),
  ]),
  integration('linear', 'Linear', 'project', 'Project Management', [
    action('create_task', 'Create Task', taskFields),
    action('update_task', 'Update Task', [
      text('issueId', 'Issue ID', { required: true }),
      ...taskFields,
    ]),
    action('move_task', 'Move Task', [
      text('issueId', 'Issue ID', { required: true }),
      text('state', 'Estado', { required: true }),
    ]),
  ]),
  integration('trello', 'Trello', 'project', 'Project Management', [
    action('create_card', 'Create Task', [
      text('listId', 'Lista', { required: true }),
      text('title', 'Título', { required: true }),
      area('description', 'Descrição'),
    ]),
    action('update_card', 'Update Task', [
      text('cardId', 'Card ID', { required: true }),
      text('title', 'Título'),
      area('description', 'Descrição'),
    ]),
    action('move_card', 'Move Task', [
      text('cardId', 'Card ID', { required: true }),
      text('listId', 'Lista destino', { required: true }),
    ]),
  ]),
  integration('asana', 'Asana', 'project', 'Project Management', [
    action('create_task', 'Create Task', taskFields),
    action('update_task', 'Update Task', [
      text('taskId', 'Task ID', { required: true }),
      ...taskFields,
    ]),
    action('move_task', 'Move Task', [
      text('taskId', 'Task ID', { required: true }),
      text('sectionId', 'Seção', { required: true }),
    ]),
  ]),
  integration('clickup', 'ClickUp', 'project', 'Project Management', [
    action('create_task', 'Create Task', taskFields),
    action('update_task', 'Update Task', [
      text('taskId', 'Task ID', { required: true }),
      ...taskFields,
    ]),
    action('move_task', 'Move Task', [
      text('taskId', 'Task ID', { required: true }),
      text('listId', 'Lista', { required: true }),
    ]),
  ]),
  integration('monday', 'Monday', 'project', 'Project Management', [
    action('create_item', 'Create Task', [
      text('boardId', 'Board', { required: true }),
      text('title', 'Título', { required: true }),
    ]),
    action('update_item', 'Update Task', [
      text('itemId', 'Item ID', { required: true }),
      area('columnValues', 'Colunas (JSON)'),
    ]),
    action('move_item', 'Move Task', [
      text('itemId', 'Item ID', { required: true }),
      text('groupId', 'Grupo', { required: true }),
    ]),
  ]),
  integration('github_issues', 'GitHub Issues', 'project', 'Project Management', [
    action('create_issue', 'Create Task', [
      text('repository', 'Repositório', { required: true }),
      text('title', 'Título', { required: true }),
      area('body', 'Corpo'),
    ]),
    action('update_issue', 'Update Task', [
      text('repository', 'Repositório', { required: true }),
      text('issueNumber', 'Número', { required: true }),
      text('title', 'Título'),
      area('body', 'Corpo'),
    ]),
    action('close_issue', 'Move Task', [
      text('repository', 'Repositório', { required: true }),
      text('issueNumber', 'Número', { required: true }),
    ]),
  ]),
  node({
    id: 'project.create_task',
    label: 'Create Task',
    category: 'project',
    categoryLabel: 'Project Management',
    nodeType: 'action',
    defaultConfig: { title: '', description: '', assignee: '' },
    fields: taskFields,
  }),
  node({
    id: 'project.update_task',
    label: 'Update Task',
    category: 'project',
    categoryLabel: 'Project Management',
    nodeType: 'action',
    defaultConfig: { taskId: '', title: '', description: '' },
    fields: [text('taskId', 'Task ID', { required: true }), ...taskFields],
  }),
  node({
    id: 'project.move_task',
    label: 'Move Task',
    category: 'project',
    categoryLabel: 'Project Management',
    nodeType: 'action',
    defaultConfig: { taskId: '', status: '' },
    fields: [
      text('taskId', 'Task ID', { required: true }),
      text('status', 'Status', { required: true }),
    ],
  }),

  integration('notion', 'Notion', 'docs', 'Docs / Knowledge', [
    action('read', 'Read Document', [text('pageId', 'Page ID', { required: true })]),
    action('create', 'Create Document', [
      text('parentId', 'Parent ID'),
      text('title', 'Título', { required: true }),
      area('content', 'Conteúdo'),
    ]),
    action('update', 'Update Document', [
      text('pageId', 'Page ID', { required: true }),
      area('content', 'Conteúdo'),
    ]),
  ]),
  integration('confluence', 'Confluence', 'docs', 'Docs / Knowledge', [
    action('read', 'Read Document', [text('pageId', 'Page ID', { required: true })]),
    action('create', 'Create Document', [
      text('spaceKey', 'Space', { required: true }),
      text('title', 'Título', { required: true }),
      area('content', 'Conteúdo'),
    ]),
    action('update', 'Update Document', [
      text('pageId', 'Page ID', { required: true }),
      area('content', 'Conteúdo'),
    ]),
  ]),
  integration('google_docs', 'Google Docs', 'docs', 'Docs / Knowledge', [
    action('read', 'Read Document', docFields),
    action('create', 'Create Document', docFields),
    action('update', 'Update Document', docFields),
  ]),
  integration('google_drive', 'Google Drive', 'docs', 'Docs / Knowledge', [
    action('upload', 'Upload', [
      text('filePath', 'Arquivo local', { required: true }),
      text('folderId', 'Pasta'),
    ]),
    action('download', 'Download', [
      text('fileId', 'File ID', { required: true }),
      text('destination', 'Destino'),
    ]),
    action('list', 'List', [text('folderId', 'Pasta')]),
  ]),
  integration('onedrive', 'OneDrive', 'docs', 'Docs / Knowledge', [
    action('upload', 'Upload', [
      text('filePath', 'Arquivo local', { required: true }),
      text('folderPath', 'Pasta'),
    ]),
    action('download', 'Download', [
      text('itemId', 'Item ID', { required: true }),
      text('destination', 'Destino'),
    ]),
  ]),
  integration('dropbox', 'Dropbox', 'docs', 'Docs / Knowledge', [
    action('upload', 'Upload', [
      text('filePath', 'Arquivo local', { required: true }),
      text('dropboxPath', 'Path remoto', { required: true }),
    ]),
    action('download', 'Download', [
      text('dropboxPath', 'Path remoto', { required: true }),
      text('destination', 'Destino'),
    ]),
  ]),
  node({
    id: 'docs.read_document',
    label: 'Read Document',
    category: 'docs',
    categoryLabel: 'Docs / Knowledge',
    nodeType: 'action',
    defaultConfig: { path: '' },
    fields: [text('path', 'Caminho / ID', { required: true })],
  }),
  node({
    id: 'docs.create_document',
    label: 'Create Document',
    category: 'docs',
    categoryLabel: 'Docs / Knowledge',
    nodeType: 'action',
    defaultConfig: { title: '', content: '' },
    fields: [text('title', 'Título', { required: true }), area('content', 'Conteúdo')],
  }),
  node({
    id: 'docs.update_document',
    label: 'Update Document',
    category: 'docs',
    categoryLabel: 'Docs / Knowledge',
    nodeType: 'action',
    defaultConfig: { path: '', content: '' },
    fields: [
      text('path', 'Caminho / ID', { required: true }),
      area('content', 'Conteúdo', { required: true }),
    ],
  }),

  integration('google_sheets', 'Google Sheets', 'spreadsheet', 'Spreadsheet', [
    action('read_rows', 'Read Rows', rowFields),
    action('add_row', 'Add Row', rowFields),
    action('update_row', 'Update Row', [
      ...rowFields,
      text('rowNumber', 'Linha', { required: true }),
    ]),
    action('lookup', 'Lookup', [
      text('sheet', 'Planilha', { required: true }),
      text('column', 'Coluna', { required: true }),
      text('value', 'Valor', { required: true }),
    ]),
  ]),
  integration('excel', 'Excel', 'spreadsheet', 'Spreadsheet', [
    action('read_rows', 'Read Rows', [
      text('filePath', 'Arquivo', { required: true }),
      text('sheet', 'Aba'),
    ]),
    action('add_row', 'Add Row', [
      text('filePath', 'Arquivo', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
    ]),
    action('update_row', 'Update Row', [
      text('filePath', 'Arquivo', { required: true }),
      text('rowNumber', 'Linha', { required: true }),
      area('values', 'Valores (JSON)'),
    ]),
    action('lookup', 'Lookup', [
      text('filePath', 'Arquivo', { required: true }),
      text('column', 'Coluna', { required: true }),
      text('value', 'Valor', { required: true }),
    ]),
  ]),
  integration('airtable', 'Airtable', 'spreadsheet', 'Spreadsheet', [
    action('read_rows', 'Read Rows', [
      text('baseId', 'Base', { required: true }),
      text('table', 'Tabela', { required: true }),
    ]),
    action('add_row', 'Add Row', [
      text('baseId', 'Base', { required: true }),
      text('table', 'Tabela', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
    ]),
    action('update_row', 'Update Row', [
      text('baseId', 'Base', { required: true }),
      text('table', 'Tabela', { required: true }),
      text('recordId', 'Record ID', { required: true }),
      area('values', 'Valores (JSON)'),
    ]),
    action('lookup', 'Lookup', [
      text('baseId', 'Base', { required: true }),
      text('table', 'Tabela', { required: true }),
      text('field', 'Campo', { required: true }),
      text('value', 'Valor', { required: true }),
    ]),
  ]),
  integration('baserow', 'Baserow', 'spreadsheet', 'Spreadsheet', [
    action('read_rows', 'Read Rows', [text('tableId', 'Tabela', { required: true })]),
    action('add_row', 'Add Row', [
      text('tableId', 'Tabela', { required: true }),
      area('values', 'Valores (JSON)', { required: true }),
    ]),
    action('update_row', 'Update Row', [
      text('tableId', 'Tabela', { required: true }),
      text('rowId', 'Row ID', { required: true }),
      area('values', 'Valores (JSON)'),
    ]),
    action('lookup', 'Lookup', [
      text('tableId', 'Tabela', { required: true }),
      text('field', 'Campo', { required: true }),
      text('value', 'Valor', { required: true }),
    ]),
  ]),
  node({
    id: 'spreadsheet.read_rows',
    label: 'Read Rows',
    category: 'spreadsheet',
    categoryLabel: 'Spreadsheet',
    nodeType: 'action',
    defaultConfig: { sheet: '', range: '' },
    fields: [text('sheet', 'Planilha', { required: true }), text('range', 'Intervalo')],
  }),
  node({
    id: 'spreadsheet.add_row',
    label: 'Add Row',
    category: 'spreadsheet',
    categoryLabel: 'Spreadsheet',
    nodeType: 'action',
    defaultConfig: { sheet: '', values: '' },
    fields: rowFields,
  }),
  node({
    id: 'spreadsheet.update_row',
    label: 'Update Row',
    category: 'spreadsheet',
    categoryLabel: 'Spreadsheet',
    nodeType: 'action',
    defaultConfig: { sheet: '', rowNumber: '', values: '' },
    fields: [...rowFields, text('rowNumber', 'Linha', { required: true })],
  }),
  node({
    id: 'spreadsheet.lookup',
    label: 'Lookup',
    category: 'spreadsheet',
    categoryLabel: 'Spreadsheet',
    nodeType: 'action',
    defaultConfig: { sheet: '', column: '', value: '' },
    fields: [
      text('sheet', 'Planilha', { required: true }),
      text('column', 'Coluna', { required: true }),
      text('value', 'Valor', { required: true }),
    ],
  }),

  integration('amazon_s3', 'Amazon S3', 'storage', 'Storage', [
    action('upload', 'Upload', storageFields),
    action('download', 'Download', storageFields),
    action('delete', 'Delete', [
      text('bucket', 'Bucket', { required: true }),
      text('path', 'Caminho', { required: true }),
    ]),
    action('move', 'Move', [
      text('bucket', 'Bucket', { required: true }),
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ]),
  ]),
  integration('google_cloud_storage', 'Google Cloud Storage', 'storage', 'Storage', [
    action('upload', 'Upload', storageFields),
    action('download', 'Download', storageFields),
    action('delete', 'Delete', [
      text('bucket', 'Bucket', { required: true }),
      text('path', 'Caminho', { required: true }),
    ]),
    action('move', 'Move', [
      text('bucket', 'Bucket', { required: true }),
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ]),
  ]),
  integration('supabase_storage', 'Supabase Storage', 'storage', 'Storage', [
    action('upload', 'Upload', storageFields),
    action('download', 'Download', storageFields),
    action('delete', 'Delete', [
      text('bucket', 'Bucket', { required: true }),
      text('path', 'Caminho', { required: true }),
    ]),
    action('move', 'Move', [
      text('bucket', 'Bucket', { required: true }),
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ]),
  ]),
  integration('firebase_storage', 'Firebase Storage', 'storage', 'Storage', [
    action('upload', 'Upload', storageFields),
    action('download', 'Download', storageFields),
    action('delete', 'Delete', [
      text('bucket', 'Bucket', { required: true }),
      text('path', 'Caminho', { required: true }),
    ]),
    action('move', 'Move', [
      text('bucket', 'Bucket', { required: true }),
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ]),
  ]),
  node({
    id: 'storage.upload',
    label: 'Upload',
    category: 'storage',
    categoryLabel: 'Storage',
    nodeType: 'action',
    defaultConfig: { bucket: '', path: '', localPath: '' },
    fields: storageFields,
  }),
  node({
    id: 'storage.download',
    label: 'Download',
    category: 'storage',
    categoryLabel: 'Storage',
    nodeType: 'action',
    defaultConfig: { bucket: '', path: '', localPath: '' },
    fields: storageFields,
  }),
  node({
    id: 'storage.delete',
    label: 'Delete',
    category: 'storage',
    categoryLabel: 'Storage',
    nodeType: 'action',
    defaultConfig: { bucket: '', path: '' },
    fields: [
      text('bucket', 'Bucket', { required: true }),
      text('path', 'Caminho', { required: true }),
    ],
  }),
  node({
    id: 'storage.move',
    label: 'Move',
    category: 'storage',
    categoryLabel: 'Storage',
    nodeType: 'action',
    defaultConfig: { bucket: '', from: '', to: '' },
    fields: [
      text('bucket', 'Bucket', { required: true }),
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ],
  }),

  node({
    id: 'security.oauth',
    label: 'OAuth',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'action',
    defaultConfig: { provider: '', clientId: '', scopes: '' },
    fields: [
      text('provider', 'Provedor', { required: true }),
      text('clientId', 'Client ID', { required: true }),
      text('scopes', 'Scopes'),
    ],
  }),
  node({
    id: 'security.jwt',
    label: 'JWT',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'action',
    defaultConfig: { operation: 'verify', token: '', secret: '' },
    fields: [
      select(
        'operation',
        'Operação',
        [
          { value: 'sign', label: 'Sign' },
          { value: 'verify', label: 'Verify' },
          { value: 'decode', label: 'Decode' },
        ],
      ),
      area('token', 'Token'),
      text('secret', 'Secret'),
    ],
  }),
  node({
    id: 'security.api_key',
    label: 'API Key',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'action',
    defaultConfig: { keyName: '', value: '' },
    fields: [text('keyName', 'Nome', { required: true }), text('value', 'Valor')],
  }),
  node({
    id: 'security.secret',
    label: 'Secret',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'action',
    defaultConfig: { name: '', operation: 'read' },
    fields: [
      text('name', 'Nome', { required: true }),
      select(
        'operation',
        'Operação',
        [
          { value: 'read', label: 'Ler' },
          { value: 'write', label: 'Escrever' },
        ],
      ),
    ],
  }),
  node({
    id: 'security.credential',
    label: 'Credential',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'action',
    defaultConfig: { credentialId: '' },
    fields: [text('credentialId', 'Credential ID', { required: true })],
  }),
  node({
    id: 'security.permission_check',
    label: 'Permission Check',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'action',
    defaultConfig: { principal: '', permission: '' },
    fields: [
      text('principal', 'Principal', { required: true }),
      text('permission', 'Permissão', { required: true }),
    ],
  }),
  node({
    id: 'security.security_gate',
    label: 'Security Gate',
    category: 'security',
    categoryLabel: 'Security',
    nodeType: 'condition',
    defaultConfig: { policy: '' },
    fields: [area('policy', 'Política', { required: true })],
  }),

  node({
    id: 'notifications.push',
    label: 'Push Notification',
    category: 'notifications',
    categoryLabel: 'Notifications',
    nodeType: 'action',
    defaultConfig: { title: '', body: '', target: '' },
    fields: [
      text('title', 'Título', { required: true }),
      area('body', 'Corpo', { required: true }),
      text('target', 'Alvo'),
    ],
  }),
  node({
    id: 'notifications.email',
    label: 'Email Notification',
    category: 'notifications',
    categoryLabel: 'Notifications',
    nodeType: 'action',
    defaultConfig: { to: '', subject: '', body: '' },
    fields: [
      text('to', 'Para', { required: true }),
      text('subject', 'Assunto', { required: true }),
      area('body', 'Corpo', { required: true }),
    ],
  }),
  node({
    id: 'notifications.slack_alert',
    label: 'Slack Alert',
    category: 'notifications',
    categoryLabel: 'Notifications',
    nodeType: 'action',
    defaultConfig: { channel: '', message: '' },
    fields: [
      text('channel', 'Canal', { required: true }),
      area('message', 'Mensagem', { required: true }),
    ],
  }),
  node({
    id: 'notifications.whatsapp_alert',
    label: 'WhatsApp Alert',
    category: 'notifications',
    categoryLabel: 'Notifications',
    nodeType: 'action',
    defaultConfig: { to: '', message: '' },
    fields: msgFields,
  }),
  node({
    id: 'notifications.desktop',
    label: 'Desktop Notification',
    category: 'notifications',
    categoryLabel: 'Notifications',
    nodeType: 'action',
    defaultConfig: { title: '', body: '' },
    fields: [
      text('title', 'Título', { required: true }),
      area('body', 'Corpo', { required: true }),
    ],
  }),

  integration('stripe', 'Stripe', 'payments', 'Payments', [
    action('create_payment', 'Payment Created', paymentFields),
    action('confirm_payment', 'Payment Confirmed', [
      text('paymentId', 'Payment ID', { required: true }),
    ]),
    action('refund', 'Refund', [
      text('paymentId', 'Payment ID', { required: true }),
      text('amount', 'Valor'),
    ]),
  ]),
  integration('mercado_pago', 'Mercado Pago', 'payments', 'Payments', [
    action('create_payment', 'Payment Created', paymentFields),
    action('confirm_payment', 'Payment Confirmed', [
      text('paymentId', 'Payment ID', { required: true }),
    ]),
    action('refund', 'Refund', [
      text('paymentId', 'Payment ID', { required: true }),
      text('amount', 'Valor'),
    ]),
  ]),
  integration('asaas', 'Asaas', 'payments', 'Payments', [
    action('create_payment', 'Payment Created', paymentFields),
    action('confirm_payment', 'Payment Confirmed', [
      text('paymentId', 'Payment ID', { required: true }),
    ]),
    action('refund', 'Refund', [
      text('paymentId', 'Payment ID', { required: true }),
      text('amount', 'Valor'),
    ]),
  ]),
  integration('efi', 'Efí', 'payments', 'Payments', [
    action('create_payment', 'Payment Created', paymentFields),
    action('confirm_payment', 'Payment Confirmed', [
      text('paymentId', 'Payment ID', { required: true }),
    ]),
    action('refund', 'Refund', [
      text('paymentId', 'Payment ID', { required: true }),
      text('amount', 'Valor'),
    ]),
  ]),
  integration('paypal', 'PayPal', 'payments', 'Payments', [
    action('create_payment', 'Payment Created', paymentFields),
    action('confirm_payment', 'Payment Confirmed', [
      text('paymentId', 'Payment ID', { required: true }),
    ]),
    action('refund', 'Refund', [
      text('paymentId', 'Payment ID', { required: true }),
      text('amount', 'Valor'),
    ]),
  ]),
  node({
    id: 'payments.created',
    label: 'Payment Created',
    category: 'payments',
    categoryLabel: 'Payments',
    nodeType: 'action',
    defaultConfig: { amount: '', currency: 'BRL', customerId: '' },
    fields: paymentFields,
  }),
  node({
    id: 'payments.confirmed',
    label: 'Payment Confirmed',
    category: 'payments',
    categoryLabel: 'Payments',
    nodeType: 'action',
    defaultConfig: { paymentId: '' },
    fields: [text('paymentId', 'Payment ID', { required: true })],
  }),
  node({
    id: 'payments.refund',
    label: 'Refund',
    category: 'payments',
    categoryLabel: 'Payments',
    nodeType: 'action',
    defaultConfig: { paymentId: '', amount: '' },
    fields: [
      text('paymentId', 'Payment ID', { required: true }),
      text('amount', 'Valor'),
    ],
  }),

  integration('sentry', 'Sentry', 'monitoring', 'Monitoring', [
    action('capture_exception', 'Capture Exception', [
      area('message', 'Mensagem', { required: true }),
      text('level', 'Nível', { placeholder: 'error' }),
    ]),
    action('search_issues', 'Log Search', [text('query', 'Consulta', { required: true })]),
  ]),
  integration('datadog', 'Datadog', 'monitoring', 'Monitoring', [
    action('log_search', 'Log Search', [text('query', 'Consulta', { required: true })]),
    action('create_event', 'Create Event', [
      text('title', 'Título', { required: true }),
      area('text', 'Texto'),
    ]),
  ]),
  integration('grafana', 'Grafana', 'monitoring', 'Monitoring', [
    action('query', 'Query', [area('query', 'Query', { required: true })]),
    action('create_annotation', 'Annotation', [
      text('dashboardId', 'Dashboard'),
      text('text', 'Texto', { required: true }),
    ]),
  ]),
  integration('new_relic', 'New Relic', 'monitoring', 'Monitoring', [
    action('nrql', 'NRQL', [area('query', 'Query', { required: true })]),
    action('log_search', 'Log Search', [text('query', 'Consulta', { required: true })]),
  ]),
  node({
    id: 'monitoring.log_search',
    label: 'Log Search',
    category: 'monitoring',
    categoryLabel: 'Monitoring',
    nodeType: 'action',
    defaultConfig: { query: '', source: '' },
    fields: [text('query', 'Consulta', { required: true }), text('source', 'Fonte')],
  }),
  node({
    id: 'monitoring.error_trigger',
    label: 'Error Trigger',
    category: 'monitoring',
    categoryLabel: 'Monitoring',
    nodeType: 'trigger',
    defaultConfig: { service: '', severity: 'error' },
    fields: [
      text('service', 'Serviço'),
      select(
        'severity',
        'Severidade',
        [
          { value: 'warning', label: 'Warning' },
          { value: 'error', label: 'Error' },
          { value: 'fatal', label: 'Fatal' },
        ],
      ),
    ],
  }),
  node({
    id: 'monitoring.performance',
    label: 'Performance Monitor',
    category: 'monitoring',
    categoryLabel: 'Monitoring',
    nodeType: 'action',
    defaultConfig: { metric: '', threshold: 0 },
    fields: [text('metric', 'Métrica', { required: true }), num('threshold', 'Limite')],
  }),
  node({
    id: 'monitoring.uptime_check',
    label: 'Uptime Check',
    category: 'monitoring',
    categoryLabel: 'Monitoring',
    nodeType: 'action',
    defaultConfig: { url: '', expectedStatus: 200 },
    fields: [
      text('url', 'URL', { required: true }),
      num('expectedStatus', 'Status esperado'),
    ],
  }),

  node({
    id: 'forms.form_trigger',
    label: 'Form Trigger',
    category: 'forms',
    categoryLabel: 'Forms',
    nodeType: 'trigger',
    defaultConfig: { formId: '' },
    fields: [text('formId', 'ID do formulário', { required: true })],
  }),
  integration('typeform', 'Typeform', 'forms', 'Forms', [
    action('get_response', 'Get Response', [
      text('formId', 'Form ID', { required: true }),
      text('responseId', 'Response ID'),
    ]),
    action('list_responses', 'List Responses', [
      text('formId', 'Form ID', { required: true }),
      num('limit', 'Limite'),
    ]),
  ]),
  integration('google_forms', 'Google Forms', 'forms', 'Forms', [
    action('get_response', 'Get Response', [
      text('formId', 'Form ID', { required: true }),
      text('responseId', 'Response ID'),
    ]),
    action('list_responses', 'List Responses', [text('formId', 'Form ID', { required: true })]),
  ]),
  integration('tally', 'Tally', 'forms', 'Forms', [
    action('get_response', 'Get Response', [
      text('formId', 'Form ID', { required: true }),
      text('responseId', 'Response ID'),
    ]),
    action('list_responses', 'List Responses', [text('formId', 'Form ID', { required: true })]),
  ]),
  node({
    id: 'forms.parse_submission',
    label: 'Parse Submission',
    category: 'forms',
    categoryLabel: 'Forms',
    nodeType: 'transform',
    defaultConfig: { mapping: '' },
    fields: [area('mapping', 'Mapeamento (JSON)')],
  }),

  integration('google_calendar', 'Google Calendar', 'calendar', 'Calendar', [
    action('create_event', 'Create Event', [
      text('calendarId', 'Calendário'),
      text('title', 'Título', { required: true }),
      text('start', 'Início', { required: true }),
      text('end', 'Fim', { required: true }),
    ]),
    action('update_event', 'Update Event', [
      text('calendarId', 'Calendário'),
      text('eventId', 'Event ID', { required: true }),
      text('title', 'Título'),
      text('start', 'Início'),
      text('end', 'Fim'),
    ]),
    action('find_availability', 'Find Availability', [
      text('calendarId', 'Calendário'),
      text('start', 'Início', { required: true }),
      text('end', 'Fim', { required: true }),
    ]),
  ]),
  integration('outlook_calendar', 'Outlook Calendar', 'calendar', 'Calendar', [
    action('create_event', 'Create Event', [
      text('title', 'Título', { required: true }),
      text('start', 'Início', { required: true }),
      text('end', 'Fim', { required: true }),
    ]),
    action('update_event', 'Update Event', [
      text('eventId', 'Event ID', { required: true }),
      text('title', 'Título'),
      text('start', 'Início'),
      text('end', 'Fim'),
    ]),
    action('find_availability', 'Find Availability', [
      text('start', 'Início', { required: true }),
      text('end', 'Fim', { required: true }),
    ]),
  ]),
  node({
    id: 'calendar.create_event',
    label: 'Create Event',
    category: 'calendar',
    categoryLabel: 'Calendar',
    nodeType: 'action',
    defaultConfig: { title: '', start: '', end: '' },
    fields: [
      text('title', 'Título', { required: true }),
      text('start', 'Início', { required: true }),
      text('end', 'Fim', { required: true }),
    ],
  }),
  node({
    id: 'calendar.update_event',
    label: 'Update Event',
    category: 'calendar',
    categoryLabel: 'Calendar',
    nodeType: 'action',
    defaultConfig: { eventId: '', title: '', start: '', end: '' },
    fields: [
      text('eventId', 'Event ID', { required: true }),
      text('title', 'Título'),
      text('start', 'Início'),
      text('end', 'Fim'),
    ],
  }),
  node({
    id: 'calendar.find_availability',
    label: 'Find Availability',
    category: 'calendar',
    categoryLabel: 'Calendar',
    nodeType: 'action',
    defaultConfig: { start: '', end: '' },
    fields: [
      text('start', 'Início', { required: true }),
      text('end', 'Fim', { required: true }),
    ],
  }),

  node({
    id: 'search.web',
    label: 'Web Search',
    category: 'search',
    categoryLabel: 'Search',
    nodeType: 'action',
    defaultConfig: { query: '', limit: 10 },
    fields: [text('query', 'Consulta', { required: true }), num('limit', 'Limite')],
  }),
  node({
    id: 'search.documentation',
    label: 'Documentation Search',
    category: 'search',
    categoryLabel: 'Search',
    nodeType: 'action',
    defaultConfig: { query: '', source: '' },
    fields: [text('query', 'Consulta', { required: true }), text('source', 'Fonte')],
  }),
  node({
    id: 'search.code',
    label: 'Code Search',
    category: 'search',
    categoryLabel: 'Search',
    nodeType: 'action',
    defaultConfig: { query: '', path: '' },
    fields: [text('query', 'Consulta', { required: true }), text('path', 'Caminho')],
  }),
  node({
    id: 'search.repository',
    label: 'Repository Search',
    category: 'search',
    categoryLabel: 'Search',
    nodeType: 'action',
    defaultConfig: { query: '', repository: '' },
    fields: [
      text('query', 'Consulta', { required: true }),
      text('repository', 'Repositório'),
    ],
  }),
  node({
    id: 'search.semantic',
    label: 'Semantic Search',
    category: 'search',
    categoryLabel: 'Search',
    nodeType: 'action',
    defaultConfig: { query: '', topK: 5 },
    fields: [text('query', 'Consulta', { required: true }), num('topK', 'Top K')],
  }),

  node({
    id: 'files.read',
    label: 'Read File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { path: '' },
    fields: [text('path', 'Caminho', { required: true })],
    keywords: ['read', 'file', 'arquivo'],
  }),
  node({
    id: 'files.write',
    label: 'Write File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { path: '', content: '' },
    fields: [
      text('path', 'Caminho', { required: true }),
      area('content', 'Conteúdo', { required: true }),
    ],
  }),
  node({
    id: 'files.create',
    label: 'Create File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { path: '', content: '' },
    fields: [text('path', 'Caminho', { required: true }), area('content', 'Conteúdo')],
  }),
  node({
    id: 'files.delete',
    label: 'Delete File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { path: '' },
    fields: [text('path', 'Caminho', { required: true })],
  }),
  node({
    id: 'files.move',
    label: 'Move File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { from: '', to: '' },
    fields: [
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ],
  }),
  node({
    id: 'files.copy',
    label: 'Copy File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { from: '', to: '' },
    fields: [
      text('from', 'De', { required: true }),
      text('to', 'Para', { required: true }),
    ],
  }),
  node({
    id: 'files.watch',
    label: 'Watch File',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'trigger',
    defaultConfig: { path: '', pattern: '*' },
    fields: [text('path', 'Caminho', { required: true }), text('pattern', 'Padrão')],
  }),
  node({
    id: 'files.archive',
    label: 'Archive / ZIP',
    category: 'files',
    categoryLabel: 'Files',
    nodeType: 'action',
    defaultConfig: { source: '', destination: '', operation: 'zip' },
    fields: [
      text('source', 'Origem', { required: true }),
      text('destination', 'Destino', { required: true }),
      select(
        'operation',
        'Operação',
        [
          { value: 'zip', label: 'Compactar' },
          { value: 'unzip', label: 'Extrair' },
        ],
      ),
    ],
  }),

  node({
    id: 'media.image_input',
    label: 'Image Input',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '' },
    fields: [text('path', 'Caminho / URL', { required: true })],
  }),
  node({
    id: 'media.image_generation',
    label: 'Image Generation',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { prompt: '', size: '1024x1024' },
    fields: [
      area('prompt', 'Prompt', { required: true }),
      text('size', 'Tamanho', { placeholder: '1024x1024' }),
    ],
  }),
  node({
    id: 'media.image_analysis',
    label: 'Image Analysis',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '', prompt: '' },
    fields: [
      text('path', 'Caminho / URL', { required: true }),
      area('prompt', 'Pergunta'),
    ],
  }),
  node({
    id: 'media.ocr',
    label: 'OCR',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '', language: 'por' },
    fields: [
      text('path', 'Caminho / URL', { required: true }),
      text('language', 'Idioma'),
    ],
  }),
  node({
    id: 'media.pdf_reader',
    label: 'PDF Reader',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '', pages: '' },
    fields: [text('path', 'Caminho', { required: true }), text('pages', 'Páginas')],
  }),
  node({
    id: 'media.audio',
    label: 'Audio',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '', operation: 'load' },
    fields: [
      text('path', 'Caminho', { required: true }),
      select(
        'operation',
        'Operação',
        [
          { value: 'load', label: 'Carregar' },
          { value: 'trim', label: 'Cortar' },
          { value: 'convert', label: 'Converter' },
        ],
      ),
    ],
  }),
  node({
    id: 'media.speech_to_text',
    label: 'Speech-to-Text',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '', language: 'pt' },
    fields: [text('path', 'Áudio', { required: true }), text('language', 'Idioma')],
  }),
  node({
    id: 'media.text_to_speech',
    label: 'Text-to-Speech',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { text: '', voice: '', destination: '' },
    fields: [
      area('text', 'Texto', { required: true }),
      text('voice', 'Voz'),
      text('destination', 'Destino'),
    ],
  }),
  node({
    id: 'media.video',
    label: 'Video',
    category: 'media',
    categoryLabel: 'Media',
    nodeType: 'action',
    defaultConfig: { path: '', operation: 'load' },
    fields: [
      text('path', 'Caminho', { required: true }),
      select(
        'operation',
        'Operação',
        [
          { value: 'load', label: 'Carregar' },
          { value: 'extract_audio', label: 'Extrair áudio' },
          { value: 'thumbnail', label: 'Thumbnail' },
        ],
      ),
    ],
  }),

  node({
    id: 'nexus.mission',
    label: 'Mission',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'mission',
    defaultConfig: { missionId: '', objective: '' },
    fields: [text('missionId', 'Mission ID'), area('objective', 'Objetivo')],
  }),
  node({
    id: 'nexus.sub_mission',
    label: 'Sub-Mission',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'mission',
    defaultConfig: { title: '', objective: '' },
    fields: [
      text('title', 'Título', { required: true }),
      area('objective', 'Objetivo', { required: true }),
    ],
  }),
  node({
    id: 'nexus.agent_handoff',
    label: 'Agent Handoff',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'action',
    defaultConfig: { targetNodeId: '', summary: '' },
    fields: [
      text('targetNodeId', 'Nó destino', { required: true }),
      area('summary', 'Resumo'),
    ],
  }),
  node({
    id: 'nexus.shared_context',
    label: 'Shared Context',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'brain',
    defaultConfig: { key: '', value: '' },
    fields: [text('key', 'Chave', { required: true }), area('value', 'Valor')],
  }),
  node({
    id: 'nexus.brain_search',
    label: 'Brain Search',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'brain',
    defaultConfig: { query: '', limit: 10 },
    fields: [text('query', 'Consulta', { required: true }), num('limit', 'Limite')],
  }),
  node({
    id: 'nexus.save_to_brain',
    label: 'Save to Brain',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'brain',
    defaultConfig: { content: '', tags: '' },
    fields: [area('content', 'Conteúdo', { required: true }), text('tags', 'Tags')],
  }),
  node({
    id: 'nexus.discovery',
    label: 'Discovery',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'brain',
    defaultConfig: { content: '' },
    fields: [area('content', 'Conteúdo', { required: true })],
  }),
  node({
    id: 'nexus.decision',
    label: 'Decision',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'brain',
    defaultConfig: { title: '', content: '' },
    fields: [text('title', 'Título', { required: true }), area('content', 'Conteúdo')],
  }),
  node({
    id: 'nexus.mission_result',
    label: 'Mission Result',
    category: 'nexus',
    categoryLabel: 'NEXUS Native',
    nodeType: 'mission',
    defaultConfig: { summary: '', status: 'success' },
    fields: [
      area('summary', 'Resumo', { required: true }),
      select(
        'status',
        'Status',
        [
          { value: 'success', label: 'Sucesso' },
          { value: 'partial', label: 'Parcial' },
          { value: 'failed', label: 'Falhou' },
        ],
      ),
    ],
  }),

  node({
    id: 'visualization.preview',
    label: 'Preview',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { source: '' },
    fields: [text('source', 'Fonte')],
  }),
  node({
    id: 'visualization.browser_preview',
    label: 'Browser Preview',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { url: '' },
    fields: [text('url', 'URL', { required: true })],
  }),
  node({
    id: 'visualization.emulator_preview',
    label: 'Emulator Preview',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { platform: 'ios', deviceId: '' },
    fields: [
      select(
        'platform',
        'Plataforma',
        [
          { value: 'ios', label: 'iOS' },
          { value: 'android', label: 'Android' },
        ],
      ),
      text('deviceId', 'Device ID'),
    ],
  }),
  node({
    id: 'visualization.json_viewer',
    label: 'JSON Viewer',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { dataPath: '' },
    fields: [text('dataPath', 'Caminho dos dados')],
  }),
  node({
    id: 'visualization.markdown_viewer',
    label: 'Markdown Viewer',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { content: '', path: '' },
    fields: [area('content', 'Conteúdo'), text('path', 'Arquivo')],
  }),
  node({
    id: 'visualization.diff_viewer',
    label: 'Diff Viewer',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { before: '', after: '' },
    fields: [area('before', 'Antes'), area('after', 'Depois')],
  }),
  node({
    id: 'visualization.log_viewer',
    label: 'Log Viewer',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { source: '', filter: '' },
    fields: [text('source', 'Fonte'), text('filter', 'Filtro')],
  }),
  node({
    id: 'visualization.report',
    label: 'Report',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { title: '', content: '' },
    fields: [text('title', 'Título', { required: true }), area('content', 'Conteúdo')],
  }),
  node({
    id: 'visualization.output',
    label: 'Output',
    category: 'visualization',
    categoryLabel: 'Visualization',
    nodeType: 'preview',
    defaultConfig: { value: '' },
    fields: [area('value', 'Valor')],
  }),
];

const catalogById = new Map(
  MISSION_AUTOMATION_CATALOG.map((entry) => [entry.id, entry] as const),
);

export function getMissionAutomationCatalogEntry(
  id: string,
): MissionAutomationCatalogEntry | undefined {
  return catalogById.get(id);
}

export function getMissionAutomationCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function resolveMissionAutomationFields(
  entry: MissionAutomationCatalogEntry,
  action?: string | null,
): MissionAutomationField[] {
  if (!entry.actions?.length) {
    return entry.fields;
  }

  const selectedValue =
    action ??
    (typeof entry.defaultConfig.action === 'string' ? entry.defaultConfig.action : null) ??
    entry.action ??
    entry.actions[0]?.value;

  const selected = entry.actions.find((item) => item.value === selectedValue);
  const actionFields = selected?.fields ?? [];
  return [...entry.fields, ...actionFields];
}

export function searchMissionAutomationCatalog(query: string): MissionAutomationCatalogEntry[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return [...MISSION_AUTOMATION_CATALOG];
  }

  return MISSION_AUTOMATION_CATALOG.filter((entry) => {
    const haystack = [
      entry.id,
      entry.label,
      entry.category,
      entry.categoryLabel,
      entry.nodeType,
      entry.provider ?? '',
      ...(entry.keywords ?? []),
      ...(entry.actions?.map((item) => `${item.value} ${item.label}`) ?? []),
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
