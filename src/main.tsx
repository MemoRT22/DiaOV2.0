import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { OfflineBanner } from './components/OfflineBanner';
import { EditionProvider } from './edition/EditionProvider';
import { AuthProvider } from './lib/auth';
import { PublicThemeProvider } from './theme/PublicThemeProvider';
import { bootSurface } from './theme/surface';
import { normalizeTheme } from './theme/themeEngine';
import './index.css';

const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4 || nav.connection?.saveData) {
  document.documentElement.classList.add('lite');
}

// Paint the right surface (admin system or cached public theme) before the first render to avoid a flash.
bootSurface(window.location.pathname, normalizeTheme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <EditionProvider>
        <PublicThemeProvider>
          <AuthProvider>
            <OfflineBanner />
            <App />
          </AuthProvider>
        </PublicThemeProvider>
      </EditionProvider>
    </BrowserRouter>
  </StrictMode>,
);
