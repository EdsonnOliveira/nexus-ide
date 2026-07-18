import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isStandaloneDisplay } from './maestro/webPush';
import './styles.css';

if (isStandaloneDisplay()) {
  document.documentElement.classList.add('nexus-standalone');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
