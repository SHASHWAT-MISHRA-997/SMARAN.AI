import React from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import SmaranDesignView from '../../src/components/SmaranDesignView.jsx';

// Development-only component bench; no account or provider credentials.
createRoot(document.getElementById('root')).render(
  <SmaranDesignView onEnsureSession={async () => ({ id: 'design-fixture' })} />,
);
