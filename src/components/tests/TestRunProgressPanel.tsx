import { Check, Circle, Copy, Loader2, Minus, X } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { TestRunnerKind, TestRunStep } from '@/types/test';
import { getTestRunStatusLabel, getTestStatusLabel } from '@/utils/testLabels';
import { formatTestRunLogReport } from '@/utils/formatTestRunLogReport';

const COPY_FEEDBACK_MS = 1500;

interface TestRunProgressPanelProps {
  testName: string;
  runnerKind: TestRunnerKind;
  targetPath: string;
  steps: TestRunStep[];
  status: 'idle' | 'preparing' | 'running' | 'passed' | 'failed';
  error: string | null;
  logTail: string;
  startedAt: number | null;
  finishedAt: number | null;
}

function StepIcon({ status }: { status: TestRunStep['status'] }) {
  if (status === 'passed') {
    return <Check size={12} strokeWidth={2.5} className='tests-drawer__step-icon tests-drawer__step-icon--passed' />;
  }

  if (status === 'failed') {
    return <X size={12} strokeWidth={2.5} className='tests-drawer__step-icon tests-drawer__step-icon--failed' />;
  }

  if (status === 'running') {
    return <Loader2 size={12} strokeWidth={2.5} className='tests-drawer__step-icon tests-drawer__step-icon--running' />;
  }

  if (status === 'skipped') {
    return <Minus size={12} strokeWidth={2.5} className='tests-drawer__step-icon tests-drawer__step-icon--skipped' />;
  }

  return <Circle size={10} strokeWidth={2} className='tests-drawer__step-icon tests-drawer__step-icon--pending' />;
}

function TestRunProgressPanelComponent({
  testName,
  runnerKind,
  targetPath,
  steps,
  status,
  error,
  logTail,
  startedAt,
  finishedAt,
}: TestRunProgressPanelProps) {
  const listRef = useRef<HTMLOListElement>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const runningIndex = steps.findIndex((step) => step.status === 'running');
  const showOverflowRunning =
    status === 'running' &&
    steps.length > 0 &&
    !steps.some((step) => step.status === 'running' || step.status === 'pending');
  const showPreparingHint = status === 'preparing';
  const scrollIndex = runningIndex >= 0 ? runningIndex : showOverflowRunning ? steps.length : -1;
  const showCopyLogs = status === 'failed';

  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    };
  }, []);

  const handleCopyLogs = useCallback(async () => {
    if (!showCopyLogs) {
      return;
    }

    const report = formatTestRunLogReport({
      testName,
      runnerKind,
      targetPath,
      status,
      steps,
      error,
      logTail,
      startedAt,
      finishedAt,
    });

    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);

      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }

      copyFeedbackTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copyFeedbackTimeoutRef.current = null;
      }, COPY_FEEDBACK_MS);
    } catch {
      return;
    }
  }, [
    showCopyLogs,
    error,
    finishedAt,
    logTail,
    runnerKind,
    startedAt,
    status,
    steps,
    targetPath,
    testName,
  ]);

  useEffect(() => {
    if (scrollIndex < 0 || !listRef.current) {
      return;
    }

    const item = listRef.current.children[scrollIndex];

    if (item instanceof HTMLElement) {
      item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [scrollIndex, steps.length, showOverflowRunning]);

  return (
    <div className='tests-drawer__progress overlay-popup--in'>
      <div className='tests-drawer__progress-header'>
        <span className='tests-drawer__progress-title'>Progresso</span>
        <div className='tests-drawer__progress-status-wrap'>
          {showCopyLogs ? (
            <button
              type='button'
              className={`tests-drawer__progress-copy app-button app-button--enter${copied ? ' tests-drawer__progress-copy--copied' : ''}`}
              aria-label={copied ? 'Logs copiados' : 'Copiar logs do teste'}
              title={copied ? 'Logs copiados' : 'Copiar logs do teste'}
              onClick={() => {
                void handleCopyLogs();
              }}
            >
              {copied ? <Check size={11} strokeWidth={2.5} /> : <Copy size={11} strokeWidth={2.5} />}
            </button>
          ) : null}
          {status === 'preparing' ? (
            <Loader2
              size={12}
              strokeWidth={2.5}
              className='tests-drawer__step-icon tests-drawer__progress-icon--preparing'
            />
          ) : null}
          {status === 'running' ? <StepIcon status='running' /> : null}
          <span className={`tests-drawer__progress-status tests-drawer__progress-status--${status}`}>
            {getTestRunStatusLabel(status)}
          </span>
        </div>
      </div>
      {showPreparingHint ? (
        <p className='tests-drawer__progress-preparing'>
          Preparando emulador e mapeando elementos…
        </p>
      ) : null}
      <ol ref={listRef} className='tests-drawer__steps'>
        {steps.map((step) => (
          <li
            key={step.id}
            className={`tests-drawer__step tests-drawer__step--${step.status}`}
            title={`${step.label} — ${getTestStatusLabel(step.status)}`}
          >
            <div className='tests-drawer__step-leading'>
              <StepIcon status={step.status} />
              {step.line ? (
                <span className='tests-drawer__step-line' aria-hidden='true'>
                  {step.line}
                </span>
              ) : null}
            </div>
            <span className='tests-drawer__step-label'>{step.label}</span>
          </li>
        ))}
        {showOverflowRunning ? (
          <li
            className='tests-drawer__step tests-drawer__step--running'
            title='Continuando execução — Executando'
          >
            <div className='tests-drawer__step-leading'>
              <StepIcon status='running' />
            </div>
            <span className='tests-drawer__step-label'>Continuando execução…</span>
          </li>
        ) : null}
      </ol>
      {error ? <p className='tests-drawer__progress-error'>{error}</p> : null}
    </div>
  );
}

export const TestRunProgressPanel = memo(TestRunProgressPanelComponent);
