import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, QrCode, RefreshCw, Smartphone, Trash2, X } from 'lucide-react';
import { API_BASE } from '../context/AuthContext';
import { isNativeApp, loadLink, pairWithPayload, saveLink, syncWithHost } from '../utils/hostLink';

/**
 * Linking a phone to this desktop.
 *
 * The same screen serves both ends and picks its side automatically:
 *
 *   * On the desktop it shows a QR code carrying this machine's address on the
 *     local network plus a short-lived pairing code, and lists the devices
 *     already linked.
 *   * In the phone app it opens the camera to read that QR. Where the browser
 *     has no barcode reader, the address and code can be typed instead, so the
 *     feature never becomes unreachable.
 *
 * Nothing leaves the local network: the phone talks straight to the desktop.
 */

const POLL_MS = 4000;

const jsonRequest = async (url, options = {}) => {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.detail || `Request failed (${response.status}).`);
  return payload;
};

/* ------------------------------------------------------------------ */
/* Desktop: show the code                                              */
/* ------------------------------------------------------------------ */

const DesktopPairing = () => {
  const [pairing, setPairing] = useState(null);
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const port = Number(window.location.port) || (window.location.protocol === 'https:' ? 443 : 80);

  const startPairing = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const data = await jsonRequest(`/api/companion/pairing/start?port=${port}`, { method: 'POST' });
      setPairing(data);
      setSecondsLeft(data.expires_in || 300);
    } catch (err) {
      setError(err.message);
      setPairing(null);
    } finally {
      setBusy(false);
    }
  }, [port]);

  const loadDevices = useCallback(async () => {
    try {
      const data = await jsonRequest('/api/companion/devices');
      setDevices(data.devices || []);
    } catch { /* the list is informational */ }
  }, []);

  useEffect(() => {
    startPairing();
    loadDevices();
  }, [startPairing, loadDevices]);

  // A phone that pairs shows up in the list, which is how the desktop learns
  // the handshake worked.
  useEffect(() => {
    const timer = window.setInterval(loadDevices, POLL_MS);
    return () => window.clearInterval(timer);
  }, [loadDevices]);

  // Count the code down, and offer a fresh one when it lapses.
  useEffect(() => {
    if (!secondsLeft) return undefined;
    const timer = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  const unpair = async (id) => {
    try {
      await jsonRequest(`/api/companion/devices/${id}`, { method: 'DELETE' });
      setDevices((current) => current.filter((d) => d.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const expired = pairing && secondsLeft === 0;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-cyan-400/20 bg-black/30 p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="relative shrink-0 rounded-2xl border border-cyan-400/25 bg-black/50 p-3">
            {busy && (
              <div className="flex h-[168px] w-[168px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-300" />
              </div>
            )}
            {!busy && pairing && (
              <img
                src={`${API_BASE}/api/companion/pairing/qr?payload=${encodeURIComponent(pairing.qr_payload)}`}
                alt="Pairing QR code"
                className={`h-[168px] w-[168px] transition ${expired ? 'opacity-25 blur-[2px]' : ''}`}
              />
            )}
            {!busy && !pairing && (
              <div className="flex h-[168px] w-[168px] items-center justify-center text-center text-[11px] text-zinc-500">
                No code
              </div>
            )}
            {expired && (
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black uppercase tracking-wider text-amber-300">
                Expired
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3 text-center sm:text-left">
            <div>
              <h3 className="text-sm font-black text-white">Link your phone</h3>
              <p className="mt-1 text-[11px] leading-5 text-zinc-400">
                Install SMARAN.AI on the phone, open <span className="font-bold text-zinc-200">Link a computer</span>,
                and scan this code. Both devices must be on the same Wi-Fi.
              </p>
            </div>

            {pairing && (
              <div className="space-y-1.5">
                <p className="font-mono text-2xl font-black tracking-[0.3em] text-cyan-200">{pairing.code}</p>
                <p className="font-mono text-[10px] text-zinc-500" title="The address is in the QR code; it is not shown here.">{displayName(pairing.url)}</p>
                <p className="text-[10px] text-zinc-500">
                  {expired
                    ? 'This code has lapsed.'
                    : `Valid for ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`}
                </p>
              </div>
            )}

            {error && <p className="text-[11px] leading-5 text-amber-300">{error}</p>}

            <button
              type="button"
              onClick={startPairing}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-[11px] font-black text-cyan-200 transition hover:bg-cyan-400/20 disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              New code
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-black/25 p-4">
        <h3 className="text-sm font-black text-white">Linked devices</h3>
        {devices.length === 0 ? (
          <p className="py-4 text-center text-[11px] text-zinc-600">No phone is linked yet.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {devices.map((device) => (
              <li
                key={device.id}
                className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-white/[.02] px-3 py-2"
              >
                <Smartphone className={`h-4 w-4 shrink-0 ${device.online ? 'text-emerald-400' : 'text-zinc-600'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[11px] font-black text-zinc-100">{device.name}</p>
                  <p className="text-[10px] text-zinc-500">
                    {device.online ? 'Online now' : `Last seen ${device.last_seen ? new Date(device.last_seen).toLocaleString() : 'never'}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => unpair(device.id)}
                  className="shrink-0 rounded-lg border border-zinc-700 p-1.5 text-zinc-500 transition hover:border-rose-500/40 hover:text-rose-300"
                  title={`Unlink ${device.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Phone: read the code                                                */
/* ------------------------------------------------------------------ */

const PhonePairing = ({ onPaired }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  const [link, setLink] = useState(() => loadLink());
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [manual, setManual] = useState({ url: '', code: '' });

  const finishPairing = useCallback(async (payload) => {
    setStatus('Linking…');
    setError('');
    try {
      const result = await pairWithPayload(payload, navigator.userAgent.includes('Tablet') ? 'Tablet' : 'Phone');
      setLink(result);
      setStatus(`Linked to ${result.url}`);
      onPaired?.(result);
      // Pull the desktop's history straight away so the phone is not empty.
      syncWithHost(result);
    } catch (err) {
      setError(err.message);
      setStatus('');
    }
  }, [onPaired]);

  const stopScan = useCallback(() => {
    setScanning(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startScan = useCallback(async () => {
    setError('');
    if (!('BarcodeDetector' in window)) {
      setError('This device has no built-in QR reader. Enter the address and code below instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setScanning(true);

      // eslint-disable-next-line no-undef
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!streamRef.current) return;
        rafRef.current = requestAnimationFrame(tick);
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            stopScan();
            finishPairing(codes[0].rawValue);
          }
        } catch { /* a frame the reader could not use */ }
      };
      tick();
    } catch (err) {
      setError(
        err?.name === 'NotAllowedError'
          ? 'Camera access is needed to scan the code.'
          : `The camera could not be opened: ${err?.message || 'unavailable'}`,
      );
    }
  }, [finishPairing, stopScan]);

  useEffect(() => stopScan, [stopScan]);

  const submitManual = (event) => {
    event.preventDefault();
    const url = manual.url.trim().replace(/\/+$/, '');
    const code = manual.code.trim();
    if (!url || !code) {
      setError('Enter both the address shown on the computer and its six-digit code.');
      return;
    }
    finishPairing({ v: 1, url: url.startsWith('http') ? url : `http://${url}`, code });
  };

  const unlink = () => {
    saveLink(null);
    setLink(null);
    setStatus('');
  };

  if (link) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/[.07] p-5 text-center">
          <Smartphone className="mx-auto h-6 w-6 text-emerald-400" />
          <p className="mt-2 text-sm font-black text-white">Linked to your computer</p>
          <p className="mt-1 font-mono text-[11px] text-zinc-400">{displayName(link.url)}</p>
          <p className="mt-3 text-[11px] leading-5 text-zinc-400">
            Conversations sync both ways. When the computer is off this app keeps working on its own,
            and anything you say here appears there the next time it starts.
          </p>
        </div>
        <button
          type="button"
          onClick={unlink}
          className="w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-[11px] font-black text-zinc-400 transition hover:border-rose-500/40 hover:text-rose-300"
        >
          Unlink this computer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-cyan-400/20 bg-black/30 p-4">
        <div className="relative overflow-hidden rounded-xl bg-black" style={{ aspectRatio: '1 / 1' }}>
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          {!scanning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <QrCode className="h-8 w-8 text-cyan-300/70" />
              <p className="px-6 text-[11px] leading-5 text-zinc-400">
                On your computer open Settings and choose Link your phone, then scan the code shown there.
              </p>
            </div>
          )}
          {scanning && (
            <span className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-cyan-300/70" />
          )}
        </div>

        <button
          type="button"
          onClick={scanning ? stopScan : startScan}
          className="mt-3 w-full rounded-xl border border-cyan-400/30 bg-cyan-400/12 px-4 py-2.5 text-xs font-black text-cyan-200 transition hover:bg-cyan-400/22"
        >
          {scanning ? 'Stop scanning' : 'Scan the QR code'}
        </button>

        {status && <p className="mt-2 text-center text-[11px] text-emerald-300">{status}</p>}
        {error && <p className="mt-2 text-center text-[11px] leading-5 text-amber-300">{error}</p>}
      </div>

      {/* Always available, so a device without a barcode reader is not stuck. */}
      <form onSubmit={submitManual} className="space-y-2 rounded-2xl border border-zinc-800 bg-black/25 p-4">
        <p className="text-[11px] font-black text-zinc-300">Or type it in</p>
        <input
          value={manual.url}
          onChange={(event) => setManual((m) => ({ ...m, url: event.target.value }))}
          placeholder="http://192.168.1.5:8000"
          inputMode="url"
          className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 font-mono text-xs text-zinc-100 outline-none focus:border-cyan-400/60"
        />
        <input
          value={manual.code}
          onChange={(event) => setManual((m) => ({ ...m, code: event.target.value }))}
          placeholder="6-digit code"
          inputMode="numeric"
          maxLength={6}
          className="w-full rounded-xl border border-zinc-700 bg-black/40 px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-zinc-100 outline-none focus:border-cyan-400/60"
        />
        <button
          type="submit"
          className="w-full rounded-xl border border-zinc-700 px-4 py-2.5 text-[11px] font-black text-zinc-300 transition hover:border-cyan-400/40 hover:text-cyan-200"
        >
          Link
        </button>
      </form>
    </div>
  );
};

/* ------------------------------------------------------------------ */

/* What to show instead of the address.

   The QR still carries the real one - a phone cannot reach a name this network
   does not resolve - but there is no reason to print it on screen. Anyone
   watching over a shoulder, or a screenshot shared for help, was getting the
   machine's address on the local network for nothing.

   The port is kept because it is the part someone typing the address by hand
   actually needs, and it gives away nothing on its own. */
const displayName = (url) => {
  const port = String(url || '').match(/:(\d+)/);
  return port ? `SMARAN.AI:${port[1]}` : 'SMARAN.AI';
};

const DevicePairing = ({ isOpen, onClose }) => {
  const onPhone = isNativeApp();
  // Scanning the QR with a phone camera opens this workspace with the code
  // in the address. Pair straight away rather than making the person read a
  // number off one screen and type it into another.
  const scannedCode = new URLSearchParams(window.location.search).get('pair');

  useEffect(() => {
    if (!scannedCode || loadLink()) return;
    pairWithPayload({ v: 1, url: window.location.origin, code: scannedCode }, 'Phone')
      .then((link) => syncWithHost(link))
      .catch(() => { /* the code has lapsed; the panel offers a fresh one */ });
  }, [scannedCode]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-cyan-400" />
            <h2 className="text-base font-black text-white">
              {onPhone ? 'Link a computer' : 'Link your phone'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          {onPhone ? <PhonePairing /> : <DesktopPairing />}
        </div>
      </div>
    </div>
  );
};

export default DevicePairing;
