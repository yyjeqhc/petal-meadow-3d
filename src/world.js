import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const WORLD_SIZE = 220;

export function heightAt(x, z) {
  const broad = Math.sin(x * 0.031) * 2.15 + Math.cos(z * 0.038) * 1.65;
  const crossing = Math.sin((x + z) * 0.019) * 2.55 + Math.cos((x - z) * 0.024) * 1.15;
  const soft = Math.sin(Math.hypot(x + 24, z - 18) * 0.055) * 0.55;
  return broad + crossing + soft - 1.0;
}

function seededNoise(x, z) {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function createTerrain(scene) {
  const geometry = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 150, 150);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color('#5b7e45');
  const mid = new THREE.Color('#77a957');
  const high = new THREE.Color('#9fc779');
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(x, z);
    pos.setY(i, y);
    const h = THREE.MathUtils.clamp((y + 5) / 11, 0, 1);
    c.copy(low).lerp(mid, Math.min(1, h * 1.25)).lerp(high, Math.max(0, h - 0.55) * 0.75);
    const variation = 0.90 + seededNoise(x * 0.4, z * 0.4) * 0.13;
    colors[i * 3] = c.r * variation;
    colors[i * 3 + 1] = c.g * variation;
    colors[i * 3 + 2] = c.b * variation;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.96,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const shadowGeometry = geometry.clone();
  const shadowPos = shadowGeometry.attributes.position;
  for (let i = 0; i < shadowPos.count; i += 1) shadowPos.setY(i, shadowPos.getY(i) + 0.045);

  const shadowUniforms = {
    uTime: { value: 0 },
    uCoverage: { value: 0.35 },
    uStrength: { value: 0.27 },
    uDrift: { value: new THREE.Vector2(0.9, 0.35) },
  };

  const shadowMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    uniforms: shadowUniforms,
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uCoverage;
      uniform float uStrength;
      uniform vec2 uDrift;
      varying vec3 vWorld;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.55;
        for (int i = 0; i < 4; i++) {
          v += noise(p) * a;
          p = p * 2.03 + 17.31;
          a *= 0.5;
        }
        return v;
      }
      void main() {
        vec2 p = vWorld.xz * 0.024 + uDrift * uTime * 0.035;
        float cloud = fbm(p) * 0.74 + fbm(p * 0.47 + 31.7) * 0.26;
        float threshold = mix(0.73, 0.46, uCoverage);
        float mask = smoothstep(threshold, threshold + 0.17, cloud);
        float feather = smoothstep(0.0, 11.0, 110.0 - max(abs(vWorld.x), abs(vWorld.z)));
        gl_FragColor = vec4(0.045, 0.075, 0.065, mask * uStrength * feather);
      }
    `,
  });

  const cloudShadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  cloudShadow.renderOrder = 2;
  scene.add(cloudShadow);

  return { terrain, cloudShadow, shadowUniforms };
}

export function createGrass(scene, count = 9000) {
  const vertsPerBlade = 6;
  const positions = new Float32Array(count * vertsPerBlade * 3);
  const lift = new Float32Array(count * vertsPerBlade);
  const origin = new Float32Array(count * vertsPerBlade * 2);
  const shade = new Float32Array(count * vertsPerBlade);

  let vp = 0;
  let lp = 0;
  let op = 0;
  const margin = WORLD_SIZE * 0.485;

  const push = (x, y, z, l, ox, oz, s) => {
    positions[vp++] = x;
    positions[vp++] = y;
    positions[vp++] = z;
    lift[lp++] = l;
    origin[op++] = ox;
    origin[op++] = oz;
    shade[lp - 1] = s;
  };

  for (let i = 0; i < count; i += 1) {
    const rx = (Math.random() * 2 - 1) * margin;
    const rz = (Math.random() * 2 - 1) * margin;
    const y = heightAt(rx, rz) + 0.035;
    const angle = Math.random() * Math.PI;
    const half = 0.025 + Math.random() * 0.032;
    const h = 0.42 + Math.random() * 0.72;
    const dx = Math.cos(angle) * half;
    const dz = Math.sin(angle) * half;
    const topScale = 0.18;
    const s = Math.random();

    const bl = [rx - dx, y, rz - dz];
    const br = [rx + dx, y, rz + dz];
    const tl = [rx - dx * topScale, y + h, rz - dz * topScale];
    const tr = [rx + dx * topScale, y + h, rz + dz * topScale];

    push(...bl, 0, rx, rz, s);
    push(...br, 0, rx, rz, s);
    push(...tr, 1, rx, rz, s);
    push(...bl, 0, rx, rz, s);
    push(...tr, 1, rx, rz, s);
    push(...tl, 1, rx, rz, s);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aLift', new THREE.BufferAttribute(lift, 1));
  geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 2));
  geometry.setAttribute('aShade', new THREE.BufferAttribute(shade, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uWind: { value: 0.62 },
    uWindDir: { value: new THREE.Vector2(0.92, 0.38).normalize() },
    uSun: { value: 1.0 },
  };

  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: true,
    uniforms,
    vertexShader: `
      uniform float uTime;
      uniform float uWind;
      uniform vec2 uWindDir;
      attribute float aLift;
      attribute vec2 aOrigin;
      attribute float aShade;
      varying float vLift;
      varying float vShade;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        float phase = dot(aOrigin, vec2(0.145, 0.103));
        float wave = sin(uTime * 2.05 + phase + aShade * 4.5)
                   + sin(uTime * 1.15 + phase * 0.47) * 0.42;
        float bend = wave * uWind * 0.34 * aLift * aLift;
        p.xz += uWindDir * bend;
        p.y -= abs(bend) * 0.055 * aLift;
        vLift = aLift;
        vShade = aShade;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      uniform float uSun;
      varying float vLift;
      varying float vShade;
      #include <fog_pars_fragment>
      void main() {
        vec3 base = mix(vec3(0.19, 0.37, 0.16), vec3(0.49, 0.69, 0.28), vLift);
        base *= 0.88 + vShade * 0.18;
        base *= 0.82 + uSun * 0.18;
        gl_FragColor = vec4(base, 1.0);
        #include <fog_fragment>
      }
    `,
  });

  const grass = new THREE.Mesh(geometry, material);
  grass.frustumCulled = false;
  grass.renderOrder = 1;
  scene.add(grass);
  return { grass, uniforms };
}

function createBloomGeometry() {
  const pieces = [];
  for (let i = 0; i < 5; i += 1) {
    const g = new THREE.CircleGeometry(0.105, 7);
    g.rotateX(-Math.PI / 2);
    g.scale(1.45, 1, 0.72);
    g.translate(0.095, 0, 0);
    g.rotateY((i / 5) * Math.PI * 2);
    pieces.push(g);
  }
  const center = new THREE.SphereGeometry(0.062, 7, 5);
  center.scale(1, 0.65, 1);
  pieces.push(center);
  const merged = mergeGeometries(pieces, false);
  pieces.forEach((g) => g.dispose());
  return merged;
}

export function createFlowerField(scene, maxCount = 1100) {
  const stemGeometry = new THREE.CylinderGeometry(0.018, 0.027, 0.52, 5, 1);
  stemGeometry.translate(0, 0.26, 0);
  const stemMaterial = new THREE.MeshStandardMaterial({ color: '#477c3b', roughness: 0.9 });
  const stems = new THREE.InstancedMesh(stemGeometry, stemMaterial, maxCount);
  stems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  stems.count = 0;

  const bloomGeometry = createBloomGeometry();
  const bloomMaterial = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.72,
    side: THREE.DoubleSide,
  });
  const blooms = new THREE.InstancedMesh(bloomGeometry, bloomMaterial, maxCount);
  blooms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blooms.count = 0;

  scene.add(stems, blooms);

  const entries = [];
  const dummy = new THREE.Object3D();
  const palette = ['#f6c0c9', '#f3df8f', '#eee7ff', '#ffb58f', '#f7f3cf', '#d5b5e8', '#ffffff'];

  const spawnPatch = (cx, cz, amount = 4) => {
    let added = 0;
    for (let n = 0; n < amount && entries.length < maxCount; n += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.32 + Math.random() * 1.7;
      const x = THREE.MathUtils.clamp(cx + Math.cos(angle) * radius, -WORLD_SIZE * 0.47, WORLD_SIZE * 0.47);
      const z = THREE.MathUtils.clamp(cz + Math.sin(angle) * radius, -WORLD_SIZE * 0.47, WORLD_SIZE * 0.47);
      const y = heightAt(x, z) + 0.04;
      const index = entries.length;
      const entry = {
        index,
        x, y, z,
        growth: 0.001,
        rot: Math.random() * Math.PI * 2,
        scale: 0.72 + Math.random() * 0.68,
        phase: Math.random() * Math.PI * 2,
      };
      entries.push(entry);
      stems.count = entries.length;
      blooms.count = entries.length;
      const color = new THREE.Color(palette[Math.floor(Math.random() * palette.length)]);
      blooms.setColorAt(index, color);
      added += 1;
    }
    if (blooms.instanceColor) blooms.instanceColor.needsUpdate = true;
    return added;
  };

  const update = (dt, time, wind = 0.6) => {
    for (const e of entries) {
      e.growth = Math.min(1, e.growth + dt * (0.42 + e.scale * 0.16));
      const g = 1 - Math.pow(1 - e.growth, 3);
      const sway = Math.sin(time * 1.5 + e.phase) * 0.035 * wind;

      dummy.position.set(e.x, e.y, e.z);
      dummy.rotation.set(sway, e.rot, sway * 0.55);
      dummy.scale.set(e.scale * (0.76 + g * 0.24), e.scale * g, e.scale * (0.76 + g * 0.24));
      dummy.updateMatrix();
      stems.setMatrixAt(e.index, dummy.matrix);

      const b = THREE.MathUtils.smoothstep(e.growth, 0.34, 0.96);
      dummy.position.set(e.x, e.y + 0.50 * e.scale * g, e.z);
      dummy.rotation.set(sway * 0.6, e.rot + time * 0.035, 0);
      dummy.scale.setScalar(e.scale * Math.max(0.001, b));
      dummy.updateMatrix();
      blooms.setMatrixAt(e.index, dummy.matrix);
    }
    if (entries.length) {
      stems.instanceMatrix.needsUpdate = true;
      blooms.instanceMatrix.needsUpdate = true;
    }
  };

  return {
    stems,
    blooms,
    entries,
    spawnPatch,
    update,
    get count() { return entries.length; },
  };
}
