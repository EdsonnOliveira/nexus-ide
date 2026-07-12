import { createRoot } from 'react-dom/client';
import App from './App';
import { PaneErrorBoundary } from '@/components/overlay/PaneErrorBoundary';

if (import.meta.env.PROD) {
  document.documentElement.classList.add('nexus-packaged');
}

createRoot(document.getElementById('root')!).render(
  <PaneErrorBoundary>
    <App />
  </PaneErrorBoundary>,
);
