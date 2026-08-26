import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { MMDLoader } from 'three/examples/jsm/loaders/MMDLoader.js';

/**
 * Anime character rendered from an MMD (PMX) model.
 *
 * PMX carries the pieces a talking character needs — vowel mouth morphs
 * (あ/い/う/え/お), blink morphs, expression morphs and a full skeleton — so the
 * face can actually move rather than sitting still.
 *
 * The mouth is driven by the assistant's own audio, so the lips follow whatever
 * is really being said.
 */

export const MMD_CHARACTERS = [
  { id: 'evelyn', name: 'Myraa', gender: 'female', file: '/characters/evelyn/model.pmx' },
];

/**
 * MMD morph names are Japanese. Several spellings exist in the wild, so each
 * slot lists the candidates and whichever the model actually has is used.
 */
const MORPH_CANDIDATES = {
  a: ['あ', 'a', 'A'],
  i: ['い', 'i', 'I'],
  u: ['う', 'u', 'U'],
  e: ['え', 'e', 'E'],
  o: ['お', 'o', 'O'],
  blink: ['まばたき', 'blink', 'Blink'],
  smile: ['笑い', 'にこり', 'smile', 'Smile', '喜び'],
  // The model carries a full expression set; using only blink and smile
  // left the face doing almost nothing while she talked.
  mouthUp: ['口角上げ', '口角上げ左', 'mouth_up'],
  mouthDown: ['口角下げ', '口角下げ左'],
  surprise: ['びっくり右', 'びっくり左', 'surprised'],
  narrow: ['じと目', 'narrow'],
  sad: ['悲しむ', 'sad', '困る'],
  browUp: ['眉上', '上', 'brow_up'],
  wink: ['ウィンク', 'ウィンク右'],
};

/**
 * Expression presets, blended toward as the conversation changes. Each is a
 * mix rather than a single morph, because one morph at full strength reads
 * as a mask.
 */
const EXPRESSIONS = {
  idle:      { smile: 0.18, mouthUp: 0.12, narrow: 0.00, surprise: 0.00, sad: 0.00 },
  listening: { smile: 0.30, mouthUp: 0.24, narrow: 0.00, surprise: 0.08, sad: 0.00 },
  thinking:  { smile: 0.06, mouthUp: 0.00, narrow: 0.34, surprise: 0.00, sad: 0.06 },
  speaking:  { smile: 0.34, mouthUp: 0.28, narrow: 0.00, surprise: 0.05, sad: 0.00 },
  delighted: { smile: 0.72, mouthUp: 0.55, narrow: 0.10, surprise: 0.22, sad: 0.00 },
};
const EXPRESSION_KEYS = ['smile', 'mouthUp', 'narrow', 'surprise', 'sad'];

const VOWELS = ['a', 'i', 'u', 'e', 'o'];

/**
 * Idle-motion model.
 *
 * Plain sine waves read as mechanical, because a standing person does not
 * oscillate: they breathe asymmetrically, drift on noise, and periodically
 * shift their weight from one leg to the other. These three behaviours layered
 * together are what makes a character look alive while doing nothing.
 */

/** Deterministic 1-D value noise, so micro-motion never repeats visibly. */
const noiseAt = (i) => {
  const x = Math.sin(i * 127.1) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};
const smoothNoise = (t) => {
  const i = Math.floor(t);
  const f = t - i;
  const eased = f * f * (3 - 2 * f);
  return noiseAt(i) * (1 - eased) + noiseAt(i + 1) * eased;
};
/** Two octaves is enough to look organic without looking jittery. */
const fractalNoise = (t, octaves = 2) => {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let n = 0; n < octaves; n += 1) {
    sum += smoothNoise(t * frequency) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    frequency *= 2.07;
  }
  return total > 0 ? sum / total : 0;
};

/** Breath: inhale over the first 38% of the cycle, exhale slower over the rest. */
const breathCurve = (phase) => {
  const t = phase - Math.floor(phase);
  const inhale = 0.38;
  if (t < inhale) {
    const p = t / inhale;
    return p * p * (3 - 2 * p);
  }
  const p = (t - inhale) / (1 - inhale);
  return 1 - (p * p * (3 - 2 * p)) ** 0.85;
};

const smoothstep01 = (v) => {
  const t = Math.min(1, Math.max(0, v));
  return t * t * (3 - 2 * t);
};

/** Rotation/offset amplitudes, in radians and model units. */
const MOTION = {
  breathChest: 0.0135,
  breathUpperChest: 0.009,
  breathNeckCounter: 0.0055,
  breathShoulder: 0.011,
  swayHipRoll: 0.019,
  swayHipYaw: 0.011,
  swayChestCounter: 0.012,
  postureHipRoll: 0.028,
  postureChestRoll: 0.017,
  postureHeadRoll: 0.021,
  microHead: 0.016,
  microShoulder: 0.008,
};

const AvatarMMD = ({
  characterId = 'evelyn',
  /** Audio node carrying the assistant's speech. */
  speechSource = null,
  speechContext = null,
  isSpeaking = false,
  isListening = false,
  isThinking = false,
  className = '',
}) => {
  const mountRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const sceneRef = useRef({
    renderer: null, scene: null, camera: null, clock: null,
    mesh: null, morphs: {}, bones: {}, frameId: null, refit: null,
  });
  const analyserRef = useRef(null);
  const loudnessRef = useRef(0);
  // Where the camera sits around the character, and whether the eyes follow
  // the pointer. Kept in refs because the render loop reads them every frame.
  const orbitRef = useRef({ yaw: 0, pitch: 0, distanceScale: 1 });
  const pointerRef = useRef({ x: 0, y: 0 });
  const [viewLocked, setViewLocked] = useState(true);
  const [eyesTracking, setEyesTracking] = useState(true);
  const eyesTrackingRef = useRef(true);
  const stateRef = useRef({ isSpeaking, isListening, isThinking });

  useEffect(() => {
    stateRef.current = { isSpeaking, isListening, isThinking };
  }, [isSpeaking, isListening, isThinking]);

  useEffect(() => { eyesTrackingRef.current = eyesTracking; }, [eyesTracking]);

  // ── Scene ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Without tone mapping the toon shading came out grey and washed out.
    // Neutral keeps the flat anime colour intact while the exposure lift
    // gives the character the brightness it is drawn to have.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.35;
    mount.appendChild(renderer.domElement);

    // MMD toon materials want generous, shaped light rather than a PBR rig.
    // The rim light matters most: it traces the silhouette and lifts the
    // character off a dark background instead of letting it sink in.
    const key = new THREE.DirectionalLight(0xfff4ec, 1.65);
    key.position.set(0.7, 1.5, 1.8);
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7);
    fill.position.set(-1.5, 0.7, 0.9);
    const rim = new THREE.DirectionalLight(0xffd9e6, 1.5);
    rim.position.set(-0.6, 1.2, -2.2);
    const bounce = new THREE.DirectionalLight(0x9fc6ff, 0.35);
    bounce.position.set(0, -1.5, 0.8);
    scene.add(key, fill, rim, bounce, new THREE.AmbientLight(0xffffff, 0.95));

    Object.assign(sceneRef.current, { renderer, scene, camera, clock: new THREE.Clock() });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;

      const handles = sceneRef.current;
      if (handles.framedHeight) {
        // Fill the panel at any shape, so the character never floats in empty
        // space on a wide layout.
        const fov = (camera.fov * Math.PI) / 180;
        const byHeight = (handles.framedHeight / 2) / Math.tan(fov / 2);
        const byWidth = (handles.framedHeight * 0.42 / 2) / (Math.tan(fov / 2) * camera.aspect);
        const radius = Math.max(byHeight, byWidth) * orbitRef.current.distanceScale;
        const { yaw, pitch } = orbitRef.current;
        camera.position.set(
          Math.sin(yaw) * Math.cos(pitch) * radius,
          handles.aimHeight + Math.sin(pitch) * radius,
          Math.cos(yaw) * Math.cos(pitch) * radius,
        );
        camera.lookAt(0, handles.aimHeight, 0);
      }
      camera.updateProjectionMatrix();
    };
    sceneRef.current.refit = resize;
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(mount);

    return () => {
      observer.disconnect();
      const handles = sceneRef.current;
      if (handles.frameId) cancelAnimationFrame(handles.frameId);
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, []);

  // ── Load the character ─────────────────────────────────────────────────
  useEffect(() => {
    const handles = sceneRef.current;
    if (!handles.scene) return undefined;

    const chosen = MMD_CHARACTERS.find((c) => c.id === characterId) || MMD_CHARACTERS[0];
    let disposed = false;
    setStatus('loading');
    setError('');

    if (handles.mesh) {
      handles.scene.remove(handles.mesh);
      handles.mesh = null;
    }

    // Textures sit beside the model under the exact names the PMX asks for,
    // in their original formats, so the loader resolves them on its own.
    new MMDLoader().load(
      chosen.file,
      (mesh) => {
        if (disposed) return;
        mesh.frustumCulled = false;
        handles.scene.add(mesh);
        handles.mesh = mesh;

        // Resolve the morph names this particular model actually ships with.
        const dictionary = mesh.morphTargetDictionary || {};
        handles.morphs = {};
        Object.entries(MORPH_CANDIDATES).forEach(([slot, names]) => {
          const found = names.find((name) => name in dictionary);
          if (found !== undefined) handles.morphs[slot] = dictionary[found];
        });

        handles.bones = {};
        const pick = (key, pattern) => (bone) => {
          if (handles.bones[key] === undefined && pattern.test(bone.name)) handles.bones[key] = bone;
        };
        const matchers = [
          pick('head', /^頭$|head/i),
          pick('chest', /^上半身$|upper ?body/i),
          pick('armL', /^左腕$|left ?arm/i),
          pick('armR', /^右腕$|right ?arm/i),
          pick('elbowL', /^左ひじ$|left ?elbow/i),
          pick('elbowR', /^右ひじ$|right ?elbow/i),
          // Needed for breathing and weight shifts: without a neck, hips and
          // shoulders the whole body can only rotate as one rigid piece.
          pick('neck', /^首$|^neck$/i),
          pick('upperChest', /^上半身2$|upper ?body ?2/i),
          pick('hips', /^下半身$|lower ?body/i),
          pick('shoulderL', /^左肩$|left ?shoulder/i),
          pick('shoulderR', /^右肩$|right ?shoulder/i),
        ];
        mesh.skeleton?.bones?.forEach((bone) => matchers.forEach((m) => m(bone)));

        // MMD models are authored in a T/A pose. Bring the arms down so she is
        // standing naturally before any animation is applied.
        if (handles.bones.armL) handles.bones.armL.rotation.z = -0.62;
        if (handles.bones.armR) handles.bones.armR.rotation.z = 0.62;
        if (handles.bones.elbowL) handles.bones.elbowL.rotation.z = -0.20;
        if (handles.bones.elbowR) handles.bones.elbowR.rotation.z = 0.20;
        mesh.skeleton?.update?.();

        // Frame the upper body from the model's own size, then centre it.
        const bounds = new THREE.Box3().setFromObject(mesh);
        const size = new THREE.Vector3();
        const centre = new THREE.Vector3();
        bounds.getSize(size);
        bounds.getCenter(centre);
        // Centre on the spine, not on the bounding box. Three.js measures a
        // skinned mesh from its rest pose, so the box takes in the cape, which
        // hangs to one side and dragged the "centre" with it — she rendered
        // about 12% right of the panel centre while every DOM element around
        // her was centred correctly. A bone sits on the body's own axis and
        // no accessory can move it.
        const spine = handles.bones.upperChest || handles.bones.chest || handles.bones.hips;
        let spineY = null;
        if (spine) {
          spine.updateWorldMatrix(true, false);
          const axis = new THREE.Vector3().setFromMatrixPosition(spine.matrixWorld);
          mesh.position.x -= axis.x;
          mesh.position.z -= axis.z;
          spineY = axis.y;
        } else {
          mesh.position.x -= centre.x;
          mesh.position.z -= centre.z;
        }

        bounds.copy(new THREE.Box3().setFromObject(mesh));
        bounds.getSize(size);

        // Framing read out of MYRAA's own bundle rather than chosen by eye:
        //   { targetBone: 上半身2, targetOffset: 1.2, distance: 22, fov: 30 }
        // and it drives this same evelyn model, so the numbers transfer
        // literally. At fov 30 a distance of 22 shows 2 * 22 * tan(15°) =
        // 11.79 units; expressed against the measured 21.62-unit height that
        // is 0.545, kept as a fraction so a model built at another scale
        // still frames correctly.
        //
        // The old 0.88 framed head-to-knees and stood the camera 24 units
        // back — a third further than MYRAA — which is why the face read as
        // small and distant.
        handles.framedHeight = size.y * 0.545;
        // Aim at the bone, not at the top of the bounding box. The box takes
        // in hair and accessories that sit above the visible crown, so
        // measuring down from it left more headroom than intended.
        handles.aimHeight = spineY !== null
          ? spineY + 1.2
          : bounds.max.y - handles.framedHeight * 0.403;
        handles.refit?.();

        // One more frame before revealing: the loader resolves when the
        // mesh is built, which is a beat before every texture has been
        // uploaded, and that beat is the bald-looking flash.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (!disposed) setStatus('ready');
        }));
      },
      undefined,
      (loadError) => {
        if (disposed) return;
        setError(`Character could not be loaded: ${loadError?.message || 'unknown error'}`);
        setStatus('error');
      },
    );

    return () => { disposed = true; };
  }, [characterId]);

  // ── View controls ──────────────────────────────────────────────────────
  const VIEWS = { 1: 0, 2: Math.PI / 4, 3: Math.PI / 2, 4: Math.PI };

  const resetView = () => {
    orbitRef.current = { yaw: 0, pitch: 0, distanceScale: 1 };
    sceneRef.current.refit?.();
  };

  const setView = (index) => {
    orbitRef.current.yaw = VIEWS[index] ?? 0;
    orbitRef.current.pitch = 0;
    sceneRef.current.refit?.();
  };

  useEffect(() => {
    const onKey = (event) => {
      // Never hijack keys while the user is typing a message.
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      const orbit = orbitRef.current;
      const step = 0.12;
      let handled = true;
      switch (event.key.toLowerCase()) {
        case 'a': orbit.yaw -= step; break;
        case 'd': orbit.yaw += step; break;
        case 'w': orbit.pitch = Math.min(0.6, orbit.pitch + step * 0.6); break;
        case 's': orbit.pitch = Math.max(-0.4, orbit.pitch - step * 0.6); break;
        case 'q': orbit.distanceScale = Math.max(0.45, orbit.distanceScale - 0.08); break;
        case 'e': orbit.distanceScale = Math.min(2.2, orbit.distanceScale + 0.08); break;
        case 'l': setViewLocked((value) => !value); break;
        case 'f': setEyesTracking((value) => !value); break;
        case 'r': resetView(); break;
        case '1': case '2': case '3': case '4': setView(Number(event.key)); break;
        default: handled = false;
      }
      if (handled) {
        event.preventDefault();
        sceneRef.current.refit?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Drag to orbit, wheel to zoom — only when the view is unlocked.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e) => { if (!viewLocked) { dragging = true; lastX = e.clientX; lastY = e.clientY; } };
    const onUp = () => { dragging = false; };
    const onMove = (e) => {
      const rect = mount.getBoundingClientRect();
      pointerRef.current = {
        x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
        y: ((e.clientY - rect.top) / rect.height) * 2 - 1,
      };
      if (!dragging) return;
      const orbit = orbitRef.current;
      orbit.yaw += (e.clientX - lastX) * 0.006;
      orbit.pitch = Math.max(-0.4, Math.min(0.6, orbit.pitch - (e.clientY - lastY) * 0.004));
      lastX = e.clientX;
      lastY = e.clientY;
      sceneRef.current.refit?.();
    };
    const onWheel = (e) => {
      if (viewLocked) return;
      e.preventDefault();
      const orbit = orbitRef.current;
      orbit.distanceScale = Math.max(0.45, Math.min(2.2, orbit.distanceScale + Math.sign(e.deltaY) * 0.08));
      sceneRef.current.refit?.();
    };

    mount.addEventListener('pointerdown', onDown);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointermove', onMove);
    mount.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      mount.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointermove', onMove);
      mount.removeEventListener('wheel', onWheel);
    };
  }, [viewLocked]);

  // ── Listen to the assistant's voice ────────────────────────────────────
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

  // ── Animation ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handles = sceneRef.current;
    if (!handles.renderer) return undefined;

    const levels = new Uint8Array(128);
    let blinkIn = 2 + Math.random() * 3;
    let vowel = 0;
    let vowelTimer = 0;

    // Persistent idle-motion state: breath phase, current energy, and the
    // weight shift currently in progress.
    // Current blended expression, and the gesture currently playing.
    const expression = { smile: 0, mouthUp: 0, narrow: 0, surprise: 0, sad: 0 };
    const gesture = { weight: 0, timer: 0, next: 1.5, shape: 0, side: 1 };

    const idle = {
      energy: 0.34,
      breathPhase: Math.random(),
      postureTimer: 0,
      postureNext: 4 + Math.random() * 5,
      posture: { active: false, weight: 0, roll: 0, yaw: 0, elapsed: 0, duration: 0 },
    };

    const setMorph = (slot, value) => {
      const index = handles.morphs[slot];
      if (index === undefined || !handles.mesh?.morphTargetInfluences) return;
      handles.mesh.morphTargetInfluences[index] = value;
    };

    const animate = () => {
      handles.frameId = requestAnimationFrame(animate);
      const delta = handles.clock.getDelta();
      const time = handles.clock.getElapsedTime();
      const { isSpeaking: speaking, isListening: listening, isThinking: thinking } = stateRef.current;

      if (handles.mesh) {
        // How loud the reply is right now decides how far the mouth opens.
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(levels);
          let sum = 0;
          for (let i = 0; i < levels.length; i += 1) sum += levels[i];
          const target = speaking ? Math.min(1, (sum / levels.length) / 68) : 0;
          loudnessRef.current += (target - loudnessRef.current) * Math.min(1, delta * 14);
        } else {
          const target = speaking ? 0.5 + Math.sin(time * 10) * 0.25 : 0;
          loudnessRef.current += (target - loudnessRef.current) * Math.min(1, delta * 12);
        }

        // Cycle vowels so speech does not hold a single shape.
        vowelTimer += delta;
        if (vowelTimer > 0.12) {
          vowelTimer = 0;
          vowel = (vowel + 1 + Math.floor(Math.random() * 2)) % VOWELS.length;
        }
        VOWELS.forEach((slot, index) => {
          setMorph(slot, index === vowel ? loudnessRef.current : 0);
        });

        // ── Expression ──
        // A single smile morph held at a fixed value read as a mask. The
        // face now blends toward a preset chosen by what she is doing, and
        // brightens on the loud parts of her own speech so emphasis lands
        // on the face as well as in the voice.
        const loud = loudnessRef.current;
        let preset = EXPRESSIONS.idle;
        if (speaking) preset = loud > 0.55 ? EXPRESSIONS.delighted : EXPRESSIONS.speaking;
        else if (thinking) preset = EXPRESSIONS.thinking;
        else if (listening) preset = EXPRESSIONS.listening;

        EXPRESSION_KEYS.forEach((slot) => {
          const target = preset[slot] || 0;
          const current = expression[slot] || 0;
          // Ease rather than snap: a face that changes instantly looks wrong.
          expression[slot] = current + (target - current) * Math.min(1, delta * 4.5);
          setMorph(slot, expression[slot]);
        });

        blinkIn -= delta;
        if (blinkIn <= 0) {
          setMorph('blink', Math.max(0, Math.sin((0.18 + blinkIn) * Math.PI * 5.5)));
          if (blinkIn < -0.18) blinkIn = 2.5 + Math.random() * 3.5;
        } else {
          setMorph('blink', 0);
        }

        // ── Idle life ────────────────────────────────────────────────────
        // Energy ramps rather than jumping, so she settles after speaking
        // instead of snapping back to a resting pose.
        const energyTarget = speaking ? 1 : thinking ? 0.62 : 0.34;
        idle.energy += (energyTarget - idle.energy) * Math.min(1, delta * 2.2);
        const energy = idle.energy;

        // Breathing speeds up a little while she is talking.
        idle.breathPhase += delta * (speaking ? 0.30 : 0.22);
        const breath = breathCurve(idle.breathPhase);
        // Centred on zero so the chest rises and falls around its rest pose.
        const breathSigned = breath - 0.5;

        // Weight shifts: stand on one leg for a while, then change over.
        idle.postureTimer += delta;
        if (!idle.posture.active && idle.postureTimer >= idle.postureNext) {
          idle.posture = {
            active: true,
            elapsed: 0,
            duration: 3.2 + Math.random() * 2.6,
            roll: (Math.random() * 2 - 1),
            yaw: (Math.random() * 2 - 1) * 0.6,
          };
        }
        if (idle.posture.active) {
          idle.posture.elapsed += delta;
          const t = idle.posture.elapsed / idle.posture.duration;
          // Ease in, hold, ease out — a shift, not a wobble.
          idle.posture.weight = t < 0.5 ? smoothstep01(t * 2) : smoothstep01((1 - t) * 2);
          if (t >= 1) {
            idle.posture = { active: false, weight: 0, roll: 0, yaw: 0, elapsed: 0, duration: 0 };
            idle.postureTimer = 0;
            idle.postureNext = 5 + Math.random() * 7;
          }
        }
        const postureWeight = (idle.posture.weight || 0) * energy;
        const postureRoll = (idle.posture.roll || 0) * postureWeight;
        const postureYaw = (idle.posture.yaw || 0) * postureWeight;

        // Slow lateral sway, independent of breath so the two never lock up.
        const swayPhase = Math.sin(time * 0.27);

        const bones = handles.bones;

        if (bones.hips) {
          bones.hips.rotation.z = swayPhase * MOTION.swayHipRoll * energy
            + postureRoll * MOTION.postureHipRoll;
          bones.hips.rotation.y = fractalNoise(time * 0.11) * MOTION.swayHipYaw * energy
            + postureYaw * MOTION.postureHipRoll;
        }

        if (bones.chest) {
          bones.chest.rotation.x = breathSigned * MOTION.breathChest;
          // Counter-rotate against the hips: the torso stays upright while the
          // weight moves, which is what reads as balance.
          bones.chest.rotation.z = -swayPhase * MOTION.swayChestCounter * energy
            - postureRoll * MOTION.postureChestRoll;
        }
        if (bones.upperChest) {
          bones.upperChest.rotation.x = breathSigned * MOTION.breathUpperChest;
        }
        if (bones.neck) {
          // The neck absorbs part of the chest's rise so the head stays level.
          bones.neck.rotation.x = -breathSigned * MOTION.breathNeckCounter;
        }

        const shoulderLift = breathSigned * MOTION.breathShoulder;
        const shoulderNoise = fractalNoise(time * 0.23 + 11) * MOTION.microShoulder * energy;
        if (bones.shoulderL) bones.shoulderL.rotation.z = -shoulderLift + shoulderNoise;
        if (bones.shoulderR) bones.shoulderR.rotation.z = shoulderLift - shoulderNoise;

        if (bones.head) {
          // Micro-motion on noise rather than a sine: a real head never traces
          // the same arc twice.
          const microYaw = fractalNoise(time * 0.19) * MOTION.microHead * 6 * energy;
          const microPitch = fractalNoise(time * 0.16 + 31) * MOTION.microHead * 3.4 * energy;
          const headRoll = -postureRoll * MOTION.postureHeadRoll
            + fractalNoise(time * 0.13 + 57) * MOTION.microHead * 1.6 * energy;

          if (eyesTrackingRef.current) {
            // Turn toward the pointer, so she appears to look at you.
            const { x, y } = pointerRef.current;
            bones.head.rotation.y = microYaw * 0.4 + x * 0.35;
            bones.head.rotation.x = microPitch * 0.4 + y * 0.20 - breathSigned * 0.004;
          } else {
            bones.head.rotation.y = microYaw;
            bones.head.rotation.x = microPitch - breathSigned * 0.004;
          }
          bones.head.rotation.z = headRoll;
        }

        // Arms hang and drift; they gesture more while she is talking.
        // ── Gesture ──
        // Arms hung still while she talked, which is the main reason she
        // looked inert. While speaking they lift and move on the rhythm of
        // her own voice, and a new gesture shape is picked every few
        // seconds so the motion does not cycle visibly.
        gesture.timer += delta;
        if (speaking && gesture.timer > gesture.next) {
          gesture.timer = 0;
          gesture.next = 2.2 + Math.random() * 3.4;
          gesture.shape = Math.floor(Math.random() * 3);
          gesture.side = Math.random() < 0.5 ? -1 : 1;
        }
        // Ease the whole gesture layer in and out with speech.
        gesture.weight += ((speaking ? 1 : 0) - gesture.weight) * Math.min(1, delta * 2.6);
        const gw = gesture.weight;
        const beat = loud * gw;

        const armDrift = 0.03 + energy * 0.06;
        const armPhase = fractalNoise(time * 0.21 + 3);
        const armPhaseB = fractalNoise(time * 0.21 + 71);
        let liftL = 0;
        let liftR = 0;
        let openL = 0;
        let openR = 0;
        if (gesture.shape === 0) {          // both hands open outward
          liftL = 0.30; liftR = 0.30; openL = 0.16; openR = 0.16;
        } else if (gesture.shape === 1) {   // one hand leads
          if (gesture.side < 0) { liftL = 0.46; openL = 0.22; liftR = 0.08; }
          else { liftR = 0.46; openR = 0.22; liftL = 0.08; }
        } else {                            // small contained beats
          liftL = 0.16; liftR = 0.16; openL = 0.06; openR = 0.06;
        }
        // The beat rides on top, so the arms punctuate loud syllables.
        const pulse = Math.sin(time * 5.2) * 0.06 * beat;

        if (bones.armL) {
          bones.armL.rotation.z = -0.62 - (armPhase * 0.5 + 0.5) * armDrift + (liftL + pulse) * gw;
          bones.armL.rotation.x = -openL * gw;
        }
        if (bones.armR) {
          bones.armR.rotation.z = 0.62 + (armPhaseB * 0.5 + 0.5) * armDrift - (liftR + pulse) * gw;
          bones.armR.rotation.x = -openR * gw;
        }
        // Elbows bend with the lift, otherwise the arms swing as stiff poles.
        if (bones.elbowL) bones.elbowL.rotation.z = -0.20 - Math.abs(armPhase) * armDrift * 0.8 - liftL * gw * 0.8;
        if (bones.elbowR) bones.elbowR.rotation.z = 0.20 + Math.abs(armPhaseB) * armDrift * 0.8 + liftR * gw * 0.8;
      }

      handles.renderer.render(handles.scene, handles.camera);
    };

    animate();
    return () => {
      if (handles.frameId) cancelAnimationFrame(handles.frameId);
    };
  }, []);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      {/* Backdrop, then a warm pool of light behind the character. The flat
          gradient alone left her sitting on the background rather than
          standing in front of it. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_28%,rgba(32,42,78,0.85),rgba(4,6,12,0.99))]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(38% 44% at 50% 42%, rgba(150,180,255,.20), transparent 70%),' +
            'radial-gradient(26% 30% at 50% 76%, rgba(255,170,200,.14), transparent 72%)',
        }}
        aria-hidden="true"
      />
      {/* Textures stream in after the mesh, so an unhidden canvas showed an
          untextured figure first. It fades in once she is actually dressed. */}
      <div
        ref={mountRef}
        className="relative w-full h-full transition-opacity duration-700"
        style={{ opacity: status === 'ready' ? 1 : 0 }}
      />
      {/* View controls */}
      {status === 'ready' && (
        <div className="absolute bottom-2 right-2 flex flex-col items-end gap-1 font-mono text-[9px] select-none">
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setViewLocked((v) => !v)}
              className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                viewLocked ? 'border-amber-400/60 text-amber-300 bg-amber-500/10' : 'border-white/15 text-white/50 hover:text-white'
              }`}
            >
              {viewLocked ? 'VIEW LOCKED' : 'VIEW FREE'}
            </button>
            <button
              type="button"
              onClick={() => setEyesTracking((v) => !v)}
              className={`px-2 py-1 rounded border transition-colors cursor-pointer ${
                eyesTracking ? 'border-cyan-400/60 text-cyan-300 bg-cyan-500/10' : 'border-white/15 text-white/50 hover:text-white'
              }`}
            >
              EYES TRACKING
            </button>
          </div>
          <div className="flex gap-1">
            {[['FRONT', 1], ['¾', 2], ['SIDE', 3], ['BACK', 4]].map(([label, index]) => (
              <button
                key={label}
                type="button"
                onClick={() => setView(index)}
                className="px-2 py-1 rounded border border-white/12 text-white/45 hover:text-white hover:border-white/30 transition-colors cursor-pointer"
              >
                {label}
              </button>
            ))}
          </div>
          <span className="text-white/25 pr-1">
            WASD rotate · Q/E zoom · L lock · F eyes · R reset · 1-4 views
          </span>
        </div>
      )}

      {status === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="font-mono text-[10px] uppercase tracking-widest text-emerald-400/70 animate-pulse">
            Loading character…
          </span>
        </div>
      )}
      {status === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center px-4 text-center">
          <span className="font-mono text-[10px] text-rose-400/90">{error}</span>
        </div>
      )}
    </div>
  );
};

export default AvatarMMD;
