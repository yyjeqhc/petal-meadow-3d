import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './styles.css';

const TAU = Math.PI * 2;
const WORLD_SIZE = 240;
const WORLD_LIMIT = 108;
const GRASS_COUNT = 22000;
const PETAL_COUNT = 54;
const MAX_FLOWERS = 1800;
const RAIN_COUNT = 420;

const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
const smooth01 = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};
const angleDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const radialField = (x, z, cx, cz, radius) => {
  const dx = x - cx;
  const dz = z - cz;
  return smooth01(1 - (dx * dx + dz * dz) / (radius * radius));
};
const valleyField = (x, z) => radialField(x, z, -38, -24, 34);
const meadowField = (x, z) => radialField(x, z, 22, -46, 31);
const hillField = (x, z) => radialField(x, z, 53, -16, 27);

function terrainHeight(x, z) {
  const broad = Math.sin(x * 0.035) * 2.8 + Math.cos(z * 0.041) * 2.35;
  const cross = Math.sin((x + z) * 0.067) * 1.25 + Math.cos((x - z) * 0.052) * 0.9;
  const basin = Math.cos(Math.hypot(x * 0.8, z) * 0.071) * 0.72;
  const shapedRegions = hillField(x, z) * 5.4 - valleyField(x, z) * 3.6 + meadowField(x, z) * 0.7;
  return broad + cross + basin + shapedRegions;
}

const app = document.querySelector('#app');
const weatherLabel = document.querySelector('#weather-label');
const speedValue = document.querySelector('#speed-value');
const speedFill = document.querySelector('#speed-fill');
const startHint = document.querySelector('#start-hint');
const focusCopy = document.querySelector('#focus-copy');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xbad7cc, 0.0031);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.08, 360);
camera.position.set(0, 7, 12);

const hemi = new THREE.HemisphereLight(0xdaf3ff, 0x34552b, 1.42);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff0bd, 3.15);
sun.position.set(-48, 64, 22);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -34;
sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34;
sun.shadow.camera.bottom = -34;
sun.shadow.camera.near = 8;
sun.shadow.camera.far = 150;
sun.shadow.bias = -0.0002;
scene.add(sun);
scene.add(sun.target);

const sunDirection = sun.position.clone().normalize();

function makeSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uSunDir: { value: sunDirection.clone() },
      uCloudiness: { value: 0.28 },
      uWarmth: { value: 0.18 },
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vDirection = normalize(world.xyz - cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uSunDir;
      uniform float uCloudiness;
      uniform float uWarmth;
      varying vec3 vDirection;
      void main() {
        vec3 d = normalize(vDirection);
        float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 clearHorizon = vec3(0.69, 0.86, 0.88);
        vec3 clearZenith = vec3(0.23, 0.58, 0.84);
        vec3 cloudHorizon = vec3(0.62, 0.72, 0.73);
        vec3 cloudZenith = vec3(0.36, 0.48, 0.60);
        vec3 horizon = mix(clearHorizon, cloudHorizon, uCloudiness * 0.72);
        vec3 zenith = mix(clearZenith, cloudZenith, uCloudiness * 0.82);
        vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.92, h));
        float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
        float halo = pow(sunDot, 96.0) * (1.0 - uCloudiness * 0.58);
        float haze = pow(sunDot, 8.0) * 0.24 * (1.0 - uCloudiness * 0.42);
        col += vec3(1.0, 0.72 + uWarmth * 0.18, 0.42) * halo * 2.4;
        col += vec3(1.0, 0.72, 0.43) * haze * (0.55 + uWarmth);
        col = mix(col, vec3(0.83, 0.74, 0.62), uWarmth * (1.0 - h) * 0.22);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(175, 40, 24), material);
  mesh.renderOrder = -100;
  scene.add(mesh);
  return { mesh, material };
}

const sky = makeSky();

const sharedNoise2D = `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm2(vec2 p) {
    float n = 0.0;
    n += noise2(p) * 0.56;
    p = p * 2.03 + 13.7;
    n += noise2(p) * 0.28;
    p = p * 2.11 + 7.4;
    n += noise2(p) * 0.16;
    return n;
  }
  float cloudShadow(vec2 worldXZ, float time) {
    vec2 drift = vec2(time * 0.035, time * 0.012);
    float n = fbm2(worldXZ * 0.028 + drift);
    n += sin(worldXZ.x * 0.016 + worldXZ.y * 0.012 + time * 0.042) * 0.06;
    return smoothstep(0.50, 0.72, n);
  }
`;

function makeTerrain() {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 176, 176);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    positions.setY(i, terrainHeight(x, z));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();

  const material = new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uCloudiness: { value: 0.28 },
        uSunDir: { value: sunDirection.clone() },
        uDryness: { value: 0.16 },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform float uCloudiness;
      uniform float uDryness;
      uniform vec3 uSunDir;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      ${sharedNoise2D}
      void main() {
        float slopeLight = 0.42 + max(dot(normalize(vWorldNormal), normalize(uSunDir)), 0.0) * 0.58;
        float fine = noise2(vWorldPos.xz * 0.11) * 0.11;
        float broad = noise2(vWorldPos.xz * 0.025) * 0.14;
        vec3 lush = mix(vec3(0.105, 0.28, 0.09), vec3(0.36, 0.56, 0.15), fine + broad + 0.28);
        vec3 dry = vec3(0.47, 0.48, 0.14);
        vec3 color = mix(lush, dry, uDryness * 0.28);
        vec2 valleyD = (vWorldPos.xz - vec2(-38.0, -24.0)) / 34.0;
        vec2 meadowD = (vWorldPos.xz - vec2(22.0, -46.0)) / 31.0;
        vec2 hillD = (vWorldPos.xz - vec2(53.0, -16.0)) / 27.0;
        float valley = 1.0 - smoothstep(0.0, 1.0, dot(valleyD, valleyD));
        float meadow = 1.0 - smoothstep(0.0, 1.0, dot(meadowD, meadowD));
        float hill = 1.0 - smoothstep(0.0, 1.0, dot(hillD, hillD));
        color = mix(color, vec3(0.12, 0.34, 0.085), valley * 0.24);
        color = mix(color, vec3(0.32, 0.52, 0.12), meadow * 0.27);
        color = mix(color, vec3(0.40, 0.43, 0.12), hill * 0.16);
        float shadow = cloudShadow(vWorldPos.xz, uTime) * uCloudiness;
        color *= slopeLight * mix(1.02, 0.61, shadow);
        color += vec3(0.035, 0.052, 0.012) * smoothstep(2.0, 6.0, vWorldPos.y);
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, material };
}

const terrain = makeTerrain();

function createGrassBladeGeometry() {
  const positions = [];
  const uvs = [];
  const levels = [0, 0.33, 0.68, 1.0];
  const halfWidths = [0.07, 0.058, 0.036, 0.004];
  const addStrip = (axis) => {
    for (let s = 0; s < levels.length - 1; s += 1) {
      const y0 = levels[s];
      const y1 = levels[s + 1];
      const w0 = halfWidths[s];
      const w1 = halfWidths[s + 1];
      const a = axis === 0 ? [-w0, y0, 0] : [0, y0, -w0];
      const b = axis === 0 ? [w0, y0, 0] : [0, y0, w0];
      const c = axis === 0 ? [-w1, y1, 0] : [0, y1, -w1];
      const d = axis === 0 ? [w1, y1, 0] : [0, y1, w1];
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
      uvs.push(0, y0, 1, y0, 0, y1, 1, y0, 1, y1, 0, y1);
    }
  };
  addStrip(0);
  addStrip(1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return geometry;
}

function makeGrass() {
  const geometry = createGrassBladeGeometry();
  const offsets = new Float32Array(GRASS_COUNT * 3);
  const scales = new Float32Array(GRASS_COUNT);
  const phases = new Float32Array(GRASS_COUNT);
  const tints = new Float32Array(GRASS_COUNT);

  for (let i = 0; i < GRASS_COUNT; i += 1) {
    let x = 0;
    let z = 0;
    let valley = 0;
    let meadow = 0;
    let hill = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      x = (Math.random() - 0.5) * (WORLD_SIZE - 4);
      z = (Math.random() - 0.5) * (WORLD_SIZE - 4);
      valley = valleyField(x, z);
      meadow = meadowField(x, z);
      hill = hillField(x, z);
      const density = clamp(0.63 + valley * 0.17 + meadow * 0.31 - hill * 0.15, 0.34, 0.96);
      if (Math.random() < density || attempt === 7) break;
    }
    const lushness = clamp(valley * 0.58 + meadow * 0.82, 0, 1);
    offsets[i * 3] = x;
    offsets[i * 3 + 1] = terrainHeight(x, z) + 0.025;
    offsets[i * 3 + 2] = z;
    scales[i] = (0.62 + Math.random() * 1.16) * (0.92 + lushness * 0.18 - hill * 0.12);
    phases[i] = Math.random();
    tints[i] = clamp(Math.random() * 0.72 + lushness * 0.28, 0, 1);
  }

  geometry.setAttribute('instanceOffset', new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute('instanceScale', new THREE.InstancedBufferAttribute(scales, 1));
  geometry.setAttribute('instancePhase', new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute('instanceTint', new THREE.InstancedBufferAttribute(tints, 1));
  geometry.instanceCount = GRASS_COUNT;

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uWindStrength: { value: 0.82 },
        uWindDir: { value: new THREE.Vector2(0.84, 0.38).normalize() },
        uCloudiness: { value: 0.28 },
      },
    ]),
    vertexShader: `
      #include <fog_pars_vertex>
      attribute vec3 instanceOffset;
      attribute float instanceScale;
      attribute float instancePhase;
      attribute float instanceTint;
      uniform float uTime;
      uniform float uWindStrength;
      uniform vec2 uWindDir;
      varying float vTip;
      varying float vTint;
      varying vec2 vWorldXZ;
      void main() {
        vec3 p = position;
        float tip = uv.y;
        p.y *= instanceScale;
        float gustA = sin(uTime * 2.15 + instancePhase * 6.283 + instanceOffset.x * 0.16 + instanceOffset.z * 0.105);
        float gustB = sin(uTime * 0.67 + instanceOffset.x * 0.037 - instanceOffset.z * 0.052 + instancePhase * 3.7);
        float gust = gustA * 0.62 + gustB * 0.38;
        float bend = tip * tip * uWindStrength * (0.22 + gust * 0.16);
        p.x += uWindDir.x * bend;
        p.z += uWindDir.y * bend;
        p.x += sin(instancePhase * 17.0 + uTime * 1.4) * tip * 0.018;
        vec4 world = modelMatrix * vec4(p + instanceOffset, 1.0);
        vTip = tip;
        vTint = instanceTint;
        vWorldXZ = world.xz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform float uCloudiness;
      varying float vTip;
      varying float vTint;
      varying vec2 vWorldXZ;
      ${sharedNoise2D}
      void main() {
        vec3 baseA = vec3(0.08, 0.24, 0.055);
        vec3 baseB = vec3(0.18, 0.39, 0.075);
        vec3 tipA = vec3(0.47, 0.63, 0.16);
        vec3 color = mix(mix(baseA, baseB, vTint), tipA, smoothstep(0.18, 1.0, vTip) * 0.66);
        float shadow = cloudShadow(vWorldXZ, uTime) * uCloudiness;
        color *= mix(1.08, 0.58, shadow);
        color += vec3(0.045, 0.05, 0.004) * pow(vTip, 2.0);
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { mesh, material };
}

const grass = makeGrass();

function createPetalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.48);
  shape.bezierCurveTo(-0.34, -0.28, -0.4, 0.18, 0, 0.54);
  shape.bezierCurveTo(0.4, 0.18, 0.34, -0.28, 0, -0.48);
  const geometry = new THREE.ShapeGeometry(shape, 10);
  geometry.scale(0.52, 0.52, 0.52);
  geometry.computeVertexNormals();
  return geometry;
}

const petalMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.68,
  metalness: 0,
  side: THREE.DoubleSide,
  vertexColors: false,
  emissive: new THREE.Color(0x150a04),
  emissiveIntensity: 0.14,
});
const petalSwarm = new THREE.InstancedMesh(createPetalGeometry(), petalMaterial, PETAL_COUNT);
petalSwarm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
petalSwarm.castShadow = true;
petalSwarm.frustumCulled = false;
scene.add(petalSwarm);

const petalStates = Array.from({ length: PETAL_COUNT }, (_, index) => ({
  phase: Math.random() * TAU,
  radius: index === 0 ? 0.08 : 0.22 + Math.pow(Math.random(), 0.7) * 1.7,
  lift: index === 0 ? 0.15 : (Math.random() - 0.5) * 1.25,
  trail: index === 0 ? 0 : Math.random() * 2.8,
  scale: index === 0 ? 1.35 : 0.56 + Math.random() * 0.74,
  spin: 0.65 + Math.random() * 1.8,
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  initialized: false,
}));

const petalPalette = [0xfff7e6, 0xffd8d0, 0xffe7b4, 0xf9f0ff, 0xffc6aa, 0xfff4cf];
for (let i = 0; i < PETAL_COUNT; i += 1) {
  const color = new THREE.Color(i === 0 ? 0xffd36e : petalPalette[Math.floor(Math.random() * petalPalette.length)]);
  petalSwarm.setColorAt(i, color);
}
petalSwarm.instanceColor.needsUpdate = true;

const swarmGlow = new THREE.PointLight(0xffd889, 9.5, 12, 2.1);
scene.add(swarmGlow);

function createFlowerGeometry() {
  const positions = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * TAU;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const root = [dx * 0.035, 0.015, dz * 0.035];
    const left = [dx * 0.16 + px * 0.105, 0.035, dz * 0.16 + pz * 0.105];
    const tip = [dx * 0.36, 0.085, dz * 0.36];
    const right = [dx * 0.16 - px * 0.105, 0.035, dz * 0.16 - pz * 0.105];
    positions.push(...root, ...left, ...tip, ...root, ...tip, ...right);
  }
  for (let i = 0; i < 8; i += 1) {
    const a0 = (i / 8) * TAU;
    const a1 = ((i + 1) / 8) * TAU;
    positions.push(
      0, 0.06, 0,
      Math.cos(a0) * 0.095, 0.065, Math.sin(a0) * 0.095,
      Math.cos(a1) * 0.095, 0.065, Math.sin(a1) * 0.095,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const stemGeometry = new THREE.CylinderGeometry(0.028, 0.045, 1, 5);
const stemMaterial = new THREE.MeshStandardMaterial({ color: 0x4d7629, roughness: 0.92 });
const bloomMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.72,
  side: THREE.DoubleSide,
});
const stemMesh = new THREE.InstancedMesh(stemGeometry, stemMaterial, MAX_FLOWERS);
const bloomMesh = new THREE.InstancedMesh(createFlowerGeometry(), bloomMaterial, MAX_FLOWERS);
stemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bloomMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
stemMesh.frustumCulled = false;
bloomMesh.frustumCulled = false;
stemMesh.castShadow = true;
bloomMesh.castShadow = true;
scene.add(stemMesh, bloomMesh);

const flowerPalette = [0xffe879, 0xff9a94, 0xf6f0ff, 0xffc265, 0xd7a3ff, 0xfff4bd, 0xf57f8e];
const flowerData = new Array(MAX_FLOWERS);
let flowerCursor = 0;
const flowerDummy = new THREE.Object3D();
const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_FLOWERS; i += 1) {
  stemMesh.setMatrixAt(i, hiddenMatrix);
  bloomMesh.setMatrixAt(i, hiddenMatrix);
  bloomMesh.setColorAt(i, new THREE.Color(flowerPalette[i % flowerPalette.length]));
}
stemMesh.instanceMatrix.needsUpdate = true;
bloomMesh.instanceMatrix.needsUpdate = true;
bloomMesh.instanceColor.needsUpdate = true;

function spawnFlower(x, z, grown = false, scaleMul = 1) {
  const index = flowerCursor % MAX_FLOWERS;
  flowerCursor += 1;
  const color = new THREE.Color(flowerPalette[Math.floor(Math.random() * flowerPalette.length)]);
  flowerData[index] = {
    x,
    z,
    y: terrainHeight(x, z) + 0.035,
    growth: grown ? 1 : 0,
    growthSpeed: 1.15 + Math.random() * 0.8,
    scale: (0.55 + Math.random() * 0.62) * scaleMul,
    rotation: Math.random() * TAU,
  };
  bloomMesh.setColorAt(index, color);
  bloomMesh.instanceColor.needsUpdate = true;
}

function seedFlowerField(cx, cz, radiusX, radiusZ, count, scaleMul = 1) {
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * TAU;
    const radius = Math.sqrt(Math.random());
    const x = clamp(cx + Math.cos(angle) * radiusX * radius, -WORLD_LIMIT, WORLD_LIMIT);
    const z = clamp(cz + Math.sin(angle) * radiusZ * radius, -WORLD_LIMIT, WORLD_LIMIT);
    spawnFlower(x, z, true, scaleMul * (0.82 + Math.random() * 0.34));
  }
}

for (let i = 0; i < 90; i += 1) {
  const angle = Math.random() * TAU;
  const radius = 12 + Math.sqrt(Math.random()) * 94;
  spawnFlower(Math.cos(angle) * radius, Math.sin(angle) * radius, true, 0.68);
}
seedFlowerField(22, -46, 27, 19, 270, 0.82);
seedFlowerField(53, -16, 14, 11, 90, 0.72);

const bloomWaves = [];
const MAX_BLOOM_WAVES = 18;

function triggerBloomWake() {
  bloomWaves.push({
    x: leader.x,
    z: leader.z,
    headingX: heading.x,
    headingZ: heading.z,
    age: 0,
    nextPulse: 0,
    life: 0.72 + Math.random() * 0.12,
    seed: Math.random() * TAU,
  });
  if (bloomWaves.length > MAX_BLOOM_WAVES) bloomWaves.shift();
}

function updateBloomWaves(dt) {
  for (let waveIndex = bloomWaves.length - 1; waveIndex >= 0; waveIndex -= 1) {
    const wave = bloomWaves[waveIndex];
    wave.age += dt;
    while (wave.nextPulse <= wave.age && wave.nextPulse <= wave.life) {
      const progress = clamp(wave.nextPulse / wave.life, 0, 1);
      const radius = 0.22 + progress * 2.65;
      const count = 2 + Math.floor(progress * 3.2);
      for (let i = 0; i < count; i += 1) {
        const angle = wave.seed + (i / count) * TAU + Math.sin(progress * 9 + i) * 0.23;
        const forwardBias = progress * 0.72;
        const x = clamp(wave.x + Math.cos(angle) * radius + wave.headingX * forwardBias, -WORLD_LIMIT, WORLD_LIMIT);
        const z = clamp(wave.z + Math.sin(angle) * radius + wave.headingZ * forwardBias, -WORLD_LIMIT, WORLD_LIMIT);
        spawnFlower(x, z, false, 0.66 + Math.random() * 0.34 + progress * 0.12);
      }
      wave.nextPulse += 0.18;
    }
    if (wave.age > wave.life + 0.12) bloomWaves.splice(waveIndex, 1);
  }
}

function updateFlowers(dt) {
  for (let i = 0; i < MAX_FLOWERS; i += 1) {
    const flower = flowerData[i];
    if (!flower) continue;
    flower.growth = Math.min(1, flower.growth + dt * flower.growthSpeed);
    const eased = 1 - Math.pow(1 - flower.growth, 3);
    const stemHeight = 0.72 * flower.scale * eased;

    flowerDummy.position.set(flower.x, flower.y + stemHeight * 0.5, flower.z);
    flowerDummy.rotation.set(0, flower.rotation, 0);
    flowerDummy.scale.set(flower.scale, stemHeight, flower.scale);
    flowerDummy.updateMatrix();
    stemMesh.setMatrixAt(i, flowerDummy.matrix);

    const bloomGrowth = smooth01(clamp((flower.growth - 0.18) / 0.82, 0, 1));
    flowerDummy.position.set(flower.x, flower.y + stemHeight, flower.z);
    flowerDummy.rotation.set(0, flower.rotation, 0);
    flowerDummy.scale.setScalar(flower.scale * bloomGrowth);
    flowerDummy.updateMatrix();
    bloomMesh.setMatrixAt(i, flowerDummy.matrix);
  }
  stemMesh.instanceMatrix.needsUpdate = true;
  bloomMesh.instanceMatrix.needsUpdate = true;
}

function makeMistTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const lobes = [
    [0.26, 0.58, 0.36],
    [0.48, 0.44, 0.42],
    [0.69, 0.57, 0.34],
  ];
  for (const [x, y, r] of lobes) {
    const gradient = ctx.createRadialGradient(x * 256, y * 128, 0, x * 256, y * 128, r * 180);
    gradient.addColorStop(0, 'rgba(255,255,255,0.48)');
    gradient.addColorStop(0.38, 'rgba(245,255,251,0.24)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 128);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const mistTexture = makeMistTexture();
const mistWisps = [];
for (let i = 0; i < 24; i += 1) {
  const material = new THREE.SpriteMaterial({
    map: mistTexture,
    color: 0xdfeee7,
    transparent: true,
    depthWrite: false,
    opacity: 0.08 + Math.random() * 0.07,
  });
  const sprite = new THREE.Sprite(material);
  const x = (Math.random() - 0.5) * 190;
  const z = (Math.random() - 0.5) * 190;
  sprite.position.set(x, terrainHeight(x, z) + 0.9 + Math.random() * 0.8, z);
  const width = 10 + Math.random() * 18;
  sprite.scale.set(width, width * (0.22 + Math.random() * 0.1), 1);
  sprite.userData = {
    baseOpacity: material.opacity,
    drift: 0.32 + Math.random() * 0.52,
    bob: Math.random() * TAU,
  };
  scene.add(sprite);
  mistWisps.push(sprite);
}

const volumeNoise = `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float n000 = hash31(i + vec3(0,0,0));
    float n100 = hash31(i + vec3(1,0,0));
    float n010 = hash31(i + vec3(0,1,0));
    float n110 = hash31(i + vec3(1,1,0));
    float n001 = hash31(i + vec3(0,0,1));
    float n101 = hash31(i + vec3(1,0,1));
    float n011 = hash31(i + vec3(0,1,1));
    float n111 = hash31(i + vec3(1,1,1));
    float nx00 = mix(n000, n100, f.x);
    float nx10 = mix(n010, n110, f.x);
    float nx01 = mix(n001, n101, f.x);
    float nx11 = mix(n011, n111, f.x);
    return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
  }
  float fbm3(vec3 p) {
    float v = noise3(p) * 0.57;
    p = p * 2.04 + 11.3;
    v += noise3(p) * 0.28;
    p = p * 2.12 + 4.7;
    v += noise3(p) * 0.15;
    return v;
  }
`;

function createCloudMaterial(seed) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    uniforms: {
      uTime: { value: seed * 17 },
      uCameraLocal: { value: new THREE.Vector3() },
      uDensity: { value: 0.28 },
      uOpacity: { value: 0.82 },
      uSunColor: { value: new THREE.Color(1.0, 0.91, 0.72) },
    },
    vertexShader: `
      varying vec3 vLocalPos;
      void main() {
        vLocalPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uTime;
      uniform float uDensity;
      uniform float uOpacity;
      uniform vec3 uCameraLocal;
      uniform vec3 uSunColor;
      varying vec3 vLocalPos;
      ${volumeNoise}
      vec2 hitBox(vec3 ro, vec3 rd) {
        vec3 safeDir = sign(rd) * max(abs(rd), vec3(0.0001));
        vec3 inv = 1.0 / safeDir;
        vec3 t0 = (-0.5 - ro) * inv;
        vec3 t1 = (0.5 - ro) * inv;
        vec3 tmin = min(t0, t1);
        vec3 tmax = max(t0, t1);
        float nearT = max(max(tmin.x, tmin.y), tmin.z);
        float farT = min(min(tmax.x, tmax.y), tmax.z);
        return vec2(nearT, farT);
      }
      float densityAt(vec3 p) {
        vec3 q = p;
        float radial = length(vec3(q.x * 1.02, q.y * 2.08, q.z * 1.08));
        float shape = 0.92 - radial;
        float n = fbm3(q * 4.15 + vec3(uTime * 0.018, 0.0, uTime * 0.009));
        float detail = noise3(q * 10.0 - uTime * 0.012) * 0.13;
        return smoothstep(0.02, 0.54, shape + n * 0.64 + detail + uDensity * 0.25);
      }
      void main() {
        vec3 ro = uCameraLocal;
        vec3 rd = normalize(vLocalPos - ro);
        vec2 hit = hitBox(ro, rd);
        float tStart = max(hit.x, 0.0);
        float tEnd = hit.y;
        if (tEnd <= tStart) discard;
        float span = tEnd - tStart;
        float stepLen = span / 30.0;
        float jitter = hash31(vec3(gl_FragCoord.xy * 0.013, uTime)) * stepLen;
        float t = tStart + jitter;
        vec4 accum = vec4(0.0);
        for (int i = 0; i < 30; i++) {
          if (t > tEnd || accum.a > 0.96) break;
          vec3 p = ro + rd * t;
          float den = densityAt(p);
          if (den > 0.01) {
            float topLight = smoothstep(-0.48, 0.48, p.y);
            float edgeLight = 1.0 - smoothstep(0.18, 0.62, length(p.xz));
            vec3 shade = mix(vec3(0.53, 0.60, 0.64), vec3(0.98), 0.52 + topLight * 0.38);
            shade = mix(shade, uSunColor, edgeLight * 0.16);
            float alpha = den * stepLen * (1.7 + uDensity * 1.2) * uOpacity;
            alpha = 1.0 - exp(-alpha * 2.35);
            accum.rgb += (1.0 - accum.a) * shade * alpha;
            accum.a += (1.0 - accum.a) * alpha;
          }
          t += stepLen;
        }
        if (accum.a < 0.015) discard;
        gl_FragColor = accum;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

const cloudGeometry = new THREE.BoxGeometry(1, 1, 1);
const clouds = [];
for (let i = 0; i < 9; i += 1) {
  const material = createCloudMaterial(Math.random());
  const cloud = new THREE.Mesh(cloudGeometry, material);
  const x = (Math.random() - 0.5) * 190;
  const z = (Math.random() - 0.5) * 190;
  cloud.position.set(x, 22 + Math.random() * 15, z);
  cloud.scale.set(16 + Math.random() * 15, 6 + Math.random() * 5.5, 11 + Math.random() * 16);
  cloud.rotation.y = Math.random() * TAU;
  cloud.renderOrder = -4;
  cloud.userData = {
    drift: 0.58 + Math.random() * 0.72,
    seed: Math.random() * 20,
  };
  scene.add(cloud);
  clouds.push(cloud);
}

const rainPositions = new Float32Array(RAIN_COUNT * 2 * 3);
const rainDrops = Array.from({ length: RAIN_COUNT }, () => ({
  x: (Math.random() - 0.5) * 80,
  y: 7 + Math.random() * 34,
  z: (Math.random() - 0.5) * 80,
  speed: 13 + Math.random() * 10,
  length: 0.55 + Math.random() * 0.8,
}));
const rainGeometry = new THREE.BufferGeometry();
rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
const rainMaterial = new THREE.LineBasicMaterial({
  color: 0xdff4f5,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
rain.frustumCulled = false;
scene.add(rain);

const leader = new THREE.Vector3(0, terrainHeight(0, 0) + 2.5, 8);
const previousLeader = leader.clone();
const heading = new THREE.Vector3(0, 0, -1);
const right = new THREE.Vector3(1, 0, 0);
const lookTarget = new THREE.Vector3();
const desiredCamera = new THREE.Vector3();
const desiredLook = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpLocal = new THREE.Vector3();
const petalTarget = new THREE.Vector3();
const petalAccel = new THREE.Vector3();
const petalDummy = new THREE.Object3D();
const clock = new THREE.Clock();

const input = {
  keys: new Set(),
  pointerDown: false,
  pointerX: 0,
  pointerY: 0,
  hasStarted: false,
  speed: 0,
  yaw: 0,
  turnRate: 0,
  idleSeconds: 0,
  idleFocus: 0,
  trailDistance: 0,
};

function markStarted() {
  if (input.hasStarted) return;
  input.hasStarted = true;
  startHint.classList.add('hidden');
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd', 'shift', 'arrowup', 'arrowleft', 'arrowright', ' '].includes(key)) {
    event.preventDefault();
    input.keys.add(key);
    markStarted();
  }
});

window.addEventListener('keyup', (event) => {
  input.keys.delete(event.key.toLowerCase());
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  input.pointerDown = true;
  input.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
  input.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
  renderer.domElement.setPointerCapture?.(event.pointerId);
  markStarted();
});

window.addEventListener('pointermove', (event) => {
  input.pointerX = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
  input.pointerY = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
});

window.addEventListener('pointerup', (event) => {
  input.pointerDown = false;
  renderer.domElement.releasePointerCapture?.(event.pointerId);
});

window.addEventListener('blur', () => {
  input.keys.clear();
  input.pointerDown = false;
});

function updatePlayer(dt, elapsed) {
  const forwardHeld = input.keys.has('w') || input.keys.has('arrowup') || input.pointerDown;
  const braking = input.keys.has('s');
  const boosting = input.keys.has('shift') || input.keys.has(' ');
  let targetSpeed = forwardHeld ? (boosting ? 19.5 : 11.2) : 0;
  if (braking) targetSpeed = 0;
  input.speed = damp(input.speed, targetSpeed, braking ? 8.2 : forwardHeld ? 3.4 : 2.2, dt);

  let turn = 0;
  if (input.keys.has('a') || input.keys.has('arrowleft')) turn -= 1;
  if (input.keys.has('d') || input.keys.has('arrowright')) turn += 1;
  if (forwardHeld) turn += input.pointerX * (input.pointerDown ? 0.95 : 0.38);
  const yawBefore = input.yaw;
  input.yaw += turn * dt * (0.82 + input.speed * 0.028);

  const radial = Math.hypot(leader.x, leader.z);
  if (radial > WORLD_LIMIT * 0.86) {
    const centerYaw = Math.atan2(-leader.x, leader.z);
    const edgeFactor = smooth01((radial - WORLD_LIMIT * 0.86) / (WORLD_LIMIT * 0.14));
    input.yaw += angleDelta(input.yaw, centerYaw) * edgeFactor * dt * 1.9;
  }
  const instantaneousTurnRate = dt > 0 ? angleDelta(yawBefore, input.yaw) / dt : 0;
  input.turnRate = damp(input.turnRate, instantaneousTurnRate, 7.5, dt);

  heading.set(Math.sin(input.yaw), 0, -Math.cos(input.yaw));
  right.set(-heading.z, 0, heading.x);
  previousLeader.copy(leader);
  leader.addScaledVector(heading, input.speed * dt);

  const newRadial = Math.hypot(leader.x, leader.z);
  if (newRadial > WORLD_LIMIT) {
    leader.x *= WORLD_LIMIT / newRadial;
    leader.z *= WORLD_LIMIT / newRadial;
    input.speed *= 0.84;
  }

  const pointerLift = forwardHeld ? -input.pointerY * 0.75 : 0;
  const groundY = terrainHeight(leader.x, leader.z);
  const airY = groundY + 2.45 + pointerLift + Math.sin(elapsed * 1.6) * 0.08;
  leader.y = damp(leader.y, airY, 5.2, dt);

  const moved = previousLeader.distanceTo(leader);
  input.trailDistance += moved;
  if (input.speed > 1.0 && input.trailDistance > 2.65) {
    input.trailDistance = 0;
    triggerBloomWake();
  }

  if (input.hasStarted && input.speed < 0.32 && !forwardHeld) input.idleSeconds += dt;
  else input.idleSeconds = 0;
  const focusTarget = input.hasStarted && input.idleSeconds > 1.35 ? 1 : 0;
  input.idleFocus = damp(input.idleFocus, focusTarget, focusTarget ? 1.35 : 4.6, dt);
}

function updatePetals(dt, elapsed) {
  const speedRatio = clamp(input.speed / 19.5, 0, 1);
  const ribbon = smooth01(clamp(input.speed / 13.5, 0, 1));
  const turn = clamp(input.turnRate / 1.2, -1, 1);
  const turnAmount = Math.abs(turn);
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    const state = petalStates[i];
    const phase = state.phase + elapsed * (0.76 + state.spin * 0.13);
    const swirl = Math.sin(phase * 0.73 + i) * 0.35;
    const sideSpread = Math.cos(phase) * state.radius * lerp(1.08, 0.72, ribbon);
    const turnFan = -turn * (0.16 + state.trail * 0.42) * (0.28 + ribbon * 0.72);
    const tail = state.trail * (0.32 + ribbon * 2.18);

    petalTarget.copy(leader);
    petalTarget.addScaledVector(right, sideSpread + turnFan);
    petalTarget.addScaledVector(heading, -tail + Math.sin(phase * 1.37) * state.radius * (0.24 + ribbon * 0.18));
    petalTarget.y += state.lift + Math.sin(phase * 1.8) * (0.22 + state.radius * 0.12) + swirl + turnAmount * Math.sin(phase) * 0.22;

    if (!state.initialized) {
      state.position.copy(petalTarget);
      state.velocity.set(0, 0, 0);
      state.initialized = true;
    }

    const stiffness = i === 0 ? 92 : lerp(54, 31, ribbon);
    const drag = i === 0 ? 14 : lerp(9.2, 5.3, ribbon);
    petalAccel.copy(petalTarget).sub(state.position).multiplyScalar(stiffness);
    state.velocity.addScaledVector(petalAccel, dt);
    state.velocity.multiplyScalar(Math.exp(-drag * dt));
    state.position.addScaledVector(state.velocity, dt);

    petalDummy.position.copy(state.position);
    const motionYaw = state.velocity.lengthSq() > 0.002
      ? Math.atan2(state.velocity.x, -state.velocity.z)
      : input.yaw;
    petalDummy.rotation.set(
      phase * 1.3 + Math.sin(phase) * 0.5 + turn * 0.22,
      motionYaw + phase * 0.36,
      phase * state.spin - turn * (0.38 + state.trail * 0.08),
    );
    const pulse = state.scale * (0.92 + Math.sin(elapsed * 2.2 + state.phase) * 0.08) * (1 + speedRatio * 0.05);
    petalDummy.scale.setScalar(pulse);
    petalDummy.updateMatrix();
    petalSwarm.setMatrixAt(i, petalDummy.matrix);
  }
  petalSwarm.instanceMatrix.needsUpdate = true;
  swarmGlow.position.copy(leader).addScaledVector(heading, 0.2);
}

function updateCamera(dt) {
  const speedRatio = clamp(input.speed / 19.5, 0, 1);
  const focus = input.idleFocus;
  const distance = lerp(10.8 + speedRatio * 1.7, 5.2, focus);
  const height = lerp(5.4 + speedRatio * 0.55, 3.25, focus);
  const cameraTurnDrift = -clamp(input.turnRate, -1.2, 1.2) * speedRatio * 0.52;
  desiredCamera.copy(leader).addScaledVector(heading, -distance).addScaledVector(right, input.pointerX * 0.28 * (1 - focus) + cameraTurnDrift);
  desiredCamera.y += height;
  camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * (focus > 0.5 ? 2.0 : 4.2)));

  desiredLook.copy(leader).addScaledVector(heading, lerp(4.1, 0.8, focus));
  desiredLook.y += lerp(0.55, 0.12, focus);
  lookTarget.lerp(desiredLook, 1 - Math.exp(-dt * 4.5));
  camera.lookAt(lookTarget);
  camera.rotateZ(-clamp(input.turnRate, -1.2, 1.2) * speedRatio * 0.045 * (1 - focus));
  camera.fov = damp(camera.fov, lerp(48, 55, speedRatio) - focus * 3.5, 3.1, dt);
  camera.updateProjectionMatrix();
}

function updateWeather(dt, elapsed) {
  const broad = 0.5 + 0.5 * Math.sin(elapsed * 0.038 - 0.8);
  const secondary = 0.5 + 0.5 * Math.sin(elapsed * 0.017 + 1.9);
  const cloudiness = clamp(0.16 + broad * 0.58 + secondary * 0.15, 0.12, 0.88);
  const rainAmount = smooth01((cloudiness - 0.67) / 0.2);
  const mistAmount = clamp(0.25 + cloudiness * 0.78 + rainAmount * 0.28, 0.22, 1);
  const gustPulse = 0.5 + 0.5 * Math.sin(elapsed * 0.19 + Math.sin(elapsed * 0.031) * 2.2);
  const windStrength = 0.6 + gustPulse * 0.58 + cloudiness * 0.34 + clamp(input.speed / 24, 0, 0.7);
  const windAngle = 0.37 + Math.sin(elapsed * 0.011) * 0.35;
  const windDir = tmpVec.set(Math.cos(windAngle), 0, Math.sin(windAngle)).normalize();
  const warmth = clamp(0.16 + (1 - cloudiness) * (0.22 + secondary * 0.24), 0.12, 0.58);

  terrain.material.uniforms.uTime.value = elapsed;
  terrain.material.uniforms.uCloudiness.value = cloudiness;
  terrain.material.uniforms.uDryness.value = 0.12 + warmth * 0.16;
  grass.material.uniforms.uTime.value = elapsed;
  grass.material.uniforms.uCloudiness.value = cloudiness;
  grass.material.uniforms.uWindStrength.value = windStrength;
  grass.material.uniforms.uWindDir.value.set(windDir.x, windDir.z);
  sky.material.uniforms.uCloudiness.value = cloudiness;
  sky.material.uniforms.uWarmth.value = warmth;

  sun.intensity = 3.45 * (1 - cloudiness * 0.58) + 0.62;
  sun.color.setRGB(1, 0.86 + warmth * 0.13, 0.68 + warmth * 0.17);
  hemi.intensity = 1.18 + (1 - cloudiness) * 0.42;
  scene.fog.density = 0.00255 + cloudiness * 0.0023 + rainAmount * 0.0018;
  scene.fog.color.setRGB(
    lerp(0.69, 0.66, cloudiness),
    lerp(0.83, 0.76, cloudiness),
    lerp(0.78, 0.77, cloudiness),
  );
  renderer.toneMappingExposure = damp(renderer.toneMappingExposure, 1.13 - cloudiness * 0.18 + warmth * 0.08, 1.4, dt);

  for (const cloud of clouds) {
    cloud.position.x += windDir.x * dt * cloud.userData.drift;
    cloud.position.z += windDir.z * dt * cloud.userData.drift;
    if (cloud.position.x > WORLD_SIZE * 0.58) cloud.position.x -= WORLD_SIZE * 1.16;
    if (cloud.position.x < -WORLD_SIZE * 0.58) cloud.position.x += WORLD_SIZE * 1.16;
    if (cloud.position.z > WORLD_SIZE * 0.58) cloud.position.z -= WORLD_SIZE * 1.16;
    if (cloud.position.z < -WORLD_SIZE * 0.58) cloud.position.z += WORLD_SIZE * 1.16;
    cloud.material.uniforms.uTime.value = elapsed + cloud.userData.seed;
    cloud.material.uniforms.uDensity.value = cloudiness;
    cloud.material.uniforms.uOpacity.value = 0.72 + cloudiness * 0.22;
    tmpLocal.copy(camera.position);
    cloud.worldToLocal(tmpLocal);
    cloud.material.uniforms.uCameraLocal.value.copy(tmpLocal);
  }

  for (const mist of mistWisps) {
    mist.position.x += windDir.x * mist.userData.drift * dt;
    mist.position.z += windDir.z * mist.userData.drift * dt;
    if (mist.position.x > WORLD_LIMIT) mist.position.x = -WORLD_LIMIT;
    if (mist.position.x < -WORLD_LIMIT) mist.position.x = WORLD_LIMIT;
    if (mist.position.z > WORLD_LIMIT) mist.position.z = -WORLD_LIMIT;
    if (mist.position.z < -WORLD_LIMIT) mist.position.z = WORLD_LIMIT;
    const ground = terrainHeight(mist.position.x, mist.position.z);
    mist.position.y = ground + 0.9 + Math.sin(elapsed * 0.28 + mist.userData.bob) * 0.34;
    mist.material.opacity = mist.userData.baseOpacity * mistAmount * (0.85 + rainAmount * 0.72);
  }

  rainMaterial.opacity = rainAmount * 0.28;
  const rainArray = rainGeometry.attributes.position.array;
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    const drop = rainDrops[i];
    drop.y -= drop.speed * dt;
    drop.x += windDir.x * dt * 2.6;
    drop.z += windDir.z * dt * 2.6;
    if (drop.y < terrainHeight(drop.x, drop.z) + 0.2 || Math.abs(drop.x - leader.x) > 48 || Math.abs(drop.z - leader.z) > 48) {
      drop.x = leader.x + (Math.random() - 0.5) * 82;
      drop.z = leader.z + (Math.random() - 0.5) * 82;
      drop.y = leader.y + 12 + Math.random() * 28;
    }
    const idx = i * 6;
    rainArray[idx] = drop.x;
    rainArray[idx + 1] = drop.y;
    rainArray[idx + 2] = drop.z;
    rainArray[idx + 3] = drop.x - windDir.x * drop.length * 0.35;
    rainArray[idx + 4] = drop.y + drop.length;
    rainArray[idx + 5] = drop.z - windDir.z * drop.length * 0.35;
  }
  rainGeometry.attributes.position.needsUpdate = true;

  if (rainAmount > 0.32) weatherLabel.textContent = '薄雨 · 低雾';
  else if (cloudiness > 0.68) weatherLabel.textContent = '云幕 · 阴晴';
  else if (windStrength > 1.2) weatherLabel.textContent = '晴野 · 强风';
  else if (warmth > 0.45) weatherLabel.textContent = '暖阳 · 长风';
  else weatherLabel.textContent = '晴空 · 柔风';

  return { cloudiness, rainAmount, windStrength };
}

const composer = new EffectComposer(renderer);
composer.setPixelRatio(renderer.getPixelRatio());
const renderPass = new RenderPass(scene, camera);
const bokehPass = new BokehPass(scene, camera, {
  focus: 8.5,
  aperture: 0.000025,
  maxblur: 0,
  width: window.innerWidth,
  height: window.innerHeight,
});
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.58, 0.88);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bokehPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);

function updatePost(dt) {
  const focus = input.idleFocus;
  bokehPass.uniforms.focus.value = lerp(10.2, 5.3, focus);
  bokehPass.uniforms.aperture.value = lerp(0.000012, 0.00012, focus);
  bokehPass.uniforms.maxblur.value = lerp(0.0001, 0.0105, focus);
  bloomPass.strength = damp(bloomPass.strength, 0.16 + focus * 0.07 + clamp(input.speed / 25, 0, 0.08), 2.8, dt);
  focusCopy.classList.toggle('visible', focus > 0.62);
}

function updateSunTracking() {
  sun.target.position.set(leader.x, terrainHeight(leader.x, leader.z), leader.z);
  sun.position.set(leader.x - 48, leader.y + 64, leader.z + 22);
  sun.target.updateMatrixWorld();
}

function updateHud() {
  const shownSpeed = input.speed.toFixed(1);
  speedValue.textContent = shownSpeed;
  speedFill.style.width = `${clamp(input.speed / 19.5, 0, 1) * 100}%`;
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.04);
  const elapsed = clock.elapsedTime;
  updatePlayer(dt, elapsed);
  updateBloomWaves(dt);
  updatePetals(dt, elapsed);
  updateFlowers(dt);
  updateCamera(dt);
  updateWeather(dt, elapsed);
  updatePost(dt);
  updateSunTracking();
  updateHud();
  composer.render();
  requestAnimationFrame(animate);
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);
}

window.addEventListener('resize', onResize);

lookTarget.copy(leader).addScaledVector(heading, 3.5);
camera.position.copy(leader).add(new THREE.Vector3(0, 5.4, 10.8));
camera.lookAt(lookTarget);
updatePetals(0, 0);
updateFlowers(0);
requestAnimationFrame(animate);
