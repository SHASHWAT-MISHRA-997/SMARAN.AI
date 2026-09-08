/**
 * A bench for the Energy Core.
 *
 * The core normally lives inside the voice assistant, behind a backend, a PIN
 * screen and a live session, which is a long way to walk to look at one
 * canvas. This mounts it on its own so each state can be seen, compared and
 * screenshotted, and so the analyser path can be driven by a synthesised tone
 * rather than by waiting for the assistant to say something.
 *
 * Development only. Vite builds `index.html` and nothing else, so this is not
 * part of any shipped bundle.
 */
import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import EnergyCore from '../../src/components/EnergyCore.jsx';
import { CORE_STATES } from '../../src/utils/coreStates.js';

// Every state, taken from the same list the core draws from, so a state added
// there cannot be missing from the bench that is supposed to show it.
const STATES = CORE_STATES;

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const [state, setState] = useState(params.get('state') || 'idle');
  const [level, setLevel] = useState(Number(params.get('level') ?? 45));
  const [tone, setTone] = useState(params.get('tone') || '');
  // ?voice=stub supplies a context and source that satisfy exactly the surface
  // the core uses - createAnalyser, connect, disconnect, frequencyBinCount and
  // getByteFrequencyData - with a moving synthetic spectrum. A live
  // AudioContext needs a user gesture the automation cannot produce, and the
  // browser's own audio graph is not the code under test; the analyser wiring,
  // the amplitude read and the spectrum ring are.
  const stubBus = useMemo(() => {
    if (params.get('voice') !== 'stub') return null;
    const analyser = {
      fftSize: 128,
      smoothingTimeConstant: 0,
      frequencyBinCount: 64,
      getByteFrequencyData(target) {
        const t = performance.now() / 1000;
        for (let i = 0; i < target.length; i += 1) {
          const fall = 1 - i / target.length;
          target[i] = Math.max(0, Math.min(255,
            Math.round((0.45 + 0.4 * Math.sin(t * 4 + i * 0.35)) * 255 * fall)));
        }
      },
    };
    return {
      node: { connect() {}, disconnect() {} },
      context: { createAnalyser: () => analyser },
    };
  }, []);

  const [bus, setBus] = useState(stubBus);

  // A real AnalyserNode needs a real graph. An oscillator through a gain node
  // is enough to prove the spectrum ring reads actual bins rather than a
  // number dressed up as frequency content.
  const connectVoice = async () => {
    const context = new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    const osc = context.createOscillator();
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    const gain = context.createGain();
    osc.type = 'sawtooth';
    osc.frequency.value = 190;
    lfo.frequency.value = 3.1;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    gain.gain.value = 0.35;
    osc.connect(gain);
    osc.start();
    lfo.start();
    // Not connected to the destination: the point is the analyser, and a
    // sawtooth in the room is nobody's idea of a good time.
    setBus({ node: gain, context });
  };

  const buttons = useMemo(() => STATES, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#04070d', color: '#cfe9ff',
                  fontFamily: 'ui-monospace, monospace' }}>
      <div id="stage" style={{ position: 'absolute', inset: 0 }}>
        <EnergyCore
          voiceState={state}
          micVolume={level}
          speechSource={bus?.node || null}
          speechContext={bus?.context || null}
          toneText={tone}
        />
      </div>

      <div style={{ position: 'absolute', left: 12, top: 12, display: 'flex', gap: 8,
                    flexWrap: 'wrap', alignItems: 'center', fontSize: 12, zIndex: 5 }}>
        {buttons.map((s) => (
          <button
            key={s}
            id={`state-${s}`}
            onClick={() => setState(s)}
            style={{
              padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
              background: state === s ? '#0aa' : 'rgba(255,255,255,.08)',
              color: '#fff', border: '1px solid rgba(255,255,255,.18)',
            }}
          >{s}</button>
        ))}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          level {level}
          <input id="level" type="range" min="0" max="100" value={level}
                 onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
        <input id="tone" placeholder="spoken line" value={tone}
               onChange={(e) => setTone(e.target.value)}
               style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)',
                        color: '#fff', padding: '4px 8px', borderRadius: 8, width: 220 }} />
        <button id="connect-voice" onClick={connectVoice}
                style={{ padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                         background: bus ? '#0a6' : 'rgba(255,255,255,.08)', color: '#fff',
                         border: '1px solid rgba(255,255,255,.18)' }}>
          {bus ? 'analyser connected' : 'connect synthetic voice'}
        </button>
      </div>
    </div>
  );
}

// Vite's hot reload re-runs this module, and a second createRoot on the same
// container mounts a second tree on top of the first - two cores competing for
// the same box, which is what made the bench look broken rather than the
// component. Keep the root and re-render it.
const container = document.getElementById('root');
const root = (window.__energyCoreRoot ||= createRoot(container));
root.render(<Harness />);
