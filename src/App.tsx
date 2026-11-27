import { clearPlaygroundState } from './engine/simulationEngine';
import { AgenticTransactionPage } from './pages/AgenticTransactionPage';
import { LabLeaseGuard } from './shell';

export default function App() {
  const handleBackHome = () => {
    window.location.href =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:5173/'
        : 'https://0trust.dev/';
  };

  return (
    <LabLeaseGuard
      labSlug="agentic-transaction"
      labTitle="Controlled AI Financial Actions"
      onLeaseEnded={clearPlaygroundState}
    >
      <AgenticTransactionPage onBackHome={handleBackHome} />
    </LabLeaseGuard>
  );
}
