/**
 * A bench for Vega.
 *
 * She normally lives inside the call screen, behind a backend and a live
 * session. This mounts her alone so each state can be looked at and compared,
 * and so the mouth can be driven by a synthesised level instead of by waiting
 * for the assistant to say something.
 *
 * Development only. Vite builds `index.html` and nothing else, so this is not
 * part of any shipped bundle.
 */
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import AvatarVega from '../../src/components/AvatarVega.jsx';

const STATES = ['idle', 'listening', 'thinking', 'speaking'];

/**
 * A stand-in for the assistant's audio.
 *
 * Satisfies exactly the surface the avatar touches - createAnalyser, connect,
 * disconnect and getByteFrequencyData - with a moving spectrum, so the mouth
 * can be watched without a real voice. Anything beyond that surface is absent
 * on purpose: a fuller fake would hide a change that started using more of the
 * Web Audio API than this.
 */
const stubVoice = (levelRef) => {
  const analyser = {
    fftSize: 256,
    smoothingTimeConstant: 0.6,
    frequencyBinCount: 128,
    getByteFrequencyData(target) {
      const base = levelRef.current * 2.4;
      for (let i = 0; i < target.length; i += 1) {
        target[i] = Math.max(0, Math.min(255,
          base * (0.6 + Math.sin(Date.now() / 90 + i / 7) * 0.4)));
      }
    },
  };
  return {
    context: { createAnalyser: () => analyser },
    source: { connect() {}, disconnect() {} },
  };
};

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const [state, setState] = useState(params.get('state') || 'idle');
  const [level, setLevel] = useState(Number(params.get('level') ?? 60));
  const levelRef = useMemo(() => ({ current: level }), []);
  levelRef.current = level;

  const voice = useMemo(() => (
    params.get('voice') === 'stub' ? stubVoice(levelRef) : { context: null, source: null }
  ), []);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#cfe' }}>
      <div style={{ padding: 12, display: 'flex', gap: 12, alignItems: 'center',
                    fontFamily: 'monospace', fontSize: 13 }}>
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            style={{
              padding: '6px 12px', cursor: 'pointer',
              background: state === s ? '#22e2ff' : 'transparent',
              color: state === s ? '#04070d' : '#cfe',
              border: '1px solid #22e2ff66', borderRadius: 8,
            }}
          >
            {s}
          </button>
        ))}
        <label style={{ marginLeft: 'auto' }}>
          level&nbsp;
          <input type="range" min="0" max="100" value={level}
                 onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AvatarVega
          speechSource={voice.source}
          speechContext={voice.context}
          isSpeaking={state === 'speaking'}
          isListening={state === 'listening'}
          isThinking={state === 'thinking'}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
