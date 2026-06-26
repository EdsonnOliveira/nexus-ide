import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { AnimatedModal } from '@/components/overlay/AnimatedModal';
import { AnchoredSelect } from '@/components/overlay/AnchoredSelect';
import type {
  TaskCredentialsPayload,
  TaskIntegrationConfig,
  TaskIntegrationPlatform,
} from '@/types/task';
import { formatTaskIntegrationError, parseJiraIntegrationInput } from '@/utils/jiraIntegration';
import { formatDeepcrmIntegrationError } from '@/utils/deepcrmIntegration';

type TaskIntegrationPlatformOption = TaskIntegrationPlatform | 'none';

interface TaskIntegrationSecretInputProps {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function TaskIntegrationSecretInputComponent({
  label,
  value,
  placeholder,
  onChange,
}: TaskIntegrationSecretInputProps) {
  const [visible, setVisible] = useState(false);

  const handleToggle = useCallback(() => {
    setVisible((current) => !current);
  }, []);

  return (
    <label className='task-integration-modal__field'>
      <span>{label}</span>
      <div className='task-integration-modal__secret'>
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type='button'
          className='task-integration-modal__secret-toggle app-button app-button--enter'
          aria-label={visible ? 'Ocultar' : 'Mostrar'}
          onClick={handleToggle}
        >
          {visible ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </label>
  );
}

const TaskIntegrationSecretInput = memo(TaskIntegrationSecretInputComponent);

interface TaskIntegrationModalProps {
  projectId: string;
  integration: TaskIntegrationConfig | null;
  onClose: () => void;
  onSave: (integration: TaskIntegrationConfig | null, credentials?: TaskCredentialsPayload) => void;
}

function TaskIntegrationModalComponent({
  projectId,
  integration,
  onClose,
  onSave,
}: TaskIntegrationModalProps) {
  const [platform, setPlatform] = useState<TaskIntegrationPlatformOption>(
    integration?.platform ?? 'none',
  );
  const [jiraSiteUrl, setJiraSiteUrl] = useState(integration?.jiraSiteUrl ?? '');
  const [jiraEmail, setJiraEmail] = useState(integration?.jiraEmail ?? '');
  const [jiraProjectKey, setJiraProjectKey] = useState(integration?.jiraProjectKey ?? '');
  const [jiraApiToken, setJiraApiToken] = useState('');
  const [trelloApiKey, setTrelloApiKey] = useState('');
  const [trelloToken, setTrelloToken] = useState('');
  const [trelloBoardId, setTrelloBoardId] = useState(integration?.trelloBoardId ?? '');
  const [deepcrmApiToken, setDeepcrmApiToken] = useState('');
  const [deepcrmPipelineId, setDeepcrmPipelineId] = useState(integration?.deepcrmPipelineId ?? '');
  const [jiraProjects, setJiraProjects] = useState<Array<{ value: string; label: string }>>([]);
  const [trelloBoards, setTrelloBoards] = useState<Array<{ value: string; label: string }>>([]);
  const [deepcrmPipelines, setDeepcrmPipelines] = useState<Array<{ value: string; label: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);

  const platformOptions = useMemo(
    () => [
      { value: 'none' as const, label: 'Nenhuma' },
      { value: 'jira' as const, label: 'Jira' },
      { value: 'trello' as const, label: 'Trello' },
      { value: 'deepcrm' as const, label: 'DeepCRM' },
    ],
    [],
  );

  const credentials = useMemo<TaskCredentialsPayload>(
    () => ({
      jiraApiToken: jiraApiToken.trim() || undefined,
      trelloApiKey: trelloApiKey.trim() || undefined,
      trelloToken: trelloToken.trim() || undefined,
      deepcrmApiToken: deepcrmApiToken.trim() || undefined,
    }),
    [deepcrmApiToken, jiraApiToken, trelloApiKey, trelloToken],
  );

  const formatIntegrationError = useCallback(
    (loadError: unknown) => {
      if (platform === 'deepcrm') {
        return formatDeepcrmIntegrationError(loadError);
      }

      return formatTaskIntegrationError(loadError);
    },
    [platform],
  );

  const draftConfig = useMemo<TaskIntegrationConfig>(() => {
    const parsedSite = parseJiraIntegrationInput(jiraSiteUrl);

    return {
      platform: platform === 'none' ? 'jira' : platform,
      jiraSiteUrl: parsedSite.siteUrl || undefined,
      jiraEmail: jiraEmail.trim() || undefined,
      jiraProjectKey: jiraProjectKey.trim() || parsedSite.projectKey || undefined,
      trelloBoardId: trelloBoardId.trim() || undefined,
      deepcrmPipelineId: deepcrmPipelineId.trim() || undefined,
      syncEnabled: true,
    };
  }, [deepcrmPipelineId, jiraEmail, jiraProjectKey, jiraSiteUrl, platform, trelloBoardId]);

  const loadRemoteOptions = useCallback(async () => {
    if (platform === 'none') {
      return;
    }

    setIsLoadingOptions(true);
    setError(null);

    try {
      if (platform === 'jira') {
        const projects = await window.nexus.tasks.listJiraProjects(projectId, draftConfig);
        setJiraProjects(projects.map((project) => ({ value: project.key, label: project.name })));
        return;
      }

      if (platform === 'deepcrm') {
        const pipelines = await window.nexus.tasks.listDeepcrmPipelines(projectId);
        setDeepcrmPipelines(
          pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name })),
        );
        return;
      }

      const boards = await window.nexus.tasks.listTrelloBoards(projectId);
      setTrelloBoards(boards.map((board) => ({ value: board.id, label: board.name })));
    } catch (loadError) {
      setError(formatIntegrationError(loadError));
    } finally {
      setIsLoadingOptions(false);
    }
  }, [draftConfig, formatIntegrationError, platform, projectId]);

  useEffect(() => {
    void (async () => {
      const saved = await window.nexus.tasks.getCredentials(projectId);
      setJiraApiToken(saved.jiraApiToken ?? '');
      setTrelloApiKey(saved.trelloApiKey ?? '');
      setTrelloToken(saved.trelloToken ?? '');
      setDeepcrmApiToken(saved.deepcrmApiToken ?? '');
      setCredentialsLoaded(true);
    })();
  }, [projectId]);

  useEffect(() => {
    if (!credentialsLoaded || platform === 'none') {
      return;
    }

    if (platform === 'jira' && jiraEmail.trim() && jiraApiToken.trim() && jiraSiteUrl.trim()) {
      void loadRemoteOptions();
      return;
    }

    if (platform === 'trello' && trelloApiKey.trim() && trelloToken.trim()) {
      void loadRemoteOptions();
      return;
    }

    if (platform === 'deepcrm' && deepcrmApiToken.trim()) {
      void loadRemoteOptions();
    }
  }, [
    credentialsLoaded,
    deepcrmApiToken,
    jiraApiToken,
    jiraEmail,
    jiraSiteUrl,
    loadRemoteOptions,
    platform,
    trelloApiKey,
    trelloToken,
  ]);

  const handleJiraSiteUrlChange = useCallback(
    (value: string) => {
      setJiraSiteUrl(value);

      const parsed = parseJiraIntegrationInput(value);

      if (parsed.projectKey && !jiraProjectKey.trim()) {
        setJiraProjectKey(parsed.projectKey);
      }
    },
    [jiraProjectKey],
  );

  const handleTestConnection = useCallback(async () => {
    setError(null);

    if (platform === 'jira') {
      if (!jiraEmail.trim()) {
        setError('Informe o e-mail da conta Atlassian');
        return;
      }

      if (!jiraApiToken.trim()) {
        setError('Informe o API token do Jira');
        return;
      }
    }

    if (platform === 'trello') {
      if (!trelloApiKey.trim() || !trelloToken.trim()) {
        setError('Informe a API Key e o Token do Trello');
        return;
      }
    }

    if (platform === 'deepcrm') {
      if (!deepcrmApiToken.trim()) {
        setError('Informe o token da API do DeepCRM');
        return;
      }
    }

    try {
      await window.nexus.tasks.testConnection(projectId, draftConfig, credentials);
      await loadRemoteOptions();
    } catch (testError) {
      setError(formatIntegrationError(testError));
    }
  }, [
    credentials,
    deepcrmApiToken,
    draftConfig,
    formatIntegrationError,
    jiraApiToken,
    jiraEmail,
    loadRemoteOptions,
    platform,
    projectId,
    trelloApiKey,
    trelloToken,
  ]);

  const handleSubmit = useCallback(
    (requestClose: () => void) => {
      if (platform === 'none') {
        onSave(null);
        requestClose();
        return;
      }

      if (platform === 'jira' && (!jiraSiteUrl.trim() || !jiraEmail.trim() || !jiraProjectKey.trim())) {
        setError('Preencha URL, e-mail e projeto do Jira');
        return;
      }

      if (platform === 'trello' && !trelloBoardId.trim()) {
        setError('Selecione um board do Trello');
        return;
      }

      if (platform === 'deepcrm' && !deepcrmApiToken.trim()) {
        setError('Informe o token da API do DeepCRM');
        return;
      }

      onSave(
        {
          ...draftConfig,
          platform,
        },
        credentials,
      );
      requestClose();
    },
    [
      credentials,
      deepcrmApiToken,
      draftConfig,
      jiraEmail,
      jiraProjectKey,
      jiraSiteUrl,
      onSave,
      platform,
      trelloBoardId,
    ],
  );

  return (
    <AnimatedModal onClose={onClose} panelClassName='project-dialog task-integration-modal'>
      {(requestClose) => (
        <>
          <span className='project-dialog__title'>Integração de tarefas</span>
          <label className='task-integration-modal__field'>
            <span>Plataforma</span>
            <AnchoredSelect
              value={platform}
              options={platformOptions}
              triggerClassName='task-integration-modal__select'
              onChange={(value) => setPlatform((value || 'none') as TaskIntegrationPlatformOption)}
            />
          </label>
          {platform === 'jira' ? (
            <>
              <label className='task-integration-modal__field'>
                <span>URL do Jira</span>
                <input
                  value={jiraSiteUrl}
                  placeholder='empresa.atlassian.net'
                  onChange={(event) => handleJiraSiteUrlChange(event.target.value)}
                />
              </label>
              <label className='task-integration-modal__field'>
                <span>E-mail</span>
                <input
                  type='email'
                  value={jiraEmail}
                  placeholder='seu@email.com'
                  onChange={(event) => setJiraEmail(event.target.value)}
                />
              </label>
              <TaskIntegrationSecretInput
                label='API token'
                value={jiraApiToken}
                placeholder='Token do Jira'
                onChange={setJiraApiToken}
              />
              <label className='task-integration-modal__field'>
                <span>Projeto</span>
                <AnchoredSelect
                  value={jiraProjectKey}
                  options={jiraProjects}
                  allowEmpty
                  emptyLabel={isLoadingOptions ? 'Carregando...' : 'Selecione'}
                  triggerClassName='task-integration-modal__select'
                  onChange={setJiraProjectKey}
                />
              </label>
            </>
          ) : null}
          {platform === 'trello' ? (
            <>
              <TaskIntegrationSecretInput
                label='API Key'
                value={trelloApiKey}
                onChange={setTrelloApiKey}
              />
              <TaskIntegrationSecretInput label='Token' value={trelloToken} onChange={setTrelloToken} />
              <label className='task-integration-modal__field'>
                <span>Board</span>
                <AnchoredSelect
                  value={trelloBoardId}
                  options={trelloBoards}
                  allowEmpty
                  emptyLabel={isLoadingOptions ? 'Carregando...' : 'Selecione'}
                  triggerClassName='task-integration-modal__select'
                  onChange={setTrelloBoardId}
                />
              </label>
            </>
          ) : null}
          {platform === 'deepcrm' ? (
            <>
              <TaskIntegrationSecretInput
                label='Token da API'
                value={deepcrmApiToken}
                placeholder='Token gerado em API e Webhooks'
                onChange={setDeepcrmApiToken}
              />
              <label className='task-integration-modal__field'>
                <span>Kanban de projetos</span>
                <AnchoredSelect
                  value={deepcrmPipelineId}
                  options={deepcrmPipelines}
                  allowEmpty
                  emptyLabel={isLoadingOptions ? 'Carregando...' : 'Todos os kanbans'}
                  triggerClassName='task-integration-modal__select'
                  onChange={setDeepcrmPipelineId}
                />
              </label>
            </>
          ) : null}
          {error ? <p className='project-dialog__message project-dialog__message--error'>{error}</p> : null}
          <div className='project-dialog__actions'>
            <button
              type='button'
              className='project-dialog__btn project-dialog__btn--ghost app-button'
              onClick={requestClose}
            >
              Cancelar
            </button>
            {platform !== 'none' ? (
              <button
                type='button'
                className='project-dialog__btn project-dialog__btn--ghost app-button'
                onClick={() => void handleTestConnection()}
              >
                Testar conexão
              </button>
            ) : null}
            <button
              type='button'
              className='project-dialog__btn app-button'
              onClick={() => handleSubmit(requestClose)}
            >
              Salvar
            </button>
          </div>
        </>
      )}
    </AnimatedModal>
  );
}

export const TaskIntegrationModal = memo(TaskIntegrationModalComponent);
