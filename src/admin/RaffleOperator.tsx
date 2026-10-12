import { hasRole, useAuth } from '../lib/auth';
import RaffleModule from './raffle/RaffleModule';

/** Sorteo final for the raffle role: run the draw and read the results of the current environment; nothing to configure. */
export default function RaffleOperator() {
  const { staff } = useAuth();
  return <RaffleModule canConfigure={hasRole(staff, 'coordinacion')} />;
}
