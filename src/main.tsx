import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './ui/theme.css';
import { App } from './ui/App';
import { store } from './data/store';
import { syncClient } from './data/syncClient';
import { checkTaxUpdates, getSettings, updateMarket } from './data/actions';
import { setupNative } from './platform/native';

async function boot() {
  await store.init();
  const root = createRoot(document.getElementById('root')!);
  root.render(<App />);
  void syncClient.start();
  void setupNative();
  // background refreshes: tax tables (daily) and prices (twice a day)
  const refresh = () => {
    const s = getSettings();
    if (!s.onboarded) return;
    if (s.integrations.autoUpdate) void checkTaxUpdates();
    void updateMarket();
  };
  setTimeout(refresh, 4000);
  setInterval(refresh, 3 * 3600_000);
}

void boot();
