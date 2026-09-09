import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * A VRM character — the kind VRoid Studio exports.
 *
 * This is the path for a character you made and therefore own. VRoid is free,
 * the avatar you design in it is yours, and a VRM carries everything needed to
 * animate a face: a standard expression set with real visemes (aa/ih/ou/ee/oh),
 * blinks, moods, a humanoid skeleton with named bones, and a look-at rig. None
 * of that has to be guessed at, which is the difference between this and the
 * MMD path, where the morph names vary by model and are matched against a list
 * of spellings seen in the wild.
 *
 * The mouth is driven by the assistant's own audio, so the lips follow whatever
 * is really being said rather than a canned loop.
 */

/** The five VRM visemes, cycled so speech is not one held shape. */
const VISEMES = ['aa', 'ih', 'ou', 'ee', 'oh'];

const approach = (current, target, rate, delta) =>
  current + (target - current) * Math.min(1, rate * delta);

const AvatarVRM = ({
  /** URL of the .vrm file. */
  file = '',
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
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const stateRef = useRef({ isSpeaking, isListening, isThinking });
  stateRef.current = { isSpeaking, isListening, isThinking };

  // ── Scene ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    // Framed on the upper body. A VRoid character is roughly 1.5 units tall
    // with the head near 1.35, so aiming at the origin frames her feet.
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    camera.position.set(0, 1.28, 1.55);
    camera.lookAt(0, 1.24, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.15;
    // Explicit CSS size, because setSize is told below not to write style. A
    // canvas with no CSS size is laid out from its width/height attributes -
    // which are the drawing buffer, set from this element's height - and the
    // two then grow each other without limit.
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    mount.appendChild(renderer.domElement);

    // Soft key/fill/rim. VRM materials are unlit-ish by design, so this is
    // about shaping the hair and shoulders rather than lighting skin.
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.2, 2.2, 1.8);
    const rim = new THREE.DirectionalLight(0x88bbff, 1.1);
    rim.position.set(-1.6, 1.4, -1.5);
    scene.add(key, rim);

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
      scene, camera, renderer, vrm: null,
      clock: new THREE.Clock(), frameId: 0,
    };

    return () => {
      observer.disconnect();
      cancelAnimationFrame(sceneRef.current.frameId);
      const { vrm } = sceneRef.current;
      if (vrm) {
        scene.remove(vrm.scene);
        // The library's own teardown: a VRM holds skinned meshes, spring bone
        // colliders and textures that a plain traverse-and-dispose misses.
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = {};
    };
  }, []);

  // ── Load the model ───────────────────────────────────────────────────────
  useEffect(() => {
    const handles = sceneRef.current;
    if (!handles.scene) return undefined;
    if (!file) { setStatus('idle'); return undefined; }

    let disposed = false;
    setStatus('loading');
    setError('');

    if (handles.vrm) {
      handles.scene.remove(handles.vrm.scene);
      VRMUtils.deepDispose(handles.vrm.scene);
      handles.vrm = null;
    }

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      file,
      (gltf) => {
        const vrm = gltf.userData.vrm;
        if (disposed) { VRMUtils.deepDispose(gltf.scene); return; }
        if (!vrm) {
          setStatus('error');
          setError('That file loaded, but it is not a VRM character.');
          return;
        }
        // A VRM 0.x model faces away from the camera; 1.0 faces towards it.
        // This turns the older ones round rather than leaving the character
        // with her back to the person talking to her.
        VRMUtils.rotateVRM0(vrm);
        // Both are recommended by the library for anything that is not being
        // edited: they cut draw calls noticeably on a phone.
        VRMUtils.removeUnnecessaryVertices(vrm.scene);
        VRMUtils.combineSkeletons(vrm.scene);
        vrm.scene.traverse((object) => { object.frustumCulled = false; });

        handles.scene.add(vrm.scene);
        handles.vrm = vrm;
        setStatus('ready');
      },
      undefined,
      (loadError) => {
        if (disposed) return;
        setStatus('error');
        setError(loadError?.message || 'That character could not be loaded.');
      },
    );

    return () => { disposed = true; };
  }, [file]);

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
    const calm = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let blinkIn = 1.5 + Math.random() * 3;
    let blink = 0;
    let viseme = 0;
    let visemeTimer = 0;
    let lean = 0;
    let tilt = 0;
    let gaze = { x: 0, y: 0, nextIn: 1.2 };

    const animate = () => {
      handles.frameId = requestAnimationFrame(animate);
      const delta = Math.min(handles.clock.getDelta(), 0.05);
      const t = handles.clock.getElapsedTime();
      const { vrm } = handles;
      const { isSpeaking: speaking, isListening: listening, isThinking: thinking } = stateRef.current;

      if (vrm) {
        const expr = vrm.expressionManager;

        // How loud the reply is decides how far the mouth opens. Without an
        // audio node - a native Android engine never exposes one - fall back
        // to a plausible rhythm so she is not silent-faced while talking.
        let target = 0;
        if (analyserRef.current && speaking) {
          analyserRef.current.getByteFrequencyData(levels);
          let sum = 0;
          for (let i = 0; i < levels.length; i += 1) sum += levels[i];
          target = Math.min(1, (sum / levels.length) / 62);
        } else if (speaking) {
          target = 0.45 + Math.sin(t * 10.5) * 0.3;
        }
        loudnessRef.current = approach(loudnessRef.current, Math.max(0, target), 15, delta);

        if (expr) {
          // Cycle visemes so speech is not one held vowel.
          visemeTimer += delta;
          if (visemeTimer > 0.11) {
            visemeTimer = 0;
            viseme = (viseme + 1 + Math.floor(Math.random() * 2)) % VISEMES.length;
          }
          VISEMES.forEach((name, index) => {
            expr.setValue(name, index === viseme ? loudnessRef.current * 0.85 : 0);
          });

          blinkIn -= delta;
          if (blinkIn <= 0) { blink = 1; blinkIn = 1.8 + Math.random() * 4; }
          blink = approach(blink, 0, 9, delta);
          expr.setValue('blink', Math.sin(Math.min(1, blink) * Math.PI));

          // Mood, kept gentle. A full-strength expression on a VRoid face
          // looks like a caricature; a quarter of one reads as an attitude.
          expr.setValue('happy', approach(expr.getValue('happy') || 0,
            listening ? 0.25 : 0.12, 3, delta));
          expr.setValue('relaxed', approach(expr.getValue('relaxed') || 0,
            thinking ? 0.3 : 0, 3, delta));
        }

        // Where she is looking, and a little life in the neck and spine.
        gaze.nextIn -= delta;
        if (gaze.nextIn <= 0) {
          gaze = {
            x: (Math.random() - 0.5) * 0.3,
            y: (Math.random() - 0.5) * 0.16,
            nextIn: 1 + Math.random() * 2.5,
          };
        }
        lean = approach(lean, listening ? 0.09 : 0, 3.5, delta);
        tilt = approach(tilt, thinking ? 0.14 : 0, 3, delta);

        const head = vrm.humanoid?.getNormalizedBoneNode('head');
        const spine = vrm.humanoid?.getNormalizedBoneNode('spine');
        const breath = calm ? 0 : Math.sin(t * 1.2) * 0.012;
        if (head) {
          head.rotation.y = approach(head.rotation.y, gaze.x, 3, delta);
          head.rotation.x = approach(head.rotation.x, -gaze.y + tilt * 0.3, 3, delta);
          head.rotation.z = approach(head.rotation.z, tilt, 3, delta);
        }
        if (spine) {
          spine.rotation.x = approach(spine.rotation.x, lean + breath, 3, delta);
        }

        // Drives spring bones (hair, skirt) and the look-at rig. Without this
        // the hair is welded in place and the whole figure reads as a statue.
        vrm.update(delta);
      }

      handles.renderer.render(handles.scene, handles.camera);
    };

    animate();
    return () => cancelAnimationFrame(handles.frameId);
  }, []);

  return (
    <div ref={mountRef} className={`relative w-full h-full overflow-hidden ${className}`}>
      {status === 'loading' && (
        <p className="absolute inset-0 flex items-center justify-center text-xs font-mono text-emerald-300/70">
          Loading character…
        </p>
      )}
      {status === 'error' && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-xs font-mono text-amber-300/80">
          {error}
        </p>
      )}
    </div>
  );
};

export default AvatarVRM;
