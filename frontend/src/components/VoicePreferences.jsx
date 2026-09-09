import React, { useEffect, useState } from 'react';

export default function VoicePreferences() {
  const [microphones, setMicrophones] = useState([]);
  const [selectedMic, setSelectedMic] = useState(() => localStorage.getItem('sm_voice_mic') || 'default');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(() => localStorage.getItem('sm_tts_voice') || '');
  const [personaGender, setPersonaGender] = useState(() => localStorage.getItem('sm_persona_gender') || 'female');
  const [continuousDictation, setContinuousDictation] = useState(() => localStorage.getItem('sm_continuous_dictation') !== 'false');
  const [testNotice, setTestNotice] = useState('');

  useEffect(() => {
    // Enumerate microphones
    if (typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices()
        .then(devices => {
          const audioInputs = devices.filter(d => d.kind === 'audioinput');
          setMicrophones(audioInputs);
        })
        .catch(() => {});
    }

    // Enumerate TTS voices
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const updateVoices = () => {
        const available = window.speechSynthesis.getVoices();
        setVoices(available);
        if (!selectedVoice && available.length > 0) {
          const defaultV = available.find(v => v.lang.startsWith('en') || v.lang.startsWith('hi')) || available[0];
          if (defaultV) {
            setSelectedVoice(defaultV.name);
            localStorage.setItem('sm_tts_voice', defaultV.name);
          }
        }
      };
      updateVoices();
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, [selectedVoice]);

  const handleMicChange = (id) => {
    setSelectedMic(id);
    localStorage.setItem('sm_voice_mic', id);
  };

  const handleVoiceChange = (name) => {
    setSelectedVoice(name);
    localStorage.setItem('sm_tts_voice', name);
  };

  const handleGenderChange = (gender) => {
    setPersonaGender(gender);
    localStorage.setItem('sm_persona_gender', gender);
  };

  const handleContinuousToggle = (val) => {
    setContinuousDictation(val);
    localStorage.setItem('sm_continuous_dictation', String(val));
  };

  const testVoicePlayback = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTestNotice('Speech synthesis is not supported on this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const sampleText = personaGender === 'female'
      ? 'Namaste! Main SMARAN hoon, aapki AI saathi. Main aapki kya madad kar sakti hoon?'
      : 'Namaste! Main SMARAN Energy Core hoon. Main aapke system aur desktop ko control kar sakta hoon.';
    const utterance = new SpeechSynthesisUtterance(sampleText);
    const chosen = voices.find(v => v.name === selectedVoice);
    if (chosen) utterance.voice = chosen;
    utterance.rate = 1.0;
    utterance.pitch = personaGender === 'female' ? 1.05 : 0.95;
    utterance.onend = () => setTestNotice('Playback finished.');
    utterance.onerror = () => setTestNotice('Playback error.');
    setTestNotice('Playing test voice sample…');
    window.speechSynthesis.speak(utterance);
  };

  return (
    <section className="space-y-6 text-ink" aria-label="Voice and speech preferences">
      <div>
        <h3 className="text-lg font-bold text-ink">Voice & Speech Preferences</h3>
        <p className="text-sm text-ink-muted">Configure microphone capture, character persona voice, and dictation settings.</p>
      </div>

      {/* Microphone Selection */}
      <div className="border-b border-line pb-4 space-y-2">
        <label htmlFor="sm-mic-select" className="text-sm font-semibold text-ink flex items-center justify-between">
          <span>Input Microphone</span>
          <span className="text-xs text-ink-faint">{microphones.length} detected</span>
        </label>
        <select
          id="sm-mic-select"
          className="w-full rounded-xl border border-line bg-sunken p-2.5 text-xs text-ink outline-none"
          value={selectedMic}
          onChange={e => handleMicChange(e.target.value)}
        >
          <option value="default">Default System Microphone</option>
          {microphones.map(mic => (
            <option key={mic.deviceId} value={mic.deviceId}>
              {mic.label || `Microphone (${mic.deviceId.slice(0, 8)})`}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-ink-faint">Audio is processed locally and never recorded silently in the background.</p>
      </div>

      {/* Persona Character & Gender */}
      <div className="border-b border-line pb-4 space-y-2">
        <label className="text-sm font-semibold text-ink block">Character Persona & Gender</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => handleGenderChange('female')}
            className={`p-3.5 rounded-2xl border text-left transition ${
              personaGender === 'female'
                ? 'border-indigo-500 bg-indigo-500/10 font-bold'
                : 'border-line bg-sunken hover:border-line-strong'
            }`}
          >
            <div className="text-xs font-bold text-ink">AMARYA / MYRA</div>
            <div className="text-[11px] text-ink-muted mt-1">Natural female persona. Uses feminine grammar (karti hoon, kholti hoon).</div>
          </button>
          <button
            type="button"
            onClick={() => handleGenderChange('male')}
            className={`p-3.5 rounded-2xl border text-left transition ${
              personaGender === 'male'
                ? 'border-indigo-500 bg-indigo-500/10 font-bold'
                : 'border-line bg-sunken hover:border-line-strong'
            }`}
          >
            <div className="text-xs font-bold text-ink">Energy Core</div>
            <div className="text-[11px] text-ink-muted mt-1">Natural male persona. Uses masculine grammar (karta hoon, kholta hoon).</div>
          </button>
        </div>
      </div>

      {/* TTS Voice Selection & Preview */}
      <div className="border-b border-line pb-4 space-y-2">
        <label htmlFor="sm-tts-select" className="text-sm font-semibold text-ink flex items-center justify-between">
          <span>Speech Synthesizer Voice</span>
          <span className="text-xs text-ink-faint">{voices.length} voices available</span>
        </label>
        <div className="flex gap-2">
          <select
            id="sm-tts-select"
            className="flex-1 rounded-xl border border-line bg-sunken p-2.5 text-xs text-ink outline-none"
            value={selectedVoice}
            onChange={e => handleVoiceChange(e.target.value)}
          >
            {voices.map(v => (
              <option key={v.name} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={testVoicePlayback}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shrink-0 transition"
          >
            Test Voice
          </button>
        </div>
        {testNotice && <p className="text-xs text-indigo-400 mt-1">{testNotice}</p>}
      </div>

      {/* Dictation Settings */}
      <div className="space-y-3">
        <label className="flex items-center justify-between gap-4 cursor-pointer">
          <div>
            <div className="text-xs font-semibold text-ink">Continuous Spoken Dictation</div>
            <div className="text-[11px] text-ink-muted">Preserve complete sentences and pauses without cutting off speech early.</div>
          </div>
          <input
            type="checkbox"
            checked={continuousDictation}
            onChange={e => handleContinuousToggle(e.target.checked)}
            className="h-4 w-4 rounded accent-indigo-600 cursor-pointer"
          />
        </label>
      </div>
    </section>
  );
}
