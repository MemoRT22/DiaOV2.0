import { Suspense } from 'react';
import { MapPinned } from 'lucide-react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Backdrop } from '../components/themed';
import { BootSpinner } from '../components/BootSpinner';
import RouteErrorBoundary from '../components/RouteErrorBoundary';
import { useAuth } from '../lib/auth';
import { useVisualViewportAnchor } from '../lib/useVisualViewportAnchor';
import { useEdition } from '../edition/EditionProvider';
import { usePublicTheme } from '../theme/PublicThemeProvider';
import BottomNav from './BottomNav';
import { MapLink } from './campus/mapLinks';
import ExitSurveyInvite from './ExitSurveyInvite';
import { ExitSurveyProvider } from './ExitSurveyProvider';
import { RafflePrizeProvider } from './RafflePrizeProvider';
import ScrollManager from './ScrollManager';
import WinnerNotice from './WinnerNotice';

export default function StudentLayout() {
  const { ready, profile } = useAuth();
  const { theme, loading } = usePublicTheme();
  const { edition } = useEdition();
  const location = useLocation();
  const headerRef = useVisualViewportAnchor<HTMLElement>('top');

  if (!ready || loading) return <BootSpinner />;
  if (!profile) return <Navigate to="/" replace />;

  const consentOk = !!edition && profile.platform_consent_version === edition.privacy_notice_version;
  const onWelcome = location.pathname === '/bienvenida';
  if (!consentOk && !onWelcome) return <Navigate to="/bienvenida" replace />;
  if (consentOk && onWelcome) return <Navigate to="/bitacora" replace />;

  return (
    <RafflePrizeProvider enabled={consentOk}>
    <ExitSurveyProvider enabled={consentOk}>
      <div className="relative min-h-dvh">
        <Backdrop />
        <ScrollManager />
        {/* Slim header: vertical space on a phone is for the event, not for chrome. Sign-out lives in Bitácora.
            The right slot is the campus map: «¿dónde queda?» is the question a student asks most during the event, and the
            map has no tab of its own (Bitácora already has one, so the old initials badge only duplicated it). */}
        <header ref={headerRef} className="chrome-surface sticky top-0 z-30 border-b border-line/60 pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-12 max-w-2xl items-center justify-between px-4">
            <div className="flex min-w-0 items-center gap-2">
              {theme.assets.logoMark && <img src={theme.assets.logoMark} alt="" className="h-6 w-6 object-contain" />}
              <span className="truncate font-display text-sm font-extrabold uppercase tracking-wider">{theme.meta.eventName}</span>
            </div>
            {consentOk &&
              (location.pathname === '/mapa' ? (
                // Already on the map: the button only says so (a link to itself would also overwrite «Volver»).
                <span aria-current="page" aria-label="Mapa del campus (estás aquí)" className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500 text-on-primary">
                  <MapPinned className="h-[1.15rem] w-[1.15rem]" aria-hidden />
                </span>
              ) : (
                // MapLink carries the screen we come from, so «Volver» on the map returns there and not always to Inicio.
                // A quiet 40 px glass circle (44 px touch area): the brand leads, the map is one tap away without competing with the
                // primary action of each screen. The name is for assistive technology and the tooltip.
                <MapLink
                  to="/mapa"
                  ariaLabel="Mapa del campus"
                  title="Mapa del campus"
                  className="relative -mr-1 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface-raised/60 text-fg-brand transition-colors after:absolute after:-inset-1 after:content-[''] hover:bg-surface-raised active:scale-95"
                >
                  <MapPinned className="h-[1.15rem] w-[1.15rem]" aria-hidden />
                </MapLink>
              ))}
          </div>
        </header>

        <main className={`relative mx-auto max-w-2xl px-4 pt-5 ${consentOk ? 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]' : 'pb-10'}`}>
          <RouteErrorBoundary resetKey={location.pathname}>
            <Suspense fallback={<BootSpinner />}>
              <Outlet />
            </Suspense>
          </RouteErrorBoundary>
        </main>

        {consentOk && <BottomNav />}
        {consentOk && <WinnerNotice />}
        {consentOk && <ExitSurveyInvite />}
      </div>
    </ExitSurveyProvider>
    </RafflePrizeProvider>
  );
}
