import RaffleModule from './raffle/RaffleModule';

/** Sorteo final for Coordinación: prepare, run and review the raffle. */
export default function RaffleAdmin() {
  return <RaffleModule canConfigure />;
}
