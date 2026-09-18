import { ServerStatusBanner } from "./components/ServerStatusBanner";
import { useServerStatus } from "./hooks/useServerStatus";
import { HomePage } from "./pages/HomePage";

export function App() {
  const { status, retry } = useServerStatus();
  return (
    <>
      <ServerStatusBanner status={status} onRetry={retry} />
      <HomePage serverStatus={status} />
    </>
  );
}
