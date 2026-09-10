/**
 * Bench for the sidebar's conversation list.
 *
 * Reported: with more than a few conversations the list does not show all of
 * them and will not scroll. Four guesses were wrong before this existed - a
 * missing `min-h-0`, a pointer-events overlay, a backend row limit, and a NULL
 * `section` hiding old rows - so this mounts the real component with a lot of
 * sessions and measures, instead of reasoning about it from the source.
 *
 * Open at /tests/visual/sidebar-scroll.html. `window.__bench` reports the
 * measurements.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import Sidebar from '../../src/components/Sidebar';

const COUNT = Number(new URLSearchParams(location.search).get('n') || 40);

const sessions = Array.from({ length: COUNT }, (_, i) => ({
  id: `s-${i}`,
  title: `Conversation number ${i + 1} with a fairly long title to test truncation`,
  section: 'chat',
  message_count: 3,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
}));

const noop = () => {};

function Bench() {
  return (
    <div className="flex h-screen">
      <Sidebar
        token="bench"
        user={{ username: 'bench', email: 'bench@example.com' }}
        sessions={sessions}
        activeSessionId="s-0"
        setActiveSessionId={noop}
        onCreateSession={noop}
        onDeleteSession={noop}
        onRenameSession={noop}
        onClearHistory={noop}
        onNavigate={noop}
        activeView="chat"
        onExpandChange={noop}
        onOpenWorkspace={noop}
        onOpenDirector={noop}
        onOpenAuth={noop}
        activeSection="chat"
        onSectionChange={noop}
        onMoveSession={noop}
      />
      <main className="flex-1" />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Bench />);

// Measured after paint so layout is settled.
setTimeout(() => {
  const aside = document.querySelector('aside.sidebar-desktop');
  // The scroller is the flex-1 child holding the session rows.
  const scroller = aside && [...aside.querySelectorAll('div')].find(
    (d) => d.className.includes('overflow-y-auto') && d.className.includes('flex-1'),
  );
  const rows = aside ? aside.querySelectorAll('[data-session-row], button').length : 0;
  window.__bench = {
    sessionsGiven: COUNT,
    asideFound: Boolean(aside),
    asideHeight: aside ? aside.getBoundingClientRect().height : null,
    viewportHeight: window.innerHeight,
    scrollerFound: Boolean(scroller),
    scrollerClient: scroller ? scroller.clientHeight : null,
    scrollerScroll: scroller ? scroller.scrollHeight : null,
    canScroll: scroller ? scroller.scrollHeight > scroller.clientHeight + 1 : null,
    buttonsRendered: rows,
  };
  document.title = 'bench-ready';
}, 1200);
