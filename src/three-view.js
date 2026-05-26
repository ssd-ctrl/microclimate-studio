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

function toLocalPoint(point, origin) {
  return toLocal([point], origin)[0];
}

function polygonShape(THREE, points) {
  if (!points || points.length < 3) {
    return null;
  }
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.lineTo(points[0][0], points[0][1]);
  return shape;
}

function extrudePolygon(THREE, points, depth, material, y = 0) {
  const shape = polygonShape(THREE, points);
  if (!shape) {
    return null;
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function siteSlopePlane(THREE, boundaryLocal, slopePercent) {
  const box = new THREE.Box2();
  boundaryLocal.forEach(([x, z]) => box.expandByPoint(new THREE.Vector2(x, z)));
  const spanX = Math.max(30, box.max.x - box.min.x);
  const spanZ = Math.max(30, box.max.y - box.min.y);
  const size = Math.max(spanX, spanZ) * 1.6;

  const seg = 48;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  const slopeRatio = Math.max(0, Math.min(0.15, slopePercent / 100));
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const tilt = x * slopeRatio * 0.25;
    const micro = Math.sin(x * 0.02) * 0.25 + Math.cos(y * 0.019) * 0.22;
    pos.setZ(i, tilt + micro);
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0xd8d7c8, roughness: 0.92, metalness: 0.02 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

function addBoundaryEdge(THREE, boundaryLocal) {
  const points = boundaryLocal.map(([x, z]) => new THREE.Vector3(x, 0.25, z));
  points.push(new THREE.Vector3(boundaryLocal[0][0], 0.25, boundaryLocal[0][1]));
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x6c6b60 }));
  return line;
}

function zoneMaterial(THREE, kind) {
  if (kind === "vegetation") {
    return new THREE.MeshStandardMaterial({ color: 0x8fbe67, roughness: 0.98, metalness: 0.0, transparent: true, opacity: 0.9 });
  }
  if (kind === "hardscape") {
    return new THREE.MeshStandardMaterial({ color: 0xc7b59c, roughness: 0.82, metalness: 0.03, transparent: true, opacity: 0.92 });
  }
  return new THREE.MeshStandardMaterial({ color: 0x84b4c9, roughness: 0.55, metalness: 0.0, transparent: true, opacity: 0.88 });
}

function addFlowLines(THREE, flowLines, origin) {
  const group = new THREE.Group();
  flowLines.forEach((flow) => {
    const local = toLocal(flow.path, origin);
    const points = local.map(([x, z]) => new THREE.Vector3(x, 0.8, z));
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geo, new THREE.LineDashedMaterial({ color: 0x3d7597, dashSize: 2.5, gapSize: 2.0 }));
    line.computeLineDistances();
    group.add(line);
  });
  return group;
}

function addPlantInstances(THREE, suggestions, origin) {
  const group = new THREE.Group();
  suggestions.forEach((plant, i) => {
    const [x, z] = toLocalPoint(plant.coords, origin);
    const isCanopy = plant.type.includes("canopy") || plant.type.includes("tree");
    const trunkH = isCanopy ? 3.8 : 2.2;
    const crownR = isCanopy ? 4.2 : 2.4;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, trunkH, 10),
      new THREE.MeshStandardMaterial({ color: 0x6d4a2c, roughness: 0.95 })
    );
    trunk.position.set(x, trunkH / 2, z);
    trunk.castShadow = true;

    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(crownR, 14, 11),
      new THREE.MeshStandardMaterial({
        color: plant.suited ? 0x5f9e4d : 0x9e9755,
        roughness: 0.9,
        transparent: true,
        opacity: 0.92
      })
    );
    crown.position.set(x, trunkH + crownR * 0.72, z);
    crown.scale.y = 0.8 + (i % 3) * 0.1;
    crown.castShadow = true;

    group.add(trunk);
    group.add(crown);
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
  const elevation = Math.max(0.14, Math.sin(normalized * Math.PI) * 0.93);
  const radius = 320;
  sunLight.position.set(Math.cos(azimuth) * radius, 45 + elevation * 230, Math.sin(azimuth) * radius);
  sunLight.intensity = 0.45 + elevation * 0.75;
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

  const boundary = site.boundary && site.boundary.length >= 3 ? site.boundary : layout.siteBoundary;
  if (!boundary || boundary.length < 3) {
    throw new Error("No boundary geometry available for 3D view.");
  }
  const origin = boundary[0];
  const boundaryLocal = toLocal(boundary, origin);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe7e7dc);
  scene.fog = new THREE.Fog(0xe7e7dc, 220, 740);

  camera = new THREE.PerspectiveCamera(62, host.clientWidth / host.clientHeight, 0.1, 5000);
  camera.position.set(80, 95, 130);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  orbitControls = new orbitMod.OrbitControls(camera, renderer.domElement);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.07;
  orbitControls.maxPolarAngle = Math.PI * 0.48;

  pointerControls = new pointerMod.PointerLockControls(camera, renderer.domElement);

  renderer.domElement.addEventListener("click", () => {
    if (navMode === "walk") {
      pointerControls.lock();
    }
  });

  const ambient = new THREE.HemisphereLight(0xffffff, 0x5b5f50, 1.05);
  scene.add(ambient);

  sunLight = new THREE.DirectionalLight(0xfff4dd, 0.95);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  scene.add(sunLight);

  const terrain = siteSlopePlane(THREE, boundaryLocal, site.slopePercent || 2);
  scene.add(terrain);
  scene.add(addBoundaryEdge(THREE, boundaryLocal));

  layout.zones.forEach((zone) => {
    if (!zone.polygon) {
      return;
    }
    const poly = toLocal(zone.polygon, origin);
    const mat = zoneMaterial(THREE, zone.kind);
    const depth = zone.kind === "hardscape" ? 1.4 : zone.kind === "vegetation" ? 0.6 : 1.0;
    const y = zone.kind === "hardscape" ? 0.35 : 0.2;
    const mesh = extrudePolygon(THREE, poly, depth, mat, y);
    if (mesh) {
      scene.add(mesh);
    }
  });

  if (layout.flowLines?.length) {
    scene.add(addFlowLines(THREE, layout.flowLines, origin));
  }
  if (layout.plantSuggestions?.length) {
    scene.add(addPlantInstances(THREE, layout.plantSuggestions, origin));
  }

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 45);
  orbitControls.target.copy(center);
  camera.position.set(center.x + span * 0.95, center.y + span * 0.82, center.z + span * 0.95);
  orbitControls.minDistance = span * 0.45;
  orbitControls.maxDistance = span * 5.2;

  pointerControls.getObject().position.set(center.x, 1.8, center.z + Math.max(8, span * 0.2));

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
      velocity.normalize().multiplyScalar(1.0);
      pointerControls.moveForward(-velocity.z);
      pointerControls.moveRight(velocity.x);
      pointerControls.getObject().position.y = 1.8;
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
