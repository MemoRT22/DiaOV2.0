import { WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-warning-500 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-sm font-semibold text-neutral-950"
    >
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      Sin conexión. Tus datos se conservan; reintenta cuando vuelva la señal.
    </div>
  );
}
