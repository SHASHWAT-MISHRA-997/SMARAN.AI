/**
 * A bench for a VRM character.
 *
 * The point of this one is that it takes a file. Drag a .vrm onto the page, or
 * pass ?file=<url>, and it loads through exactly the component the call screen
 * uses - so what is seen here is what the app will do, without needing the
 * backend, a session, or a character already installed.
 *
 * Development only. Vite builds `index.html` and nothing else, so this is not
 * part of any shipped bundle.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import AvatarVRM from '../../src/components/AvatarVRM.jsx';

const STATES = ['idle', 'listening', 'thinking', 'speaking'];

/**
 * A stand-in for the assistant's audio.
 *
 * Covers exactly the surface the avatar touches - createAnalyser, connect,
 * disconnect, getByteFrequencyData - with a moving spectrum, so the mouth can
 * be watched without a real voice. Nothing beyond that surface, on purpose: a
 * fuller fake would hide a change that started using more of the Web Audio API.
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
  return { context: { createAnalyser: () => analyser }, source: { connect() {}, disconnect() {} } };
};

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const [state, setState] = useState(params.get('state') || 'idle');
  const [level, setLevel] = useState(Number(params.get('level') ?? 65));
  const [file, setFile] = useState(params.get('file') || '');
  const [dropping, setDropping] = useState(false);
  const objectUrl = useRef('');

  const levelRef = useMemo(() => ({ current: level }), []);
  levelRef.current = level;
  const voice = useMemo(() => stubVoice(levelRef), []);  // eslint-disable-line react-hooks/exhaustive-deps

  // A dropped file is read from the browser's own object URL rather than being
  // uploaded anywhere - the same "it never leaves this machine" the characters
  // folder promises.
  const take = (dropped) => {
    if (!dropped) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    // A plain object URL, with nothing appended. The component always uses the
    // VRM loader - only the call screen's routing looks at a file extension -
    // so decorating this with the name would add a way for it to fail and buy
    // nothing.
    objectUrl.current = URL.createObjectURL(dropped);
    setFile(objectUrl.current);
  };

  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  return (
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', color: '#cfe',
               outline: dropping ? '2px dashed #22e2ff' : 'none' }}
      onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <div style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'center',
                    flexWrap: 'wrap', fontFamily: 'monospace', fontSize: 13 }}>
        {STATES.map((s) => (
          <button
            key={s} type="button" onClick={() => setState(s)}
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
        <label>
          level&nbsp;
          <input type="range" min="0" max="100" value={level}
                 onChange={(e) => setLevel(Number(e.target.value))} />
        </label>
        <input type="file" accept=".vrm" onChange={(e) => take(e.target.files?.[0])}
               style={{ color: '#cfe' }} />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {file ? (
          <AvatarVRM
            file={file}
            speechSource={voice.source}
            speechContext={voice.context}
            isSpeaking={state === 'speaking'}
            isListening={state === 'listening'}
            isThinking={state === 'thinking'}
          />
        ) : (
          <p style={{ textAlign: 'center', marginTop: '15%', opacity: 0.65,
                      fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 }}>
            Drop a .vrm here, or choose one above.<br />
            VRoid Studio exports these.
          </p>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
