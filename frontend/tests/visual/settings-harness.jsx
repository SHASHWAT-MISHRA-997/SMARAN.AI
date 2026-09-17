import React from 'react';
import { createRoot } from 'react-dom/client';
import GatewayPreferences from '../../src/components/GatewayPreferences';
import SandboxPreferences from '../../src/components/SandboxPreferences';
import SchedulerView from '../../src/components/SchedulerView';
import '../../src/index.css';

const view = new URLSearchParams(location.search).get('view');
const Component = view === 'gateway' ? GatewayPreferences : view === 'sandbox' ? SandboxPreferences : SchedulerView;
createRoot(document.getElementById('root')).render(<main className="dark bg-zinc-950 p-5 min-h-screen"><Component /></main>);
