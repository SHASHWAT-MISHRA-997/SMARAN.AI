import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Vega — a character with no asset behind her.
 *
 * Every part of this figure is generated at runtime from primitives, so there
 * is no model file, no texture and nothing downloaded. That is the point: the
 * other characters are third-party art whose terms are somebody else's to set,
 * and one of them explicitly forbids redistribution. This one is code in this
 * repository under the same MIT licence as everything around it, which means it
 * can ship anywhere the app ships and be changed by anyone who has the source.
 *
 * SHE IS DELIBERATELY NOT A PERSON
 *
 * A humanoid built from spheres and cylinders lands in the uncanny valley
 * immediately, and no amount of tuning rescues it. So Vega is a *constructed*
 * being: a floating head, a suspended core, and hands that orbit rather than
 * hang from arms. Nothing is skinned, nothing is rigged, and there is no
 * skeleton to animate - which is also why she costs a fraction of what the MMD
 * path costs to load and draw.
 *
 * She reads the same signals as the other avatars, so the call screen does not
 * care which is on stage:
 *
 *   isSpeaking   the mouth opens on the assistant's real audio level
 *   isListening  she leans in and her eyes widen
 *   isThinking   she tilts and her rings pick up speed
 */

/**
 * Her entry for the picker and the voice.
 *
 * The gender is here rather than inferred, because the speech engine picks a
 * voice from it and a constructed figure gives it nothing to guess from. One
 * word to change if she should sound otherwise.
 */
export const VEGA_CHARACTER = { id: 'vega', name: 'Vega', gender: 'female' };

// The palette the rest of the interface already uses, so she belongs on the
// same stage as the Energy Core rather than looking pasted in.
const CYAN = 0x22e2ff;
const MAGENTA = 0xff40a0;
const VIOLET = 0x8250ff;

/** Smoothing that behaves the same whatever the frame rate. */
const approach = (current, target, rate, delta) =>
  current + (target - current) * Math.min(1, rate * delta);

const AvatarVega = ({
  /** Audio node carrying the assistant's speech, for the mouth. */
  speechSource = null,
  speechContext = null,
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  className = '',
}) => {
  const mountRef = useRef(null);
  const sceneRef = useRef({});
  const analyserRef = useRef(null);
  const loudnessRef = useRef(0);
  // Read inside the animation loop, which is created once; without this the
  // loop would close over the first render's props for ever.
  const stateRef = useRef({ isSpeaking, isListening, isThinking });
  stateRef.current = { isSpeaking, isListening, isThinking };

  // ── Build her ────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    // Framed on the chest, not the origin. She is a little over two units tall
    // with her head above the middle, so aiming at 0 put her in the top third
    // of the frame with the space below her doing nothing.
    camera.position.set(0, 0.35, 4.3);
    camera.lookAt(0, 0.35, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.2;
    // The canvas is told its display size in CSS, and setSize below is told
    // not to touch that. Without this it has no CSS size at all, so the
    // browser lays it out from its width/height *attributes* - which are the
    // drawing buffer, which is set from the parent's measured height. The
    // parent then grows to fit, the observer fires, and the two chase each
    // other: measured here at 26,843,546 pixels tall, with nothing visible
    // because the figure was drawn somewhere far off screen.
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    // Everything hangs off one group so a single tilt moves the whole figure.
    const root = new THREE.Group();
    scene.add(root);

    // Materials are shared where the look is shared and disposed together at
    // the end; a mesh per part with its own material would be several dozen
    // programs for a figure that uses three colours.
    const shell = new THREE.MeshStandardMaterial({
      color: 0x121a2e, roughness: 0.35, metalness: 0.65,
      emissive: new THREE.Color(VIOLET), emissiveIntensity: 0.12,
    });
    const glowCyan = new THREE.MeshBasicMaterial({ color: CYAN, transparent: true, opacity: 0.95 });
    const glowMagenta = new THREE.MeshBasicMaterial({ color: MAGENTA, transparent: true, opacity: 0.9 });
    const ringMat = new THREE.MeshBasicMaterial({
      color: CYAN, transparent: true, opacity: 0.32, side: THREE.DoubleSide,
    });

    // ── Head ────────────────────────────────────────────────────────────
    // A rounded skull with a dark visor band across the eyes. The band is what
    // makes her read as a face rather than a ball with dots on it: without a
    // surface to sit on, two small glowing shapes on a sphere look like
    // reflections.
    const head = new THREE.Group();
    head.position.set(0, 1.02, 0);
    root.add(head);

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.46, 48, 40), shell);
    skull.scale.set(1, 1.04, 0.94);
    head.add(skull);

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x04060d, roughness: 0.15, metalness: 0.95,
      emissive: new THREE.Color(CYAN), emissiveIntensity: 0.08,
    });
    // A band around the head at eye height, not a cap on the front: it wraps
    // to the sides so she still has a face when she turns.
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.472, 0.472, 0.26, 48, 1, true), visorMat);
    visor.position.y = 0.05;
    visor.scale.z = 0.96;
    head.add(visor);

    // Eyes, on the band. Capsule-ish rather than round, which reads as a
    // deliberate optic instead of a cartoon dot.
    const eyeGeom = new THREE.CircleGeometry(0.075, 24);
    const eyeL = new THREE.Mesh(eyeGeom, glowCyan);
    const eyeR = new THREE.Mesh(eyeGeom, glowCyan);
    eyeL.position.set(-0.155, 0.05, 0.452);
    eyeR.position.set(0.155, 0.05, 0.452);
    eyeL.scale.x = 1.5;
    eyeR.scale.x = 1.5;
    head.add(eyeL, eyeR);

    // Mouth: a bar under the visor that opens with the voice. Scaled, never
    // rebuilt - regenerating geometry every frame is the reliable way to hold
    // a phone's GPU at full load for no reason.
    // A disc rather than a rectangle: squashed flat it is a line, and opened
    // it is a rounded oval. A plane opened into a pink brick across her chin.
    const mouth = new THREE.Mesh(new THREE.CircleGeometry(0.075, 24), glowMagenta);
    mouth.position.set(0, -0.21, 0.43);
    mouth.scale.set(1.5, 0.12, 1);
    head.add(mouth);

    // A strand of light over the crown, so she has a silhouette from behind
    // as well as a face from the front.
    const crest = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.018, 12, 60, Math.PI),
      new THREE.MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.8 }),
    );
    crest.rotation.set(Math.PI / 2, 0, 0);
    crest.position.y = 0.1;
    head.add(crest);

    // ── Body ────────────────────────────────────────────────────────────
    // A tapered shell: wide at the shoulders, narrow at the waist. This is
    // what turns "a ball above a ball" into a figure - the silhouette does the
    // work, and a cone costs nothing.
    const core = new THREE.Group();
    core.position.set(0, 0.02, 0);
    root.add(core);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.11, 0.2, 20), shell);
    neck.position.y = 0.44;
    core.add(neck);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.2, 0.78, 32, 1), shell);
    torso.position.y = -0.03;
    core.add(torso);

    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 20,
      0, Math.PI * 2, 0, Math.PI * 0.5), shell);
    shoulders.position.y = 0.36;
    shoulders.scale.set(1, 0.55, 0.85);
    core.add(shoulders);

    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.062, 20, 16),
      new THREE.MeshBasicMaterial({ color: CYAN }));
    heart.position.set(0, 0.14, 0.3);
    core.add(heart);

    // Two crossed rings around her. They carry the "thinking" state, because
    // speed is the cheapest legible signal for "working on it".
    const ringA = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.01, 10, 90), ringMat);
    const ringB = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.008, 10, 90), ringMat);
    ringA.rotation.set(Math.PI * 0.5, 0.3, 0);
    ringB.rotation.set(Math.PI * 0.38, -0.5, 0.4);
    ringA.position.y = -0.05;
    ringB.position.y = -0.05;
    core.add(ringA, ringB);

    // Arms: an upper and a lower segment either side, floating apart. No
    // skinning, no elbow that can bend the wrong way, and the gap reads as
    // deliberate rather than broken.
    const upperGeom = new THREE.CapsuleGeometry(0.075, 0.24, 6, 14);
    const handGeom = new THREE.IcosahedronGeometry(0.1, 0);
    const armL = new THREE.Mesh(upperGeom, shell);
    const armR = new THREE.Mesh(upperGeom, shell);
    armL.position.set(-0.5, 0.2, 0.02);
    armR.position.set(0.5, 0.2, 0.02);
    armL.rotation.z = 0.22;
    armR.rotation.z = -0.22;
    const handL = new THREE.Mesh(handGeom, shell);
    const handR = new THREE.Mesh(handGeom, shell);
    handL.position.set(-0.6, -0.22, 0.04);
    handR.position.set(0.6, -0.22, 0.04);
    root.add(armL, armR, handL, handR);

    // Light. Two coloured keys from either side give the shell its edges;
    // ambient alone left it a flat silhouette.
    scene.add(new THREE.AmbientLight(0x6070a0, 1.1));
    const keyL = new THREE.PointLight(CYAN, 26, 14);
    keyL.position.set(-2.4, 1.6, 2.6);
    const keyR = new THREE.PointLight(MAGENTA, 20, 14);
    keyR.position.set(2.6, 0.6, 1.8);
    const rim = new THREE.PointLight(VIOLET, 16, 16);
    rim.position.set(0, 1.4, -3);
    scene.add(keyL, keyR, rim);

    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    sceneRef.current = {
      scene, camera, renderer, root, head, core, mouth, eyeL, eyeR,
      armL, armR, handL, handR, ringA, ringB, heart, crest,
      clock: new THREE.Clock(), frameId: 0,
    };

    return () => {
      observer.disconnect();
      cancelAnimationFrame(sceneRef.current.frameId);
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
      });
      [shell, glowCyan, glowMagenta, ringMat].forEach((m) => m.dispose());
      visor.material.dispose();
      heart.material.dispose();
      crest.material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = {};
    };
  }, []);

  // ── Listen to the assistant's voice ──────────────────────────────────────
  useEffect(() => {
    if (!speechSource || !speechContext) return undefined;
    const analyser = speechContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    speechSource.connect(analyser);
    analyserRef.current = analyser;
    return () => {
      try { speechSource.disconnect(analyser); } catch { /* already gone */ }
      analyserRef.current = null;
    };
  }, [speechSource, speechContext]);

  // ── Animate ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handles = sceneRef.current;
    if (!handles.renderer) return undefined;

    const levels = new Uint8Array(128);
    // Someone who has asked for less motion still gets a character - the
    // states have to stay readable - but she holds still instead of drifting.
    const calm = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let blinkIn = 1.5 + Math.random() * 3;
    let blink = 0;
    let lean = 0;
    let tilt = 0;
    let ringSpeed = 0.25;
    let gaze = { x: 0, y: 0, nextIn: 1.2 };

    const animate = () => {
      handles.frameId = requestAnimationFrame(animate);
      const delta = Math.min(handles.clock.getDelta(), 0.05);
      const t = handles.clock.getElapsedTime();
      const { isSpeaking: speaking, isListening: listening, isThinking: thinking } = stateRef.current;

      // Mouth follows the real audio when there is any, and falls back to a
      // plausible rhythm when the voice is played somewhere this cannot reach
      // - a native Android engine, for one, which never exposes an audio node.
      let target = 0;
      if (analyserRef.current && speaking) {
        analyserRef.current.getByteFrequencyData(levels);
        let sum = 0;
        for (let i = 0; i < levels.length; i += 1) sum += levels[i];
        target = Math.min(1, (sum / levels.length) / 60);
      } else if (speaking) {
        target = 0.45 + Math.sin(t * 11) * 0.3 + Math.sin(t * 4.3) * 0.12;
      }
      loudnessRef.current = approach(loudnessRef.current, Math.max(0, target), 16, delta);
      // Capped deliberately: at full volume this is an open mouth, not a hole.
      handles.mouth.scale.y = 0.12 + loudnessRef.current * 0.95;
      handles.mouth.scale.x = 1.5 - loudnessRef.current * 0.22;

      // Blink. Squashing the discs is enough; the eyes are flat by design.
      blinkIn -= delta;
      if (blinkIn <= 0) { blink = 1; blinkIn = 1.8 + Math.random() * 4; }
      blink = approach(blink, 0, 9, delta);
      const openness = 1 - Math.sin(Math.min(1, blink) * Math.PI) * 0.94;
      handles.eyeL.scale.y = openness;
      handles.eyeR.scale.y = openness;

      // Where she is looking. Small, occasional, and never while blinking, so
      // it reads as attention rather than a twitch.
      gaze.nextIn -= delta;
      if (gaze.nextIn <= 0) {
        gaze = {
          x: (Math.random() - 0.5) * 0.12,
          y: (Math.random() - 0.5) * 0.07,
          nextIn: 1 + Math.random() * 2.5,
        };
      }
      const eyeShift = listening ? 1.25 : 1;
      handles.eyeL.position.x = approach(handles.eyeL.position.x, -0.155 + gaze.x, 4, delta);
      handles.eyeR.position.x = approach(handles.eyeR.position.x, 0.155 + gaze.x, 4, delta);
      // 1.5 is the resting stretch that makes the eye an optic rather than a
      // dot; listening widens it from there.
      handles.eyeL.scale.x = approach(handles.eyeL.scale.x, 1.5 * eyeShift, 6, delta);
      handles.eyeR.scale.x = approach(handles.eyeR.scale.x, 1.5 * eyeShift, 6, delta);

      // Posture. Listening leans in, thinking tilts away and looks up.
      lean = approach(lean, listening ? 0.16 : 0, 4, delta);
      tilt = approach(tilt, thinking ? 0.2 : 0, 3.5, delta);
      handles.root.rotation.x = -lean * 0.5;
      handles.root.position.z = lean * 0.5;
      handles.head.rotation.z = tilt * 0.6;
      handles.head.rotation.y = approach(handles.head.rotation.y, gaze.x * 1.6, 3, delta);

      // Breath, and a slow drift so she is never perfectly still.
      const breath = calm ? 0 : Math.sin(t * 1.15) * 0.035;
      handles.head.position.y = 1.02 + breath;
      handles.core.position.y = 0.02 + breath * 0.6;
      handles.core.scale.setScalar(1 + breath * 0.12 + loudnessRef.current * 0.05);

      // Arms drift, and the hands lift while she talks - the one gesture, and
      // enough of one, because it is tied to something real.
      const swing = calm ? 0 : Math.sin(t * 0.9) * 0.035;
      const lift = loudnessRef.current * 0.16;
      handles.armL.position.set(-0.5 + swing * 0.4, 0.2 + swing, 0.02);
      handles.armR.position.set(0.5 - swing * 0.4, 0.2 - swing, 0.02);
      handles.handL.position.set(-0.6 + swing, -0.22 + lift + swing * 0.5, 0.04);
      handles.handR.position.set(0.6 - swing, -0.22 + lift - swing * 0.5, 0.04);
      handles.handL.rotation.y += delta * 0.5;
      handles.handR.rotation.y -= delta * 0.5;

      // The rings are the "working" signal.
      ringSpeed = approach(ringSpeed, thinking ? 2.4 : 0.25, 2.5, delta);
      handles.ringA.rotation.z += delta * ringSpeed;
      handles.ringB.rotation.z -= delta * ringSpeed * 0.7;

      // The core brightens with her voice, so the whole figure reacts and not
      // just the mouth.
      handles.heart.material.color.setHex(listening ? MAGENTA : CYAN);
      handles.heart.scale.setScalar(1 + loudnessRef.current * 0.45
        + (calm ? 0 : Math.sin(t * 2.2) * 0.04));

      handles.renderer.render(handles.scene, handles.camera);
    };

    animate();
    return () => cancelAnimationFrame(handles.frameId);
  }, []);

  return (
    <div
      ref={mountRef}
      className={`relative w-full h-full overflow-hidden ${className}`}
      // Decorative: the state she is showing is already announced in words by
      // the status line, so a screen reader reading this too would repeat it.
      aria-hidden="true"
    />
  );
};

export default AvatarVega;
