import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { BokehPass } from "three/addons/postprocessing/BokehPass.js";
import "./style.css";

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;
const isTouch = matchMedia("(pointer: coarse)").matches;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const canvas = document.querySelector("#scene");
const intro = document.querySelector("#intro");
const startButton = document.querySelector("#startButton");
const guide = document.querySelector("#guide");
const idleHint = document.querySelector("#idleHint");
const weatherButton = document.querySelector("#weatherButton");
const weatherIcon = document.querySelector("#weatherIcon");
const weatherText = document.querySelector("#weatherText");
const weatherName = document.querySelector("#weatherName");
const weatherDescription = document.querySelector("#weatherDescription");
const soundButton = document.querySelector("#soundButton");
const soundIcon = document.querySelector("#soundIcon");
const fullscreenButton = document.querySelector("#fullscreenButton");
const bloomCount = document.querySelector("#bloomCount");
const journeyProgress = document.querySelector("#journeyProgress");
const journeyPetal = document.querySelector("#journeyPetal");
const flash = document.querySelector("#flash");

const app = {
  playing: false,
  pointerDown: false,
  pointer: new THREE.Vector2(),
  pointerSmooth: new THREE.Vector2(),
  keyDirection: new THREE.Vector2(),
  lastInput: performance.now(),
  elapsed: 0,
  lastBlossomDistance: 0,
  totalDistance: 0,
  weatherIndex: 0,
  weatherTime: 0,
  soundEnabled: true,
  audio: null,
  firstMove: true,
  cinematic: 0,
  quality: Math.min(window.devicePixelRatio, isTouch ? 1.25 : 1.75),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xaecfc8);
scene.fog = new THREE.FogExp2(0xabc8b6, 0.009);

const camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.1, 520);
camera.position.set(0, 10.5, 24);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !isTouch,
  powerPreference: "high-performance",
  alpha: false,
});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(app.quality);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const clock = new THREE.Clock();
const world = new THREE.Group();
scene.add(world);

const skyUniforms = {
  uTop: { value: new THREE.Color(0x6aa6b1) },
  uHorizon: { value: new THREE.Color(0xe9e3c7) },
  uSun: { value: new THREE.Vector3(-0.45, 0.46, -0.76).normalize() },
  uSunColor: { value: new THREE.Color(0xfff2bc) },
  uWeather: { value: 0 },
};

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(360, 40, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSun;
      uniform vec3 uSunColor;
      uniform float uWeather;
      void main() {
        float h = smoothstep(-0.08, 0.82, vWorld.y);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.7));
        float sun = pow(max(dot(normalize(vWorld), normalize(uSun)), 0.0), 520.0);
        float halo = pow(max(dot(normalize(vWorld), normalize(uSun)), 0.0), 12.0);
        col += uSunColor * sun * 3.0 + uSunColor * halo * 0.22;
        col = mix(col, vec3(0.30, 0.39, 0.42), uWeather * (0.42 + h * 0.24));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  }),
);
scene.add(sky);

const hemisphereLight = new THREE.HemisphereLight(0xdceff0, 0x51623e, 2.2);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xffe9b2, 3.4);
sunLight.position.set(-55, 78, -48);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
sunLight.shadow.camera.left = -70;
sunLight.shadow.camera.right = 70;
sunLight.shadow.camera.top = 70;
sunLight.shadow.camera.bottom = -70;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 190;
sunLight.shadow.bias = -0.0008;
scene.add(sunLight);

const fillLight = new THREE.DirectionalLight(0xa9d3d1, 0.65);
fillLight.position.set(40, 30, 25);
scene.add(fillLight);

const shaderTime = { value: 0 };
const shaderWind = { value: 0.55 };
const shaderWeather = { value: 0 };

function fract(value) {
  return value - Math.floor(value);
}

function hash2(x, z) {
  return fract(Math.sin(x * 127.1 + z * 311.7) * 43758.5453);
}

function smoothNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function terrainHeight(x, z) {
  const rolling =
    Math.sin(x * 0.029) * 4.3 +
    Math.cos(z * 0.024 + 0.7) * 4.8 +
    Math.sin((x + z) * 0.017) * 3.8 +
    Math.cos(Math.hypot(x + 28, z - 18) * 0.054) * 2.1;
  const details = (smoothNoise(x * 0.052, z * 0.052) - 0.5) * 2.4;
  return rolling + details - 3.8;
}

function terrainNormal(x, z, target = new THREE.Vector3()) {
  const e = 0.35;
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  return target.set(hL - hR, e * 2, hD - hU).normalize();
}

const terrainSize = 240;
const terrainGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, 160, 160);
terrainGeometry.rotateX(-Math.PI / 2);
const terrainPositions = terrainGeometry.attributes.position;
const terrainColors = [];
const tempColor = new THREE.Color();
const lowGrass = new THREE.Color(0x496d40);
const highGrass = new THREE.Color(0x91a957);

for (let i = 0; i < terrainPositions.count; i += 1) {
  const x = terrainPositions.getX(i);
  const z = terrainPositions.getZ(i);
  const y = terrainHeight(x, z);
  terrainPositions.setY(i, y);
  const mix = clamp((y + 11) / 22 + (smoothNoise(x * 0.08, z * 0.08) - 0.5) * 0.16, 0, 1);
  tempColor.copy(lowGrass).lerp(highGrass, mix);
  terrainColors.push(tempColor.r, tempColor.g, tempColor.b);
}

terrainGeometry.setAttribute("color", new THREE.Float32BufferAttribute(terrainColors, 3));
terrainGeometry.computeVertexNormals();

const terrainMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.93,
  metalness: 0,
});

terrainMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = shaderTime;
  shader.uniforms.uWeather = shaderWeather;
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      `#include <common>
      varying vec3 vTerrainWorld;`,
    )
    .replace(
      "#include <worldpos_vertex>",
      `#include <worldpos_vertex>
      vTerrainWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
      varying vec3 vTerrainWorld;
      uniform float uTime;
      uniform float uWeather;
      float terrainHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
      }
      float terrainNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(terrainHash(i), terrainHash(i + vec2(1,0)), f.x),
                   mix(terrainHash(i + vec2(0,1)), terrainHash(i + vec2(1,1)), f.x), f.y);
      }
      float terrainFbm(vec2 p) {
        float n = 0.0;
        n += terrainNoise(p) * 0.58;
        n += terrainNoise(p * 2.03 + 7.1) * 0.28;
        n += terrainNoise(p * 4.07 + 13.8) * 0.14;
        return n;
      }`,
    )
    .replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec2 cloudUV = vTerrainWorld.xz * 0.018 + vec2(uTime * 0.016, uTime * 0.006);
      float cloudCover = smoothstep(0.48, 0.72, terrainFbm(cloudUV));
      float shadowAmount = mix(0.30, 0.18, uWeather);
      diffuseColor.rgb *= 1.0 - cloudCover * shadowAmount;
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.74,0.84,0.78), uWeather * 0.18);`,
    );
};

const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
terrain.receiveShadow = true;
world.add(terrain);

function createGrass() {
  const count = isTouch ? 11500 : 22500;
  const geometry = new THREE.InstancedBufferGeometry();
  const blade = new Float32Array([
    -0.075, 0, 0,
    0.075, 0, 0,
    -0.052, 0.56, 0,
    0.052, 0.56, 0,
    -0.012, 1, 0,
    0.012, 1, 0,
  ]);
  const indices = [0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5];
  geometry.setAttribute("position", new THREE.BufferAttribute(blade, 3));
  geometry.setIndex(indices);

  const offsets = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const phases = new Float32Array(count);
  const shades = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * TAU;
    const radius = Math.sqrt(Math.random()) * 114;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    offsets[i * 3] = x;
    offsets[i * 3 + 1] = terrainHeight(x, z) - 0.02;
    offsets[i * 3 + 2] = z;
    scales[i] = 0.55 + Math.random() * 1.15;
    phases[i] = Math.random() * TAU;
    shades[i] = Math.random();
  }
  geometry.setAttribute("aOffset", new THREE.InstancedBufferAttribute(offsets, 3));
  geometry.setAttribute("aScale", new THREE.InstancedBufferAttribute(scales, 1));
  geometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  geometry.setAttribute("aShade", new THREE.InstancedBufferAttribute(shades, 1));
  geometry.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    uniforms: {
      uTime: shaderTime,
      uWind: shaderWind,
      uWeather: shaderWeather,
      uFogColor: { value: new THREE.Color(0xabc8b6) },
      uFogDensity: { value: 0.009 },
    },
    vertexShader: `
      attribute vec3 aOffset;
      attribute float aScale;
      attribute float aPhase;
      attribute float aShade;
      uniform float uTime;
      uniform float uWind;
      varying float vHeight;
      varying float vShade;
      varying vec3 vWorld;
      varying float vFogDepth;
      void main() {
        vec3 p = position;
        p.x *= 0.72 + aScale * 0.28;
        p.y *= aScale;
        float wave = sin(uTime * 1.65 + aPhase + aOffset.x * 0.07 + aOffset.z * 0.035);
        float broad = sin(uTime * 0.72 + aOffset.x * 0.025 - aOffset.z * 0.018);
        float bend = (wave * 0.32 + broad * 0.24) * uWind * pow(p.y / max(aScale, 0.01), 1.6);
        p.x += bend;
        p.z += abs(bend) * 0.12;
        p += aOffset;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * world;
        vHeight = position.y;
        vShade = aShade;
        vWorld = world.xyz;
        vFogDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uWeather;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vHeight;
      varying float vShade;
      varying vec3 vWorld;
      varying float vFogDepth;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
      }
      float fbm(vec2 p) { return noise(p)*.6 + noise(p*2.05+8.2)*.27 + noise(p*4.1+3.7)*.13; }
      void main() {
        vec3 base = mix(vec3(0.09,0.25,0.075), vec3(0.38,0.54,0.16), vShade);
        base = mix(base * 0.67, base * 0.98, smoothstep(0.0, 1.0, vHeight));
        float clouds = smoothstep(.49,.73,fbm(vWorld.xz*.018+vec2(uTime*.016,uTime*.006)));
        base *= 1.0 - clouds * .25;
        base = mix(base, base * vec3(.72,.83,.78), uWeather*.22);
        float fogFactor = 1.0 - exp(-uFogDensity*uFogDensity*vFogDepth*vFogDepth);
        gl_FragColor = vec4(mix(base,uFogColor,clamp(fogFactor,0.0,1.0)),1.0);
      }
    `,
  });
  const grass = new THREE.Mesh(geometry, material);
  grass.frustumCulled = false;
  return { mesh: grass, material };
}

const grassSystem = createGrass();
world.add(grassSystem.mesh);

function createCloudTexture() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  const gradient = ctx.createRadialGradient(128, 128, 6, 128, 128, 126);
  gradient.addColorStop(0, "rgba(255,255,255,0.65)");
  gradient.addColorStop(0.34, "rgba(255,255,255,0.25)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const softTexture = createCloudTexture();
const clouds = new THREE.Group();
const cloudMaterial = new THREE.MeshStandardMaterial({
  color: 0xfffdf2,
  emissive: 0xf7f0d8,
  emissiveIntensity: 0.14,
  roughness: 1,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
});
const cloudShadeMaterial = cloudMaterial.clone();
cloudShadeMaterial.color.set(0xd7ded5);
cloudShadeMaterial.opacity = 0.42;
const cloudLobeGeometry = new THREE.IcosahedronGeometry(1, 2);

for (let c = 0; c < (isTouch ? 10 : 16); c += 1) {
  const cluster = new THREE.Group();
  const lobeCount = 7 + Math.floor(Math.random() * 5);
  for (let i = 0; i < lobeCount; i += 1) {
    const lobe = new THREE.Mesh(
      cloudLobeGeometry,
      i < 2 ? cloudShadeMaterial : cloudMaterial,
    );
    lobe.position.set(
      (i - lobeCount * 0.5) * 2.5 + (Math.random() - 0.5) * 3,
      Math.random() * 2.8,
      (Math.random() - 0.5) * 4,
    );
    lobe.scale.set(
      2.7 + Math.random() * 3.2,
      1.5 + Math.random() * 1.9,
      2.1 + Math.random() * 3.4,
    );
    cluster.add(lobe);
  }
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: softTexture,
      color: 0xfff7df,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.scale.set(28, 14, 1);
  glow.position.y = 1;
  cluster.add(glow);
  cluster.position.set(
    -120 + Math.random() * 240,
    25 + Math.random() * 21,
    -148 + Math.random() * 102,
  );
  cluster.scale.setScalar(0.65 + Math.random() * 0.7);
  cluster.userData.speed = 0.8 + Math.random() * 1.1;
  clouds.add(cluster);
}
// 保证开场取景里就有几层可辨认的云体，其他云簇继续随机铺满远空。
[
  [-5, 10.5, -55, 0.78],
  [32, 15, -92, 1.05],
  [-62, 22, -126, 1.55],
].forEach(([x, y, z, scale], index) => {
  const cloud = clouds.children[index];
  if (!cloud) return;
  cloud.position.set(x, y, z);
  cloud.scale.setScalar(scale);
});
world.add(clouds);

function createGroundMist() {
  const group = new THREE.Group();
  for (let i = 0; i < (isTouch ? 18 : 34); i += 1) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: softTexture,
        color: i % 3 === 0 ? 0xe6ead7 : 0xcbdccf,
        transparent: true,
        opacity: 0.075 + Math.random() * 0.08,
        depthWrite: false,
      }),
    );
    const angle = Math.random() * TAU;
    const radius = 18 + Math.random() * 105;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    sprite.position.set(x, terrainHeight(x, z) + 1.4 + Math.random() * 2.8, z);
    const size = 22 + Math.random() * 34;
    sprite.scale.set(size, size * (0.26 + Math.random() * 0.15), 1);
    sprite.userData.speed = 0.08 + Math.random() * 0.12;
    sprite.userData.origin = sprite.position.clone();
    group.add(sprite);
  }
  return group;
}

const mist = createGroundMist();
world.add(mist);

const rainCount = isTouch ? 900 : 1800;
const rainGeometry = new THREE.BufferGeometry();
const rainPositions = new Float32Array(rainCount * 3);
for (let i = 0; i < rainCount; i += 1) {
  rainPositions[i * 3] = (Math.random() - 0.5) * 90;
  rainPositions[i * 3 + 1] = Math.random() * 42;
  rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
}
rainGeometry.setAttribute("position", new THREE.BufferAttribute(rainPositions, 3));
const rain = new THREE.Points(
  rainGeometry,
  new THREE.PointsMaterial({
    color: 0xdceef0,
    size: 0.065,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
rain.visible = true;
world.add(rain);

function createPetalGeometry() {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const uvs = [];
  const cols = 4;
  const rows = 5;
  for (let y = 0; y < rows; y += 1) {
    const v = y / (rows - 1);
    const width = Math.sin(v * Math.PI) * 0.46 * (0.7 + v * 0.3);
    for (let x = 0; x < cols; x += 1) {
      const u = x / (cols - 1);
      positions.push(
        (u - 0.5) * width * 2,
        (v - 0.45) * 1.18,
        Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.12,
      );
      uvs.push(u, v);
    }
  }
  const indices = [];
  for (let y = 0; y < rows - 1; y += 1) {
    for (let x = 0; x < cols - 1; x += 1) {
      const a = y * cols + x;
      indices.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.translate(0, 0.2, 0);
  return geometry;
}

const petalCount = isTouch ? 95 : 150;
const petalMaterial = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.68,
  metalness: 0,
  side: THREE.DoubleSide,
  vertexColors: true,
  emissive: 0xffeee5,
  emissiveIntensity: 0.62,
});
const petals = new THREE.InstancedMesh(createPetalGeometry(), petalMaterial, petalCount);
petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
petals.castShadow = true;
petals.frustumCulled = false;
world.add(petals);

const leader = {
  position: new THREE.Vector3(0, terrainHeight(0, 12) + 5.3, 12),
  previous: new THREE.Vector3(0, terrainHeight(0, 12) + 5.3, 12),
  velocity: new THREE.Vector3(0, 0, -2),
  heading: new THREE.Vector3(0, 0, -1),
};

const petalData = [];
const petalPalette = [0xfff6dd, 0xffddd1, 0xf7e8d2, 0xffeee2, 0xffd2c0];
for (let i = 0; i < petalCount; i += 1) {
  petalData.push({
    radius: 0.45 + Math.pow(Math.random(), 1.7) * 5.5,
    angle: Math.random() * TAU,
    y: (Math.random() - 0.35) * 3.8,
    speed: 0.35 + Math.random() * 1.1,
    scale: 0.19 + Math.random() * 0.28,
    spin: Math.random() * TAU,
    tilt: Math.random() * TAU,
  });
  petals.setColorAt(i, new THREE.Color(petalPalette[i % petalPalette.length]));
}
petals.instanceColor.needsUpdate = true;

const flowerLimit = isTouch ? 320 : 560;
const flowerData = [];
const flowerPalette = [
  new THREE.Color(0xfff1b4),
  new THREE.Color(0xf8a998),
  new THREE.Color(0xf9d7d0),
  new THREE.Color(0xffeee0),
  new THREE.Color(0xd9b1d5),
  new THREE.Color(0xf6c95f),
];
const stemGeometry = new THREE.CylinderGeometry(0.035, 0.05, 1, 5);
stemGeometry.translate(0, 0.5, 0);
const petalFlowerGeometry = new THREE.SphereGeometry(0.18, 7, 5);
petalFlowerGeometry.scale(1, 0.32, 1.65);
const centerGeometry = new THREE.SphereGeometry(0.12, 7, 5);
const flowerStemMesh = new THREE.InstancedMesh(
  stemGeometry,
  new THREE.MeshStandardMaterial({ color: 0x416f34, roughness: 0.9 }),
  flowerLimit,
);
const flowerPetalMesh = new THREE.InstancedMesh(
  petalFlowerGeometry,
  new THREE.MeshBasicMaterial({
    color: 0xffd8c7,
    side: THREE.DoubleSide,
  }),
  flowerLimit * 5,
);
const flowerCenterMesh = new THREE.InstancedMesh(
  centerGeometry,
  new THREE.MeshStandardMaterial({ color: 0xf2a926, roughness: 0.72 }),
  flowerLimit,
);
flowerStemMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
flowerPetalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
flowerCenterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
flowerStemMesh.count = 0;
flowerPetalMesh.count = 0;
flowerCenterMesh.count = 0;
flowerStemMesh.castShadow = true;
flowerPetalMesh.castShadow = true;
flowerCenterMesh.castShadow = true;
world.add(flowerStemMesh, flowerPetalMesh, flowerCenterMesh);

function addFlower(x, z, delay = 0) {
  if (flowerData.length >= flowerLimit) return;
  const ground = terrainHeight(x, z);
  flowerData.push({
    x,
    z,
    y: ground,
    age: -delay,
    height: 0.65 + Math.random() * 0.85,
    size: 0.65 + Math.random() * 0.7,
    rotation: Math.random() * TAU,
    color: flowerPalette[Math.floor(Math.random() * flowerPalette.length)],
    sway: Math.random() * TAU,
  });
}

for (let ring = 0; ring < 4; ring += 1) {
  const count = 9 + ring * 4;
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * TAU + ring * 0.7;
    const r = 4 + ring * 2.4 + Math.random() * 1.8;
    addFlower(Math.cos(a) * r, 12 + Math.sin(a) * r, ring * 0.05 + Math.random() * 0.3);
  }
}

function scatterFlowersAlongPath() {
  const side = new THREE.Vector3(-leader.heading.z, 0, leader.heading.x);
  const number = app.totalDistance > 120 ? 4 : 3;
  for (let i = 0; i < number; i += 1) {
    const lateral = (Math.random() - 0.5) * 5.2;
    const back = Math.random() * 2.4 + 0.7;
    const x = leader.position.x + side.x * lateral - leader.heading.x * back;
    const z = leader.position.z + side.z * lateral - leader.heading.z * back;
    addFlower(x, z, Math.random() * 0.3);
  }
}

const flowerDummy = new THREE.Object3D();
const flowerQuat = new THREE.Quaternion();
const flowerAxis = new THREE.Vector3(0, 1, 0);

function updateFlowers(dt, time) {
  flowerStemMesh.count = flowerData.length;
  flowerCenterMesh.count = flowerData.length;
  flowerPetalMesh.count = flowerData.length * 5;

  flowerData.forEach((flower, index) => {
    flower.age += dt;
    const grow = clamp(flower.age / 1.5, 0, 1);
    const spring = grow === 1 ? 1 : 1 - Math.cos(grow * Math.PI * 3) * (1 - grow) * 0.09;
    const scale = THREE.MathUtils.smootherstep(grow, 0, 1) * spring;
    const swayX = Math.sin(time * 1.6 + flower.sway) * 0.06 * shaderWind.value;
    const swayZ = Math.cos(time * 1.25 + flower.sway) * 0.045 * shaderWind.value;

    flowerDummy.position.set(flower.x, flower.y, flower.z);
    flowerDummy.rotation.set(swayZ, flower.rotation, swayX);
    flowerDummy.scale.set(scale, flower.height * scale, scale);
    flowerDummy.updateMatrix();
    flowerStemMesh.setMatrixAt(index, flowerDummy.matrix);

    const topY = flower.y + flower.height * scale;
    flowerDummy.position.set(flower.x + swayX * flower.height, topY, flower.z + swayZ * flower.height);
    flowerDummy.rotation.set(0, flower.rotation, 0);
    flowerDummy.scale.setScalar(scale * flower.size);
    flowerDummy.updateMatrix();
    flowerCenterMesh.setMatrixAt(index, flowerDummy.matrix);

    for (let p = 0; p < 5; p += 1) {
      const angle = flower.rotation + (p / 5) * TAU;
      const petalIndex = index * 5 + p;
      flowerDummy.position.set(
        flower.x + Math.cos(angle) * 0.21 * flower.size * scale + swayX * flower.height,
        topY + 0.025,
        flower.z + Math.sin(angle) * 0.21 * flower.size * scale + swayZ * flower.height,
      );
      flowerQuat.setFromAxisAngle(flowerAxis, -angle);
      flowerDummy.quaternion.copy(flowerQuat);
      flowerDummy.rotation.x = 0.12;
      flowerDummy.scale.setScalar(scale * flower.size);
      flowerDummy.updateMatrix();
      flowerPetalMesh.setMatrixAt(petalIndex, flowerDummy.matrix);
    }
  });

  flowerStemMesh.instanceMatrix.needsUpdate = true;
  flowerCenterMesh.instanceMatrix.needsUpdate = true;
  flowerPetalMesh.instanceMatrix.needsUpdate = true;
}

const farPollenCount = isTouch ? 250 : 520;
const pollenGeometry = new THREE.BufferGeometry();
const pollenPositions = new Float32Array(farPollenCount * 3);
const pollenSeeds = new Float32Array(farPollenCount);
for (let i = 0; i < farPollenCount; i += 1) {
  pollenPositions[i * 3] = (Math.random() - 0.5) * 100;
  pollenPositions[i * 3 + 1] = Math.random() * 18;
  pollenPositions[i * 3 + 2] = (Math.random() - 0.5) * 100;
  pollenSeeds[i] = Math.random();
}
pollenGeometry.setAttribute("position", new THREE.BufferAttribute(pollenPositions, 3));
const pollen = new THREE.Points(
  pollenGeometry,
  new THREE.PointsMaterial({
    color: 0xffedb4,
    size: isTouch ? 0.08 : 0.11,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
world.add(pollen);

const weatherModes = [
  {
    name: "晴风",
    icon: "☀",
    description: "云影正掠过山丘",
    weather: 0,
    wind: 0.6,
    fog: 0.0085,
    exposure: 1.08,
    sun: 3.4,
    rain: 0,
  },
  {
    name: "漫云",
    icon: "◒",
    description: "柔光落进草木之间",
    weather: 0.48,
    wind: 0.82,
    fog: 0.011,
    exposure: 0.98,
    sun: 2.4,
    rain: 0,
  },
  {
    name: "太阳雨",
    icon: "☂",
    description: "雨丝在阳光中闪烁",
    weather: 0.82,
    wind: 1.08,
    fog: 0.014,
    exposure: 0.91,
    sun: 1.65,
    rain: 0.72,
  },
  {
    name: "雨后",
    icon: "✦",
    description: "薄雾正从低谷升起",
    weather: 0.28,
    wind: 0.42,
    fog: 0.013,
    exposure: 1.14,
    sun: 3.0,
    rain: 0,
  },
];

let weatherTargets = { ...weatherModes[0] };

function setWeather(index, fromAuto = false) {
  app.weatherIndex = (index + weatherModes.length) % weatherModes.length;
  app.weatherTime = 0;
  weatherTargets = { ...weatherModes[app.weatherIndex] };
  weatherIcon.textContent = weatherTargets.icon;
  weatherText.textContent = weatherTargets.name;
  weatherName.textContent = weatherTargets.name;
  weatherDescription.textContent = weatherTargets.description;
  if (!fromAuto) {
    flash.classList.remove("is-flashing");
    void flash.offsetWidth;
    flash.classList.add("is-flashing");
  }
}

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  0.26,
  0.45,
  0.83,
);
composer.addPass(bloomPass);
const bokehPass = new BokehPass(scene, camera, {
  focus: 18,
  aperture: 0.00001,
  maxblur: 0.002,
  width: innerWidth,
  height: innerHeight,
});
composer.addPass(bokehPass);

let audioContext;
let masterGain;

function createAmbientAudio() {
  if (audioContext) {
    audioContext.resume();
    return;
  }
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioContext.createGain();
  masterGain.gain.value = 0.16;
  masterGain.connect(audioContext.destination);

  const bufferSize = audioContext.sampleRate * 2;
  const noiseBuffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bufferSize; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.985 + white * 0.015;
    data[i] = last * 3.1;
  }
  const wind = audioContext.createBufferSource();
  wind.buffer = noiseBuffer;
  wind.loop = true;
  const windFilter = audioContext.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 820;
  const windGain = audioContext.createGain();
  windGain.gain.value = 0.18;
  wind.connect(windFilter).connect(windGain).connect(masterGain);
  wind.start();

  [174.61, 220, 261.63].forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency / 2;
    filter.type = "lowpass";
    filter.frequency.value = 600;
    gain.gain.value = 0.014 / (index + 1);
    oscillator.connect(filter).connect(gain).connect(masterGain);
    oscillator.start();
  });
}

function toggleSound() {
  app.soundEnabled = !app.soundEnabled;
  soundIcon.textContent = app.soundEnabled ? "♪" : "×";
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.linearRampToValueAtTime(app.soundEnabled ? 0.16 : 0, audioContext.currentTime + 0.35);
  } else if (app.soundEnabled && app.playing) {
    createAmbientAudio();
  }
}

function startExperience() {
  if (app.playing) return;
  app.playing = true;
  intro.classList.add("is-hidden");
  document.body.classList.add("is-playing");
  if (app.soundEnabled) createAmbientAudio();
  setTimeout(() => guide.classList.add("is-hidden"), 7000);
}

startButton.addEventListener("click", startExperience);
soundButton.addEventListener("click", toggleSound);
weatherButton.addEventListener("click", () => setWeather(app.weatherIndex + 1));
fullscreenButton.addEventListener("click", async () => {
  if (!document.fullscreenElement) {
    await document.documentElement.requestFullscreen?.();
  } else {
    await document.exitFullscreen?.();
  }
});

function updatePointer(event) {
  app.pointer.x = (event.clientX / innerWidth) * 2 - 1;
  app.pointer.y = -((event.clientY / innerHeight) * 2 - 1);
  app.lastInput = performance.now();
}

canvas.addEventListener("pointerdown", (event) => {
  if (!app.playing) return;
  app.pointerDown = true;
  canvas.classList.add("is-grabbing");
  canvas.setPointerCapture?.(event.pointerId);
  updatePointer(event);
  if (app.firstMove) {
    app.firstMove = false;
    guide.classList.add("is-hidden");
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (app.pointerDown) updatePointer(event);
});
canvas.addEventListener("pointerup", () => {
  app.pointerDown = false;
  canvas.classList.remove("is-grabbing");
  app.lastInput = performance.now();
});
canvas.addEventListener("pointercancel", () => {
  app.pointerDown = false;
  canvas.classList.remove("is-grabbing");
});

const keys = new Set();
window.addEventListener("keydown", (event) => {
  if (["w", "a", "s", "d", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"].includes(event.key)) {
    event.preventDefault();
    keys.add(event.key);
    app.lastInput = performance.now();
    if (app.firstMove) {
      app.firstMove = false;
      guide.classList.add("is-hidden");
    }
  }
});
window.addEventListener("keyup", (event) => keys.delete(event.key));

function updateInput() {
  app.keyDirection.set(0, 0);
  if (keys.has("a") || keys.has("ArrowLeft")) app.keyDirection.x -= 1;
  if (keys.has("d") || keys.has("ArrowRight")) app.keyDirection.x += 1;
  if (keys.has("w") || keys.has("ArrowUp")) app.keyDirection.y += 1;
  if (keys.has("s") || keys.has("ArrowDown")) app.keyDirection.y -= 1;
  if (app.keyDirection.lengthSq() > 0) app.keyDirection.normalize();
  app.pointerSmooth.lerp(app.pointer, 0.055);
}

function updateLeader(dt, time) {
  leader.previous.copy(leader.position);
  const inputActive = app.pointerDown || app.keyDirection.lengthSq() > 0;
  const steer = new THREE.Vector2();
  if (app.pointerDown) steer.copy(app.pointerSmooth);
  if (app.keyDirection.lengthSq() > 0) steer.copy(app.keyDirection);

  const forward = leader.heading.clone();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const desiredHeading = forward
    .clone()
    .multiplyScalar(1.1)
    .addScaledVector(right, steer.x * 1.6);
  desiredHeading.y = 0;
  desiredHeading.normalize();
  leader.heading.lerp(desiredHeading, 1 - Math.exp(-dt * 2.5)).normalize();

  const speed = inputActive ? 8.6 + Math.max(0, steer.y) * 4 : 2.15;
  const targetVelocity = leader.heading.clone().multiplyScalar(speed);
  leader.velocity.lerp(targetVelocity, 1 - Math.exp(-dt * (inputActive ? 2.8 : 1.35)));
  leader.position.addScaledVector(leader.velocity, dt);

  const bound = 94;
  const r = Math.hypot(leader.position.x, leader.position.z);
  if (r > bound) {
    const inward = new THREE.Vector3(-leader.position.x, 0, -leader.position.z).normalize();
    leader.heading.lerp(inward, 0.04).normalize();
    leader.position.x = clamp(leader.position.x, -bound, bound);
    leader.position.z = clamp(leader.position.z, -bound, bound);
  }

  const groundY = terrainHeight(leader.position.x, leader.position.z);
  const targetY = groundY + 4.2 + steer.y * 3.1 + Math.sin(time * 1.8) * 0.28;
  leader.position.y = lerp(leader.position.y, targetY, 1 - Math.exp(-dt * 2.6));

  const moved = leader.position.distanceTo(leader.previous);
  app.totalDistance += moved;
  app.lastBlossomDistance += moved;
  if (app.lastBlossomDistance > 1.35 && inputActive) {
    app.lastBlossomDistance = 0;
    scatterFlowersAlongPath();
  }
}

const petalDummy = new THREE.Object3D();
function updatePetals(time) {
  const movementBoost = app.pointerDown || app.keyDirection.lengthSq() ? 1 : 0.45;
  for (let i = 0; i < petalCount; i += 1) {
    const p = petalData[i];
    const angle = p.angle + time * p.speed * movementBoost;
    const pulse = 0.76 + Math.sin(time * 1.7 + p.angle * 3.2) * 0.24;
    const trail = (i / petalCount) * 5.8;
    const x = Math.cos(angle) * p.radius * pulse;
    const z = Math.sin(angle * 0.83) * p.radius * 0.56;
    const side = new THREE.Vector3(-leader.heading.z, 0, leader.heading.x);
    petalDummy.position
      .copy(leader.position)
      .addScaledVector(side, x)
      .addScaledVector(leader.heading, z - trail * 0.28);
    petalDummy.position.y += p.y + Math.sin(time * 2.1 + p.angle * 4) * 0.48;
    petalDummy.rotation.set(
      p.tilt + Math.sin(time * 1.5 + p.angle) * 0.8,
      -Math.atan2(leader.heading.z, leader.heading.x) + Math.PI / 2 + angle * 0.12,
      p.spin + time * (0.55 + p.speed) + Math.cos(angle) * 0.6,
    );
    const scale = p.scale * (0.88 + Math.sin(time * 2.4 + p.angle) * 0.12);
    petalDummy.scale.set(scale, scale * 1.2, scale);
    petalDummy.updateMatrix();
    petals.setMatrixAt(i, petalDummy.matrix);
  }
  petals.instanceMatrix.needsUpdate = true;
}

function updateCamera(dt, time) {
  const idleSeconds = (performance.now() - app.lastInput) / 1000;
  const idle = app.playing && !app.pointerDown && keys.size === 0 && idleSeconds > 3.2;
  const targetCinematic = idle ? 1 : 0;
  app.cinematic = lerp(app.cinematic, targetCinematic, 1 - Math.exp(-dt * (idle ? 0.65 : 2.6)));
  document.body.classList.toggle("is-cinematic", app.cinematic > 0.52);
  idleHint.classList.toggle("is-visible", idleSeconds > 5.5 && app.cinematic > 0.72);

  const side = new THREE.Vector3(-leader.heading.z, 0, leader.heading.x);
  const followDistance = lerp(17, 7.2, app.cinematic);
  const followHeight = lerp(7.8, 3.4, app.cinematic);
  const desired = leader.position
    .clone()
    .addScaledVector(leader.heading, -followDistance)
    .addScaledVector(side, Math.sin(time * 0.17) * 1.2)
    .add(new THREE.Vector3(0, followHeight, 0));

  camera.position.lerp(desired, 1 - Math.exp(-dt * (app.cinematic > 0.1 ? 1.15 : 2.3)));
  const lookAt = leader.position
    .clone()
    .addScaledVector(leader.heading, lerp(5.2, 0.8, app.cinematic))
    .add(new THREE.Vector3(0, lerp(0.4, -0.15, app.cinematic), 0));
  camera.lookAt(lookAt);
  camera.fov = lerp(camera.fov, lerp(48, 39, app.cinematic), 1 - Math.exp(-dt * 1.2));
  camera.updateProjectionMatrix();

  if (bokehPass.uniforms) {
    bokehPass.uniforms.focus.value = lerp(20, 7.5, app.cinematic);
    bokehPass.uniforms.aperture.value = lerp(0.000005, isTouch ? 0.000055 : 0.000095, app.cinematic);
    bokehPass.uniforms.maxblur.value = lerp(0.001, isTouch ? 0.009 : 0.014, app.cinematic);
  }
  // 景深只在镜头进入停驻状态后启用，正常游玩时保留清晰度和帧率。
  bokehPass.enabled = app.cinematic > 0.025;
}

function updateWeather(dt) {
  app.weatherTime += dt;
  if (app.playing && app.weatherTime > 43) setWeather(app.weatherIndex + 1, true);

  shaderWeather.value = lerp(shaderWeather.value, weatherTargets.weather, 1 - Math.exp(-dt * 0.32));
  shaderWind.value = lerp(shaderWind.value, weatherTargets.wind, 1 - Math.exp(-dt * 0.42));
  scene.fog.density = lerp(scene.fog.density, weatherTargets.fog, 1 - Math.exp(-dt * 0.3));
  renderer.toneMappingExposure = lerp(
    renderer.toneMappingExposure,
    weatherTargets.exposure,
    1 - Math.exp(-dt * 0.3),
  );
  sunLight.intensity = lerp(sunLight.intensity, weatherTargets.sun, 1 - Math.exp(-dt * 0.32));
  rain.material.opacity = lerp(rain.material.opacity, weatherTargets.rain, 1 - Math.exp(-dt * 0.7));
  skyUniforms.uWeather.value = shaderWeather.value;
  grassSystem.material.uniforms.uFogDensity.value = scene.fog.density;
  grassSystem.material.uniforms.uFogColor.value.copy(scene.fog.color);
  cloudMaterial.opacity = lerp(0.72, 0.96, shaderWeather.value);
}

function updateWorld(dt, time) {
  clouds.children.forEach((cloud, index) => {
    cloud.position.x += dt * cloud.userData.speed * shaderWind.value;
    cloud.position.z += Math.sin(time * 0.07 + index) * dt * 0.12;
    if (cloud.position.x > 135) cloud.position.x = -135;
  });

  mist.children.forEach((sprite, index) => {
    sprite.position.x += dt * sprite.userData.speed * shaderWind.value;
    sprite.position.y += Math.sin(time * 0.18 + index * 1.7) * dt * 0.045;
    if (sprite.position.x - sprite.userData.origin.x > 22) {
      sprite.position.x = sprite.userData.origin.x - 22;
    }
    sprite.material.opacity =
      (0.07 + (index % 5) * 0.012) * (1 + shaderWeather.value * 1.5);
  });

  rain.position.set(leader.position.x, leader.position.y - 8, leader.position.z);
  const rainArray = rain.geometry.attributes.position.array;
  for (let i = 0; i < rainCount; i += 1) {
    rainArray[i * 3 + 1] -= dt * (18 + (i % 7) * 1.8);
    rainArray[i * 3] += dt * shaderWind.value * 2.4;
    if (rainArray[i * 3 + 1] < -4) {
      rainArray[i * 3 + 1] = 38 + Math.random() * 8;
      rainArray[i * 3] = (Math.random() - 0.5) * 90;
      rainArray[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
  }
  rain.geometry.attributes.position.needsUpdate = true;

  const pollenArray = pollen.geometry.attributes.position.array;
  for (let i = 0; i < farPollenCount; i += 1) {
    pollenArray[i * 3] += dt * (0.08 + pollenSeeds[i] * 0.18) * shaderWind.value;
    pollenArray[i * 3 + 1] += Math.sin(time * 0.5 + pollenSeeds[i] * 14) * dt * 0.12;
    if (pollenArray[i * 3] > 50) pollenArray[i * 3] = -50;
  }
  pollen.position.set(leader.position.x, leader.position.y - 7, leader.position.z);
  pollen.geometry.attributes.position.needsUpdate = true;
}

function updateHud() {
  const flowers = flowerData.length;
  bloomCount.textContent = String(flowers).padStart(3, "0");
  const progress = clamp((flowers / flowerLimit) * 100, 4, 100);
  journeyProgress.style.width = `${progress}%`;
  journeyPetal.style.left = `${progress}%`;
}

function animate() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.05);
  app.elapsed += dt;
  shaderTime.value = app.elapsed;

  updateInput();
  if (app.playing && !reducedMotion) updateLeader(dt, app.elapsed);
  updatePetals(app.elapsed);
  updateFlowers(dt, app.elapsed);
  updateCamera(dt, app.elapsed);
  updateWeather(dt);
  updateWorld(dt, app.elapsed);
  updateHud();

  composer.render();
}

renderer.setAnimationLoop(animate);

window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(app.quality);
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && audioContext) audioContext.suspend();
  if (!document.hidden && app.soundEnabled && audioContext) audioContext.resume();
});

setWeather(0, true);
