import * as THREE from 'three';
import { heightAt } from './world.js';

export function createAtmosphere(scene) {
  const skyUniforms = {
    uTime: { value: 0 },
    uCloudCoverage: { value: 0.34 },
    uCloudDensity: { value: 0.7 },
    uCloudDarkness: { value: 0.18 },
    uWarmth: { value: 0.08 },
    uSunDir: { value: new THREE.Vector3(-0.45, 0.75, -0.28).normalize() },
  };

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(175, 40, 22),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: skyUniforms,
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
        uniform float uCloudCoverage;
        uniform float uCloudDensity;
        uniform float uCloudDarkness;
        uniform float uWarmth;
        uniform vec3 uSunDir;
        varying vec3 vWorld;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(i);
          float b = hash(i + vec2(1.0, 0.0));
          float c = hash(i + vec2(0.0, 1.0));
          float d = hash(i + vec2(1.0, 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          float a = 0.58;
          for (int i = 0; i < 3; i++) {
            v += noise(p) * a;
            p = p * 2.03 + vec2(12.7, 5.1);
            a *= 0.48;
          }
          return v;
        }

        void main() {
          vec3 ray = normalize(vWorld - cameraPosition);
          float h = clamp(ray.y * 0.72 + 0.38, 0.0, 1.0);
          vec3 horizon = mix(vec3(0.72, 0.87, 0.83), vec3(0.82, 0.76, 0.60), uWarmth);
          vec3 zenith = mix(vec3(0.26, 0.53, 0.68), vec3(0.36, 0.47, 0.62), uWarmth * 0.55);
          vec3 col = mix(horizon, zenith, smoothstep(0.0, 0.95, h));

          float sunDot = max(dot(ray, normalize(uSunDir)), 0.0);
          float sunGlow = pow(sunDot, 56.0) * 0.95 + pow(sunDot, 9.0) * 0.16;
          col += mix(vec3(1.0, 0.91, 0.68), vec3(1.0, 0.72, 0.42), uWarmth) * sunGlow;

          if (ray.y > 0.045) {
            float alpha = 0.0;
            vec3 cloudColor = mix(vec3(0.96, 0.98, 0.95), vec3(0.64, 0.69, 0.70), uCloudDarkness);
            float invY = 1.0 / max(ray.y, 0.12);
            for (int i = 0; i < 12; i++) {
              float fi = float(i) / 11.0;
              float layerY = mix(24.0, 63.0, fi);
              float dist = (layerY - cameraPosition.y) * invY;
              vec3 p = cameraPosition + ray * dist;
              vec2 drift = vec2(uTime * 0.85, uTime * 0.27);
              float n = fbm(p.xz * 0.014 + drift * 0.018 + fi * 3.7);
              n += noise(p.xz * 0.041 - drift * 0.012) * 0.18;
              float threshold = mix(0.88, 0.53, uCloudCoverage);
              float density = smoothstep(threshold, threshold + 0.16, n) * uCloudDensity;
              density *= smoothstep(0.0, 0.18, fi) * (1.0 - smoothstep(0.76, 1.0, fi));
              float stepAlpha = density * 0.23;
              float lighting = 0.76 + 0.24 * dot(normalize(vec3(-0.3, 1.0, -0.2)), normalize(uSunDir));
              vec3 sampleCol = cloudColor * lighting;
              col = mix(col, sampleCol, stepAlpha * (1.0 - alpha));
              alpha += stepAlpha * (1.0 - alpha);
            }
            float fade = smoothstep(0.045, 0.18, ray.y);
            col = mix(mix(horizon, zenith, h), col, fade);
          }

          float haze = 1.0 - smoothstep(0.02, 0.26, ray.y);
          col = mix(col, horizon * 1.04, haze * 0.18);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  sky.renderOrder = -100;
  scene.add(sky);

  scene.fog = new THREE.FogExp2(new THREE.Color('#9fc5b5'), 0.0135);

  const fogUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0.22 },
    uTint: { value: new THREE.Color('#d8e6dc') },
  };

  const fogMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: fogUniforms,
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uOpacity;
      uniform vec3 uTint;
      varying vec2 vUv;
      varying vec3 vWorld;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.7, 289.1))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
      }
      void main() {
        float vertical = sin(vUv.y * 3.14159265);
        float n = noise(vec2(vUv.x * 5.0 + uTime * 0.035, vWorld.z * 0.035 - uTime * 0.02));
        float wisps = smoothstep(0.28, 0.82, n) * vertical;
        float edge = smoothstep(0.02, 0.22, vUv.x) * smoothstep(0.02, 0.22, 1.0-vUv.x);
        gl_FragColor = vec4(uTint, wisps * edge * uOpacity * 0.46);
      }
    `,
  });

  const fogGroup = new THREE.Group();
  for (let i = 0; i < 11; i += 1) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(32 + Math.random() * 26, 2.2 + Math.random() * 1.8, 1, 1), fogMaterial);
    const a = Math.random() * Math.PI * 2;
    const r = 18 + Math.random() * 68;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    mesh.position.set(x, heightAt(x, z) + 0.8 + Math.random() * 1.1, z);
    mesh.rotation.y = a + Math.random() * 1.8;
    fogGroup.add(mesh);
  }
  fogGroup.renderOrder = 4;
  scene.add(fogGroup);

  const rainCount = 1500;
  const rainPositions = new Float32Array(rainCount * 3);
  const rainVelocity = new Float32Array(rainCount);
  for (let i = 0; i < rainCount; i += 1) {
    rainPositions[i * 3] = (Math.random() * 2 - 1) * 36;
    rainPositions[i * 3 + 1] = 4 + Math.random() * 24;
    rainPositions[i * 3 + 2] = (Math.random() * 2 - 1) * 36;
    rainVelocity[i] = 12 + Math.random() * 12;
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.PointsMaterial({
    color: '#dce9e8',
    size: 0.075,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const rain = new THREE.Points(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  scene.add(rain);

  const update = (dt, time, playerPosition, rainAmount, groundFogAmount) => {
    skyUniforms.uTime.value = time;
    fogUniforms.uTime.value = time;
    fogUniforms.uOpacity.value = groundFogAmount;
    sky.position.copy(playerPosition);

    const rainAlpha = THREE.MathUtils.clamp(rainAmount, 0, 1);
    rainMaterial.opacity = THREE.MathUtils.lerp(rainMaterial.opacity, rainAlpha * 0.66, 1 - Math.exp(-dt * 2.8));
    rain.visible = rainMaterial.opacity > 0.01;
    if (rain.visible) {
      const arr = rainGeometry.attributes.position.array;
      for (let i = 0; i < rainCount; i += 1) {
        const yi = i * 3 + 1;
        arr[yi] -= rainVelocity[i] * dt;
        const wx = arr[i * 3] + playerPosition.x;
        const wz = arr[i * 3 + 2] + playerPosition.z;
        if (arr[yi] + playerPosition.y < heightAt(wx, wz) + 0.4) {
          arr[i * 3] = (Math.random() * 2 - 1) * 36;
          arr[yi] = 14 + Math.random() * 18;
          arr[i * 3 + 2] = (Math.random() * 2 - 1) * 36;
        }
      }
      rainGeometry.attributes.position.needsUpdate = true;
      rain.position.copy(playerPosition);
      rain.position.y -= playerPosition.y;
    }

    fogGroup.rotation.y = Math.sin(time * 0.015) * 0.08;
  };

  return { sky, skyUniforms, fogUniforms, fogGroup, rain, update };
}
