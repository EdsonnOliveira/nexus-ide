import { createRoot } from 'react-dom/client';
import App from './App';
import { PaneErrorBoundary } from '@/components/overlay/PaneErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <PaneErrorBoundary>
    <App />
  </PaneErrorBoundary>,
);
