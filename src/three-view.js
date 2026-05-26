const THREE_JS = "https://esm.sh/three@0.166.1";
const ORBIT_JS = "https://esm.sh/three@0.166.1/examples/jsm/controls/OrbitControls.js";
const POINTER_JS = "https://esm.sh/three@0.166.1/examples/jsm/controls/PointerLockControls.js";

let renderer;
let scene;
let camera;
let orbitControls;
let pointerControls;
let frameId;
let host;
let resizeHandler;
let sunLight;
let sunHourInput;
let navMode = "orbit";
let sunPlayback = false;
let currentHour = 12;
let keyState = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };

function toLocal(points, origin) {
  return points.map(([lat, lng]) => {
    const x = (lng - origin[1]) * 111320 * Math.cos((origin[0] * Math.PI) / 180);
    const z = (lat - origin[0]) * 110540;
    return [x, z];
  });
}

function createExtrudedMesh(THREE, points, depth, color, y = 0) {
  if (!points || points.length < 3) {
    return null;
  }
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.lineTo(points[0][0], points[0][1]);

  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.88 })
  );
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createTerrain(THREE) {
  const size = 1600;
  const seg = 90;
  const geometry = new THREE.PlaneGeometry(size, size, seg, seg);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const r = Math.hypot(x, y) / size;
    const wave = Math.sin(x * 0.015) * 1.4 + Math.cos(y * 0.02) * 1.1;
    const bowl = -8 * r;
    positions.setZ(i, wave + bowl);
  }
  geometry.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xbfd2bf, roughness: 0.9, metalness: 0.05 });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function createContextBuildings(THREE) {
  const group = new THREE.Group();
  const ringRadius = 520;
  for (let i = 0; i < 36; i += 1) {
    const a = (Math.PI * 2 * i) / 36;
    const x = Math.cos(a) * (ringRadius + (i % 5) * 35);
    const z = Math.sin(a) * (ringRadius + (i % 7) * 25);
    const h = 14 + (i % 9) * 7;
    const w = 20 + (i % 4) * 8;
    const d = 20 + (i % 6) * 7;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0xb8b7ae, roughness: 0.78 })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function addFlowLines(THREE, flowLines, origin) {
  const group = new THREE.Group();
  flowLines.forEach((flow) => {
    const local = toLocal(flow.path, origin);
    const points = local.map(([x, z]) => new THREE.Vector3(x, 2.3, z));
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x245a87 }));
    group.add(line);
  });
  return group;
}

function addPlantInstances(THREE, suggestions, origin) {
  const group = new THREE.Group();
  suggestions.forEach((plant, i) => {
    const [x, z] = toLocal([plant.coords], origin)[0];
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.8, 1, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x6e4a2f })
    );
    trunk.position.set(x, 2, z);
    trunk.castShadow = true;

    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(plant.type === "canopy" ? 6 : 3.6, plant.type === "canopy" ? 10 : 6, 10),
      new THREE.MeshStandardMaterial({ color: plant.suited ? 0x3b8c4f : 0x9f8f45 })
    );
    canopy.position.set(x, plant.type === "canopy" ? 9 : 6.2, z);
    canopy.castShadow = true;

    if (i % 3 === 0) {
      canopy.rotation.y = (i / 3) * 0.45;
    }

    group.add(trunk);
    group.add(canopy);
  });
  return group;
}

function updateSunPosition(hour) {
  if (!sunLight) {
    return;
  }
  currentHour = Number(hour);
  const normalized = (currentHour - 6) / 13;
  const azimuth = -Math.PI / 2 + normalized * Math.PI;
  const elevation = Math.max(0.12, Math.sin(normalized * Math.PI) * 0.95);
  const radius = 480;
  sunLight.position.set(
    Math.cos(azimuth) * radius,
    70 + elevation * 280,
    Math.sin(azimuth) * radius
  );
  sunLight.intensity = 0.35 + elevation * 0.85;
}

export function setSunHour(hour) {
  updateSunPosition(Number(hour));
}

export function setNavigationMode(mode) {
  navMode = mode === "walk" ? "walk" : "orbit";
  if (orbitControls) {
    orbitControls.enabled = navMode === "orbit";
  }
  if (pointerControls && navMode !== "walk" && pointerControls.isLocked) {
    pointerControls.unlock();
  }
}

export function toggleSunPlayback() {
  sunPlayback = !sunPlayback;
  return sunPlayback;
}

export async function openThreeDView({ site, layout }) {
  const [THREE, orbitMod, pointerMod] = await Promise.all([
    import(THREE_JS),
    import(ORBIT_JS),
    import(POINTER_JS)
  ]);

  host = document.getElementById("three-d-canvas");
  sunHourInput = document.getElementById("sun-hour");
  host.innerHTML = "";

  if (host.clientWidth < 10 || host.clientHeight < 10) {
    throw new Error("3D canvas has no size. Close and reopen 3D walkthrough.");
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd8e2d7);

  camera = new THREE.PerspectiveCamera(62, host.clientWidth / host.clientHeight, 0.1, 14000);
  camera.position.set(160, 210, 260);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  orbitControls = new orbitMod.OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.06;

  pointerControls = new pointerMod.PointerLockControls(camera, renderer.domElement);

  renderer.domElement.addEventListener("click", () => {
    if (navMode === "walk" && pointerControls) {
      pointerControls.lock();
    }
  });

  const hemi = new THREE.HemisphereLight(0xffffff, 0x4d5b4a, 1.0);
  scene.add(hemi);

  sunLight = new THREE.DirectionalLight(0xffffff, 0.82);
  sunLight.castShadow = true;
  scene.add(sunLight);

  scene.add(createTerrain(THREE));
  scene.add(createContextBuildings(THREE));

  const boundary = site.boundary && site.boundary.length >= 3 ? site.boundary : null;
  const origin = boundary ? boundary[0] : [site.latitude, site.longitude];

  layout.zones.forEach((zone) => {
    if (zone.polygon) {
      const poly = toLocal(zone.polygon, origin);
      const depth = zone.kind === "drainage" ? 2 : zone.kind === "hardscape" ? 7 : 4;
      const y = zone.kind === "drainage" ? 0.1 : 0.45;
      const color = Number(`0x${zone.color.replace("#", "")}`);
      const mesh = createExtrudedMesh(THREE, poly, depth, color, y);
      if (mesh) {
        scene.add(mesh);
      }
    }
  });

  if (layout.flowLines?.length) {
    scene.add(addFlowLines(THREE, layout.flowLines, origin));
  }

  if (layout.plantSuggestions?.length) {
    scene.add(addPlantInstances(THREE, layout.plantSuggestions, origin));
  }

  const bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 180);
  orbitControls.target.copy(center);
  camera.position.set(center.x + span * 0.65, 130 + span * 0.4, center.z + span * 0.65);

  if (pointerControls) {
    pointerControls.getObject().position.set(center.x, 2.2, center.z + 12);
  }

  updateSunPosition(Number(sunHourInput?.value || 12));
  sunPlayback = false;

  const onHourChange = () => updateSunPosition(Number(sunHourInput.value));
  sunHourInput?.addEventListener("input", onHourChange);

  const velocity = new THREE.Vector3();

  const animate = () => {
    if (sunPlayback) {
      const nextHour = currentHour >= 19 ? 6 : currentHour + 0.02;
      updateSunPosition(nextHour);
      if (sunHourInput) {
        sunHourInput.value = String(Math.round(nextHour));
      }
    }

    if (navMode === "walk" && pointerControls?.isLocked) {
      velocity.set(0, 0, 0);
      if (keyState.KeyW) velocity.z -= 1;
      if (keyState.KeyS) velocity.z += 1;
      if (keyState.KeyA) velocity.x -= 1;
      if (keyState.KeyD) velocity.x += 1;
      velocity.normalize().multiplyScalar(1.6);
      pointerControls.moveForward(-velocity.z);
      pointerControls.moveRight(velocity.x);
      pointerControls.getObject().position.y = 2.2;
    } else {
      orbitControls.update();
    }

    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };
  animate();

  const keyDown = (event) => {
    if (event.code in keyState) {
      keyState[event.code] = true;
    }
  };
  const keyUp = (event) => {
    if (event.code in keyState) {
      keyState[event.code] = false;
    }
  };
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);

  resizeHandler = () => {
    if (!renderer || !camera || !host) {
      return;
    }
    camera.aspect = host.clientWidth / host.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
  };

  window.addEventListener("resize", resizeHandler);
  renderer.domElement._sunHandler = onHourChange;
  renderer.domElement._keyDown = keyDown;
  renderer.domElement._keyUp = keyUp;

  setNavigationMode("orbit");
}

export function closeThreeDView() {
  if (frameId) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  sunPlayback = false;

  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }

  if (renderer?.domElement?._sunHandler && sunHourInput) {
    sunHourInput.removeEventListener("input", renderer.domElement._sunHandler);
  }
  if (renderer?.domElement?._keyDown) {
    window.removeEventListener("keydown", renderer.domElement._keyDown);
  }
  if (renderer?.domElement?._keyUp) {
    window.removeEventListener("keyup", renderer.domElement._keyUp);
  }

  if (pointerControls?.isLocked) {
    pointerControls.unlock();
  }

  if (orbitControls) {
    orbitControls.dispose();
    orbitControls = null;
  }

  if (renderer) {
    renderer.dispose();
    renderer = null;
  }

  scene = null;
  camera = null;
  sunLight = null;
  pointerControls = null;

  if (host) {
    host.innerHTML = "";
  }
}
