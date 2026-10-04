import { QrCode } from 'lucide-react';
import { Link } from 'react-router-dom';
import { buttonClasses } from '../components/ui';

export default function ScanButton() {
  return (
    <Link to="/escanear" className={buttonClasses('primary', 'w-full')}>
      <QrCode className="h-5 w-5" aria-hidden />
      Escanear asistencia
    </Link>
  );
}
