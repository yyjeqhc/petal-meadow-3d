import './style.css';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createTerrain, createGrass, createFlowerField } from './world.js';
import { createAtmosphere } from './atmosphere.js';
import { createPetalFlock } from './player.js';

const app = document.querySelector('#app');
const weatherEl = document.querySelector('#weather');
const speedEl = document.querySelector('#speed');
const flowersEl = document.querySelector('#flowers');
const introEl = document.querySelector('#intro');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.35));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 360);
camera.position.set(5, 6, 9);

const hemi = new THREE.HemisphereLight('#d8f0ee', '#46613b', 1.55);
scene.add(hemi);

const sun = new THREE.DirectionalLight('#fff1cf', 3.1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -34;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.camera.near = 2;
sun.shadow.camera.far = 120;
sun.shadow.bias = -0.00012;
sun.target.position.set(0, 0, 0);
scene.add(sun, sun.target);

const terrainSystem = createTerrain(scene);
const grassSystem = createGrass(scene);
const flowerField = createFlowerField(scene);
const atmosphere = createAtmosphere(scene);
const player = createPetalFlock(scene);

flowerField.spawnPatch(0, 0, 11);
flowerField.spawnPatch(2.5, -1.8, 7);
flowerField.spawnPatch(-2.8, 1.6, 6);

const renderPass = new RenderPass(scene, camera);
const bokehPass = new BokehPass(scene, camera, {
  focus: 6.0,
  aperture: 0.000015,
  maxblur: 0.0,
  width: window.innerWidth,
  height: window.innerHeight,
});

const cinematicPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    uSaturation: { value: 1.06 },
    uContrast: { value: 1.035 },
    uWarmth: { value: 0.04 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uWarmth;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      c += vec3(0.035, 0.012, -0.018) * uWarmth;
      float edge = smoothstep(0.95, 0.32, distance(vUv, vec2(0.5)));
      c *= mix(0.90, 1.0, edge);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
});
const outputPass = new OutputPass();

const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bokehPass);
composer.addPass(cinematicPass);
composer.addPass(outputPass);

const input = {
  forward: false,
  back: false,
  left: false,
  right: false,
  boost: false,
};

const keyMap = {
  KeyW: 'forward', ArrowUp: 'forward',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'boost', ShiftRight: 'boost',
};

let started = false;
function begin() {
  if (started) return;
  started = true;
  introEl?.classList.add('hidden');
}

window.addEventListener('keydown', (event) => {
  const action = keyMap[event.code];
  if (action) {
    input[action] = true;
    begin();
    event.preventDefault();
  }
  if (event.code === 'KeyT' && !event.repeat) cycleWeather();
});
window.addEventListener('keyup', (event) => {
  const action = keyMap[event.code];
  if (action) {
    input[action] = false;
    event.preventDefault();
  }
});
window.addEventListener('blur', () => Object.keys(input).forEach((key) => { input[key] = false; }));

const weatherStates = [
  {
    name: '晴岚', cloud: 0.28, density: 0.62, darkness: 0.10, wind: 0.52,
    fog: 0.0115, groundFog: 0.15, rain: 0, sun: 3.2, hemi: 1.55,
    exposure: 1.10, warmth: 0.05, shadow: 0.24, fogColor: '#a7cbbb', sunColor: '#fff1cf',
  },
  {
    name: '风起', cloud: 0.42, density: 0.74, darkness: 0.16, wind: 0.95,
    fog: 0.013, groundFog: 0.19, rain: 0, sun: 2.75, hemi: 1.45,
    exposure: 1.06, warmth: 0.03, shadow: 0.31, fogColor: '#9fbfb2', sunColor: '#f8edce',
  },
  {
    name: '薄雾', cloud: 0.54, density: 0.82, darkness: 0.22, wind: 0.38,
    fog: 0.0205, groundFog: 0.52, rain: 0, sun: 1.95, hemi: 1.62,
    exposure: 1.02, warmth: 0.0, shadow: 0.25, fogColor: '#bdcec8', sunColor: '#edf2df',
  },
  {
    name: '细雨', cloud: 0.72, density: 0.95, darkness: 0.46, wind: 0.76,
    fog: 0.0175, groundFog: 0.39, rain: 0.85, sun: 1.25, hemi: 1.25,
    exposure: 0.94, warmth: 0.0, shadow: 0.20, fogColor: '#8ca9a8', sunColor: '#cbd7d4',
  },
  {
    name: '金色晚风', cloud: 0.36, density: 0.72, darkness: 0.18, wind: 0.64,
    fog: 0.014, groundFog: 0.24, rain: 0, sun: 2.75, hemi: 1.35,
    exposure: 1.04, warmth: 0.85, shadow: 0.30, fogColor: '#c6b99d', sunColor: '#ffd39a',
  },
];

let weatherIndex = 0;
let weatherTimer = 0;
const weather = { ...weatherStates[0] };
const fogTarget = new THREE.Color(weather.fogColor);
const sunTarget = new THREE.Color(weather.sunColor);

function cycleWeather() {
  weatherIndex = (weatherIndex + 1) % weatherStates.length;
  weatherTimer = 0;
  weatherEl.textContent = weatherStates[weatherIndex].name;
  begin();
}

weatherEl.textContent = weatherStates[0].name;

function updateWeather(dt) {
  weatherTimer += dt;
  if (weatherTimer > 34) cycleWeather();
  const target = weatherStates[weatherIndex];
  const k = 1 - Math.exp(-dt * 0.32);
  const numericKeys = ['cloud', 'density', 'darkness', 'wind', 'fog', 'groundFog', 'rain', 'sun', 'hemi', 'exposure', 'warmth', 'shadow'];
  for (const key of numericKeys) weather[key] = THREE.MathUtils.lerp(weather[key], target[key], k);

  fogTarget.set(target.fogColor);
  sunTarget.set(target.sunColor);
  scene.fog.color.lerp(fogTarget, k);
  scene.fog.density = weather.fog;
  sun.color.lerp(sunTarget, k);
  sun.intensity = weather.sun;
  hemi.intensity = weather.hemi;
  renderer.toneMappingExposure = weather.exposure;

  atmosphere.skyUniforms.uCloudCoverage.value = weather.cloud;
  atmosphere.skyUniforms.uCloudDensity.value = weather.density;
  atmosphere.skyUniforms.uCloudDarkness.value = weather.darkness;
  atmosphere.skyUniforms.uWarmth.value = weather.warmth;
  terrainSystem.shadowUniforms.uCoverage.value = weather.cloud;
  terrainSystem.shadowUniforms.uStrength.value = weather.shadow;
  grassSystem.uniforms.uWind.value = weather.wind;
  grassSystem.uniforms.uSun.value = THREE.MathUtils.clamp(weather.sun / 3.0, 0.35, 1.05);
  cinematicPass.uniforms.uWarmth.value = weather.warmth * 0.65;
}

const cameraLook = player.position.clone();
const desiredCamera = new THREE.Vector3();
const movingOffset = new THREE.Vector3();
const closeOffset = new THREE.Vector3();
const side = new THREE.Vector3();
let idleBlend = 0;

function updateCamera(dt) {
  idleBlend = THREE.MathUtils.lerp(idleBlend, player.isIdle && started ? 1 : 0, 1 - Math.exp(-dt * 2.0));
  side.set(-player.direction.z, 0, player.direction.x);

  movingOffset.copy(player.direction).multiplyScalar(-7.1).addScaledVector(side, 1.0);
  movingOffset.y += 4.25;
  closeOffset.copy(player.direction).multiplyScalar(-2.45).addScaledVector(side, 1.35);
  closeOffset.y += 1.35;

  desiredCamera.copy(movingOffset).lerp(closeOffset, idleBlend).add(player.position);
  camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * (2.7 + idleBlend * 1.4)));

  const target = player.position.clone()
    .addScaledVector(player.direction, THREE.MathUtils.lerp(2.2, 0.05, idleBlend));
  target.y += THREE.MathUtils.lerp(0.25, 0.45, idleBlend);
  cameraLook.lerp(target, 1 - Math.exp(-dt * 4.0));
  camera.lookAt(cameraLook);

  const targetFov = THREE.MathUtils.lerp(52, 42, idleBlend);
  if (Math.abs(camera.fov - targetFov) > 0.001) {
    camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 2.2));
    camera.updateProjectionMatrix();
  }

  if (bokehPass.uniforms) {
    bokehPass.uniforms.focus.value = camera.position.distanceTo(player.position) * 0.98;
    bokehPass.uniforms.maxblur.value = 0.0001 + idleBlend * 0.013;
    bokehPass.uniforms.aperture.value = 0.000012 + idleBlend * 0.000105;
  }
}

const clock = new THREE.Clock();
const lastFlowerPos = new THREE.Vector3(player.position.x, 0, player.position.z);
const sunOffset = new THREE.Vector3(36, 55, 28);
let uiAccumulator = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  updateWeather(dt);
  player.update(dt, time, input, weather.wind);

  terrainSystem.shadowUniforms.uTime.value = time;
  grassSystem.uniforms.uTime.value = time;
  flowerField.update(dt, time, weather.wind);
  atmosphere.update(dt, time, player.position, weather.rain, weather.groundFog);

  const flatDistance = Math.hypot(player.position.x - lastFlowerPos.x, player.position.z - lastFlowerPos.z);
  if (started && player.speed > 0.55 && flatDistance > 1.05) {
    flowerField.spawnPatch(player.position.x, player.position.z, 3 + Math.floor(Math.random() * 3));
    lastFlowerPos.set(player.position.x, 0, player.position.z);
  }

  sun.position.copy(player.position).add(sunOffset);
  sun.target.position.set(player.position.x, player.position.y - 2.0, player.position.z);
  sun.target.updateMatrixWorld();

  updateCamera(dt);

  uiAccumulator += dt;
  if (uiAccumulator > 0.1) {
    uiAccumulator = 0;
    speedEl.textContent = player.speed.toFixed(1);
    flowersEl.textContent = String(flowerField.count);
  }

  composer.render();
}

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
});

animate();
