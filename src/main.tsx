import { createRoot } from 'react-dom/client';
import App from './App';
import { AgentPipApp } from '@/components/home/AgentPipApp';
import { PaneErrorBoundary } from '@/components/overlay/PaneErrorBoundary';
import '@/styles/globals.css';

if (import.meta.env.PROD) {
  document.documentElement.classList.add('nexus-packaged');
}

const isAgentPip = window.location.hash.replace(/^#\/?/, '').startsWith('agent-pip');

if (isAgentPip) {
  document.documentElement.classList.add('agent-pip');
  document.body.classList.add('agent-pip');
}

createRoot(document.getElementById('root')!).render(
  <PaneErrorBoundary>{isAgentPip ? <AgentPipApp /> : <App />}</PaneErrorBoundary>,
);
