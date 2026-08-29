import * as THREE from 'three';
import { heightAt, WORLD_SIZE } from './world.js';

function petalGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.18);
  shape.bezierCurveTo(0.19, -0.11, 0.24, 0.09, 0, 0.27);
  shape.bezierCurveTo(-0.24, 0.09, -0.19, -0.11, 0, -0.18);
  const geometry = new THREE.ShapeGeometry(shape, 7);
  geometry.scale(0.72, 0.72, 0.72);
  return geometry;
}

export function createPetalFlock(scene, count = 42) {
  const geometry = petalGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.62,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const palette = ['#fff4ea', '#f6b8c5', '#ffd5aa', '#f0cde0', '#fff8c8', '#e9d9ff'];
  const petals = Array.from({ length: count }, (_, i) => ({
    phase: Math.random() * Math.PI * 2,
    orbit: 0.28 + Math.random() * 1.15,
    lift: (Math.random() - 0.5) * 1.0,
    spin: (Math.random() * 2 - 1) * (0.7 + Math.random() * 1.5),
    drift: Math.random() * 1.5,
    scale: 0.55 + Math.random() * 0.75,
    lag: i / count,
  }));
  petals.forEach((_, i) => mesh.setColorAt(i, new THREE.Color(palette[i % palette.length])));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const position = new THREE.Vector3(0, heightAt(0, 0) + 2.0, 0);
  const velocity = new THREE.Vector3();
  const direction = new THREE.Vector3(0, 0, -1);
  const desired = new THREE.Vector3();
  const dummy = new THREE.Object3D();
  let idleTime = 0;
  let speed = 0;

  const update = (dt, time, input, wind = 0.6) => {
    desired.set(
      (input.right ? 1 : 0) - (input.left ? 1 : 0),
      0,
      (input.back ? 1 : 0) - (input.forward ? 1 : 0),
    );

    const hasInput = desired.lengthSq() > 0.001;
    if (hasInput) {
      desired.normalize();
      direction.lerp(desired, 1 - Math.exp(-dt * 5.8)).normalize();
    }

    const maxSpeed = input.boost ? 8.6 : 5.6;
    const target = hasInput ? maxSpeed : 0;
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    const easedSpeed = THREE.MathUtils.lerp(horizontalSpeed, target, 1 - Math.exp(-dt * (hasInput ? 3.7 : 2.2)));
    velocity.x = direction.x * easedSpeed;
    velocity.z = direction.z * easedSpeed;

    if (hasInput) {
      const crossWind = Math.sin(time * 0.33 + position.z * 0.025) * 0.06 * wind;
      velocity.x += crossWind;
      velocity.z += Math.cos(time * 0.29 + position.x * 0.021) * 0.035 * wind;
    }

    position.x += velocity.x * dt;
    position.z += velocity.z * dt;
    const bound = WORLD_SIZE * 0.455;
    position.x = THREE.MathUtils.clamp(position.x, -bound, bound);
    position.z = THREE.MathUtils.clamp(position.z, -bound, bound);

    const targetY = heightAt(position.x, position.z) + 1.72 + Math.sin(time * 1.1) * 0.15 + Math.min(0.55, easedSpeed * 0.045);
    position.y = THREE.MathUtils.lerp(position.y, targetY, 1 - Math.exp(-dt * 5.1));

    speed = Math.hypot(velocity.x, velocity.z);
    if (speed < 0.14) idleTime += dt;
    else idleTime = 0;

    for (let i = 0; i < petals.length; i += 1) {
      const p = petals[i];
      const flutter = time * (1.3 + p.drift * 0.45) + p.phase;
      const along = (p.lag - 0.5) * 1.6 - Math.min(speed, 6) * p.lag * 0.055;
      const side = Math.sin(flutter * 0.83) * p.orbit;
      const up = Math.cos(flutter * 1.17) * 0.3 + p.lift + Math.sin(flutter * 2.1) * 0.12;
      const sideVecX = -direction.z;
      const sideVecZ = direction.x;

      dummy.position.set(
        position.x + direction.x * along + sideVecX * side,
        position.y + up,
        position.z + direction.z * along + sideVecZ * side,
      );
      dummy.rotation.set(
        Math.sin(flutter * 1.7) * 0.75,
        Math.atan2(direction.x, direction.z) + Math.sin(flutter) * 0.75,
        flutter * p.spin,
      );
      const s = p.scale * (0.9 + Math.sin(flutter * 1.91) * 0.08);
      dummy.scale.set(s * 0.9, s * 1.15, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  return {
    mesh,
    position,
    velocity,
    direction,
    update,
    get speed() { return speed; },
    get idleTime() { return idleTime; },
    get isIdle() { return idleTime > 1.0; },
  };
}
