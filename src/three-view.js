const THREE_JS = "https://cdn.jsdelivr.net/npm/three@0.166.1/build/three.module.js";
const ORBIT_JS = "https://cdn.jsdelivr.net/npm/three@0.166.1/examples/jsm/controls/OrbitControls.js?module";

let renderer;
let scene;
let camera;
let controls;
let frameId;
let host;
let resizeHandler;
let sunLight;
let sunHourInput;

function toLocal(points, origin) {
  return points.map(([lat, lng]) => {
    const x = (lng - origin[1]) * 111320 * Math.cos((origin[0] * Math.PI) / 180);
    const z = (lat - origin[0]) * 110540;
    return [x, z];
  });
}

function addExtrudedPolygon(THREE, points, height, color, y) {
  if (!points || points.length < 3) {
    return null;
  }
  const shape = new THREE.Shape();
  const [firstX, firstZ] = points[0];
  shape.moveTo(firstX, firstZ);
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], points[i][1]);
  }
  shape.lineTo(firstX, firstZ);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false
  });
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.85 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  return mesh;
}

function addFlowLines(THREE, flowLines, origin) {
  const group = new THREE.Group();
  flowLines.forEach((flow) => {
    const local = toLocal(flow.path, origin);
    const points = local.map(([x, z]) => new THREE.Vector3(x, 2.5, z));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x245a87 }));
    group.add(line);
  });
  return group;
}

function updateSunPosition(hour) {
  if (!sunLight) {
    return;
  }
  const normalized = (hour - 6) / 13;
  const azimuth = -Math.PI / 2 + normalized * Math.PI;
  const elevation = Math.max(0.12, Math.sin(normalized * Math.PI) * 0.95);
  const radius = 360;
  sunLight.position.set(
    Math.cos(azimuth) * radius,
    80 + elevation * 260,
    Math.sin(azimuth) * radius
  );
  sunLight.intensity = 0.35 + elevation * 0.85;
}

export async function openThreeDView({ site, layout }) {
  const [THREE, orbitMod] = await Promise.all([import(THREE_JS), import(ORBIT_JS)]);
  const OrbitControls = orbitMod.OrbitControls;

  host = document.getElementById("three-d-canvas");
  sunHourInput = document.getElementById("sun-hour");
  host.innerHTML = "";

  if (host.clientWidth < 10 || host.clientHeight < 10) {
    throw new Error("3D canvas has no size. Close and reopen 3D walkthrough.");
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdfe7e0);

  camera = new THREE.PerspectiveCamera(60, host.clientWidth / host.clientHeight, 0.1, 10000);
  camera.position.set(120, 180, 220);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.setSize(host.clientWidth, host.clientHeight);
  host.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 0, 0);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x4f5c4f, 1.05);
  scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
  sunLight.castShadow = true;
  scene.add(sunLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshStandardMaterial({ color: 0xc2d3c2 })
  );
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const boundary = site.boundary && site.boundary.length >= 3 ? site.boundary : null;
  const origin = boundary ? boundary[0] : [site.latitude, site.longitude];

  layout.zones.forEach((zone) => {
    if (zone.polygon) {
      const poly = toLocal(zone.polygon, origin);
      const h = zone.kind === "drainage" ? 1.5 : zone.kind === "hardscape" ? 6 : 4;
      const y = zone.kind === "drainage" ? 0 : 0.5;
      const color = Number(`0x${zone.color.replace("#", "")}`);
      const mesh = addExtrudedPolygon(THREE, poly, h, color, y);
      if (mesh) {
        mesh.castShadow = true;
        scene.add(mesh);
      }
    } else if (zone.center && zone.radius) {
      const local = toLocal([zone.center], origin)[0];
      const radius = Math.max(4, zone.radius * 0.08);
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, zone.kind === "hardscape" ? 8 : 5, 28),
        new THREE.MeshStandardMaterial({ color: Number(`0x${zone.color.replace("#", "")}`), opacity: 0.84, transparent: true })
      );
      mesh.castShadow = true;
      mesh.position.set(local[0], mesh.geometry.parameters.height / 2, local[1]);
      scene.add(mesh);
    }
  });

  if (layout.flowLines?.length) {
    scene.add(addFlowLines(THREE, layout.flowLines, origin));
  }

  const grid = new THREE.GridHelper(700, 36, 0x6f7b6f, 0xa6b1a6);
  scene.add(grid);

  const bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 120);
  controls.target.copy(center);
  camera.position.set(center.x + span * 0.6, 140 + span * 0.35, center.z + span * 0.6);

  updateSunPosition(Number(sunHourInput?.value || 12));

  const onHourChange = () => updateSunPosition(Number(sunHourInput.value));
  sunHourInput?.addEventListener("input", onHourChange);

  const animate = () => {
    controls.update();
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  };
  animate();

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
}

export function closeThreeDView() {
  if (frameId) {
    cancelAnimationFrame(frameId);
    frameId = null;
  }
  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }
  if (renderer?.domElement?._sunHandler && sunHourInput) {
    sunHourInput.removeEventListener("input", renderer.domElement._sunHandler);
  }
  if (controls) {
    controls.dispose();
    controls = null;
  }
  if (renderer) {
    renderer.dispose();
    renderer = null;
  }
  scene = null;
  camera = null;
  sunLight = null;
  if (host) {
    host.innerHTML = "";
  }
}
