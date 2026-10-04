import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { OfflineBanner } from './components/OfflineBanner';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './theme/ThemeProvider';
import './index.css';

const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData) {
  document.documentElement.classList.add('lite');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <OfflineBanner />
          <App />
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
);
