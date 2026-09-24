import React, { useEffect, useState } from 'react';
import AvatarVideo from './AvatarVideo';
import AvatarMMD from './AvatarMMD';
import EnergyCore from './EnergyCore';
import { isNativeApp } from '../utils/hostLink';
import { FLOAT_VIEW_EVENT, drawsFigure, getFloatView } from '../utils/floatView';
import { isSpeakingNow, onSpeaking } from '../utils/speakingState';

/**
 * The character, alone, in the phone's floating window.
 *
 * Android shrinks the whole activity into picture-in-picture, so without this
 * the window showed whichever screen was open. The voice call has its own
 * character-only layout (html.sm-pip in index.css); every other screen - the
 * chat above all, which is where "open YouTube" is usually typed - showed a
 * clipped slice of itself. This draws over all of them while floating -
 * during a call too, so the choice in Settings is what the window shows;
 * the call carries on listening underneath.
 *
 * Mounted only while floating, so nothing here costs anything full-screen.
 */
const floatingNow = () => (
  typeof document !== 'undefined' && document.documentElement.classList.contains('sm-pip')
);

export default function PipCompanion() {
  const [floating, setFloating] = useState(floatingNow);
  const [view, setView] = useState(getFloatView);
  // Talking while floating: the character moves as it does in the full call.
  const [speaking, setSpeakingState] = useState(isSpeakingNow);

  useEffect(() => onSpeaking(setSpeakingState), []);

  useEffect(() => {
    if (!isNativeApp()) return undefined;
    // MainActivity announces every change of window mode.
    const onPip = (event) => {
      const next = Boolean(event?.detail?.floating);
      setFloating(next);
      // Read again on the way in: the choice may have changed in Settings.
      if (next) setView(getFloatView());
    };
    const onView = () => setView(getFloatView());
    window.addEventListener('smaran:pip', onPip);
    window.addEventListener(FLOAT_VIEW_EVENT, onView);
    return () => {
      window.removeEventListener('smaran:pip', onPip);
      window.removeEventListener(FLOAT_VIEW_EVENT, onView);
    };
  }, []);

  const shown = isNativeApp() && floating && drawsFigure(view);

  // The call's own figure is covered while this is up; hidden, so the phone
  // is not drawing two characters where one can be seen.
  useEffect(() => {
    document.documentElement.classList.toggle('sm-pip-figure', shown);
    return () => document.documentElement.classList.remove('sm-pip-figure');
  }, [shown]);

  if (!shown) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] overflow-hidden"
      style={{ background: 'radial-gradient(circle at 50% 35%, #1e1b4b 0%, #020617 75%)' }}
      aria-label="SMARAN"
      data-testid="pip-companion"
    >
      {view === 'myra' && <AvatarVideo characterId="anime-girl" isSpeaking={speaking} className="w-full h-full" />}
      {view === 'amarya' && <AvatarMMD characterId="evelyn" isSpeaking={speaking} />}
      {view === 'core' && (
        <div className="w-full h-full flex items-center justify-center">
          <EnergyCore voiceState={speaking ? 'speaking' : 'idle'} micVolume={0} />
        </div>
      )}
    </div>
  );
}
