export type TaskSource = 'local' | 'jira' | 'trello' | 'deepcrm';

export type TaskIntegrationPlatform = 'jira' | 'trello' | 'deepcrm';

export interface TaskAttachment {
  id: string;
  name: string;
  kind: 'image' | 'file';
  path: string;
  mimeType?: string;
}

export interface ProjectTaskDeepcrmMeta {
  assignee?: string;
  assigneeAvatarUrl?: string;
  dueDate?: string;
  priority?: string;
  dealTitle?: string;
  labels?: string[];
  pipelineId?: string;
  pipelineName?: string;
  healthScore?: string;
  healthScoreNumeric?: number;
  mrr?: number;
  stageId?: string;
  stageName?: string;
  projectStatus?: string;
  pendingTaskCount?: number;
  totalTaskCount?: number;
}

export type LocalTaskPriority = 'low' | 'medium' | 'high';

export interface ProjectTaskLocalMeta {
  dueDate?: string;
  priority?: LocalTaskPriority | string;
  labels?: string[];
}

export interface ProjectTaskJiraMeta {
  parentKey?: string;
  parentSummary?: string;
  assignee?: string;
  assigneeAvatarUrl?: string;
  issueType?: string;
  labels?: string[];
  priority?: string;
  reporter?: string;
  reporterAvatarUrl?: string;
  createdAt?: string;
  resolvedAt?: string;
  dueDate?: string;
}

export interface TaskComment {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  body: string;
  createdAt: string;
}

export interface TaskHistoryEntry {
  id: string;
  authorName: string;
  authorAvatarUrl?: string;
  createdAt: string;
  field: string;
  fieldKey?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface DeepcrmProjectSubtask {
  id: string;
  title: string;
  status: string;
  dueDate?: string;
  description?: string;
  createdAt?: string;
}

export interface DeepcrmProjectMilestone {
  id: string;
  title: string;
  dueDate?: string;
  status?: string;
}

export interface TaskDetailDeepcrmData {
  subtasks: DeepcrmProjectSubtask[];
  milestones: DeepcrmProjectMilestone[];
  paymentModel?: string;
  renewalDate?: string;
  startDate?: string;
  companyName?: string;
  contactName?: string;
  contactEmail?: string;
  installmentsSummary?: { paidCount: number; pendingCount: number };
}

export interface TaskDetailData {
  task: ProjectTask;
  reporter?: string;
  reporterAvatarUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  dueDate?: string;
  comments: TaskComment[];
  history: TaskHistoryEntry[];
  deepcrm?: TaskDetailDeepcrmData;
}

export interface ProjectTask {
  id: string;
  source: TaskSource;
  externalId?: string;
  title: string;
  description: string;
  attachments: TaskAttachment[];
  status?: string;
  local?: ProjectTaskLocalMeta;
  jira?: ProjectTaskJiraMeta;
  deepcrm?: ProjectTaskDeepcrmMeta;
  updatedAt: number;
}

export type TaskFilterCategory =
  | 'parent'
  | 'assignee'
  | 'issueType'
  | 'categories'
  | 'status'
  | 'priority';

export interface TaskListFilters {
  parent: string[];
  assignee: string[];
  issueType: string[];
  categories: string[];
  status: string[];
  priority: string[];
}

export interface TaskIntegrationConfig {
  platform: TaskIntegrationPlatform;
  jiraSiteUrl?: string;
  jiraEmail?: string;
  jiraAccountName?: string;
  jiraProjectKey?: string;
  trelloBoardId?: string;
  deepcrmPipelineId?: string;
  deepcrmAccountName?: string;
  syncEnabled: boolean;
}

export interface TaskSyncResult {
  tasks: ProjectTask[];
  jiraAccountName?: string;
  deepcrmAccountName?: string;
}

export interface TaskCredentialsPayload {
  jiraApiToken?: string;
  trelloApiKey?: string;
  trelloToken?: string;
  deepcrmApiToken?: string;
}

export interface JiraProjectOption {
  id: string;
  key: string;
  name: string;
}

export interface TrelloBoardOption {
  id: string;
  name: string;
}

export interface DeepcrmPipelineOption {
  id: string;
  name: string;
}
