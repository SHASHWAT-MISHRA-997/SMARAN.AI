import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ensureDeviceUser, getCurrentUser } from './context/AuthContext.jsx';
import './index.css';
import { isHandheld } from './utils/device';

// Phones and tablets get the still versions of the decorations (index.css,
// `html.is-handheld`). Set by device, before the first render, rather than
// left to a hover/pointer media query that not every WebView answers the
// same way.
if (isHandheld()) document.documentElement.classList.add('is-handheld');

// Unregister ALL service workers — nginx cache-control headers handle caching.
// This prevents stale SW caches from ever blocking updates again.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((reg) => {
      reg.unregister();
      console.log('[SW] Unregistered:', reg.scope);
    });
  });
}

async function initApp() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ThemeProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </ThemeProvider>
    </React.StrictMode>
  );
  // A sleeping paired computer must not leave the phone on a blank splash.
  // The local interface can render while the optional session is restored.
  try {
    await ensureDeviceUser();
    await getCurrentUser();
  } catch {
    console.info('The local interface is available; session restoration did not finish.');
  }
}

initApp().catch((e) => console.error('App init failed:', e));
