/* =========================
   LogixMaster Pro - app.js
   Frontend for Netlify / static hosting
   Works with backend (health, simulate, report).
   Tested with three.js r146 + OrbitControls example build.
   ========================= */

/* ---------- tiny helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const byId = (id) => document.getElementById(id);
const pick = (...ids) => ids.map(byId).find(Boolean);
const text = (el, v) => { if (el) el.textContent = v; };
const val = (el) => (el ? el.value.trim() : "");
const num = (el) => {
  const n = Number(val(el));
  return Number.isFinite(n) ? n : 0;
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

/* ---------- DOM references (defensive: try several common IDs) ---------- */
const els = {
  // backend
  backendUrl: pick("backendUrl", "backend", "apiUrl"),
  backendCheckBtn: pick("checkBackend", "btnCheck", "check"),
  backendStatus: pick("backendStatus", "backendOk", "okLamp"),

  // container inputs
  cId: pick("contId", "cID", "containerId"),
  cL: pick("contL", "cL", "containerL"),
  cW: pick("contW", "cW", "containerW"),
  cH: pick("contH", "cH", "containerH"),
  cPayload: pick("contPayload", "payload", "maxPayload"),

  // item inputs
  iId: pick("itemId", "skuId", "iID"),
  iL: pick("itemL", "iL"),
  iW: pick("itemW", "iW"),
  iH: pick("itemH", "iH"),
  iWt: pick("itemWt", "iWeight", "wt"),
  iQty: pick("itemQty", "qty", "quantity"),
  iRot: pick("itemRotation", "iRot", "rotation"),
  iFam: pick("itemFamily", "iFamily", "family"),

  // rules + actions
  gap: pick("gap", "gapInput", "gapMM"),
  runBtn: pick("run", "btnRun", "runOptimization"),
  reportBtn: pick("report", "btnReport", "downloadReport"),

  // results text
  resultsBox: pick("results", "resultsBox", "runSummary"),

  // 3D view container
  view: pick("threeView", "view3d", "threeContainer"),
};

/* ---------- default backend URL (user can override in UI) ---------- */
const DEFAULT_BACKEND = "https://logixmaster-pro-backend.onrender.com";

/* ============ THREE.JS SCENE ============ */
let scene, camera, renderer, controls, containerGroup, placementsGroup;

function init3D() {
  if (!els.view) return;
  // Clear previous renderer if hot reloading
  els.view.innerHTML = "";

  const w = els.view.clientWidth || 640;
  const h = els.view.clientHeight || 380;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e1624);

  camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100000);
  camera.position.set(8000, 6000, 9000); // mm (we’ll work in mm units)

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(w, h);
  els.view.appendChild(renderer.domElement);

  // lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
  hemi.position.set(0, 1, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(5000, 8000, 5000);
  scene.add(dir);

  // grid (floor)
  const grid = new THREE.GridHelper(20000, 20, 0x334155, 0x1f2937);
  grid.rotation.x = Math.PI / 2; // XY plane to XZ
  grid.position.set(0, 0, 0);
  scene.add(grid);

  // container + placements groups
  containerGroup = new THREE.Group();
  placementsGroup = new THREE.Group();
  scene.add(containerGroup);
  scene.add(placementsGroup);

  // Robust OrbitControls creation (works whether OrbitControls is global or under THREE)
  if (THREE.OrbitControls) {
    controls = new THREE.OrbitControls(camera, renderer.domElement);
  } else if (window.OrbitControls) {
    controls = new window.OrbitControls(camera, renderer.domElement);
  } else {
    console.warn("OrbitControls not found; continuing without camera controls.");
  }
  if (controls) {
    controls.target.set(0, 0, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 500;
    controls.maxDistance = 60000;
  }

  window.addEventListener("resize", onResize);
  animate();
}

function onResize() {
  if (!renderer || !camera || !els.view) return;
  const w = els.view.clientWidth || 640;
  const h = els.view.clientHeight || 380;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

function animate() {
  requestAnimationFrame(animate);
  if (controls && controls.update) controls.update();
  renderer.render(scene, camera);
}

/* Draw container wireframe in mm */
function drawContainerWireframe(L, W, H) {
  if (!containerGroup) return;
  containerGroup.clear();

  const geom = new THREE.BoxGeometry(L, H, W); // x=L, y=H, z=W (y up)
  const edges = new THREE.EdgesGeometry(geom);
  const mat = new THREE.LineBasicMaterial({ color: 0x66ccff });
  const wire = new THREE.LineSegments(edges, mat);
  wire.position.set(L / 2, H / 2, W / 2); // move to positive quadrant
  containerGroup.add(wire);
}

/* Add a placed box (mm) with color */
function addPlacementBox(x, y, z, l, w, h, color) {
  const geom = new THREE.BoxGeometry(l, h, w);
  const mat = new THREE.MeshStandardMaterial({
    color: color || 0x4ade80,
    roughness: 0.6,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(x + l / 2, y + h / 2, z + w / 2);
  placementsGroup.add(mesh);
}

/* Clear placements from scene */
function clearPlacements() {
  if (placementsGroup) placementsGroup.clear();
}

/* ============ BACKEND ACCESS ============ */
function getBackend() {
  const v = val(els.backendUrl);
  return v || DEFAULT_BACKEND;
}

async function pingBackend() {
  const url = getBackend();
  try {
    const r = await fetch(`${url}/api/health`, { cache: "no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const j = await r.json().catch(() => ({}));
    if (els.backendStatus) {
      els.backendStatus.className = "ok-pill ok";
      els.backendStatus.innerText = "OK";
    }
    console.log("Backend OK:", j);
  } catch (e) {
    console.error("Backend health failed:", e);
    if (els.backendStatus) {
      els.backendStatus.className = "ok-pill err";
      els.backendStatus.innerText = "ERR";
    }
  }
}

/* ============ RUN OPTIMIZATION ============ */
function readInputs() {
  const container = {
    id: val(els.cId) || "20 HC",
    l: num(els.cL) || 5900,
    w: num(els.cW) || 2350,
    h: num(els.cH) || 2390,
    maxPayload: num(els.cPayload) || 20000,
  };

  const item = {
    id: val(els.iId) || "A1",
    l: num(els.iL) || 485,
    w: num(els.iW) || 385,
    h: num(els.iH) || 200,
    weight: num(els.iWt) || 17.4,
    qty: clamp(num(els.iQty) || 800, 0, 100000),
    rotation: val(els.iRot) || "all",
    family: val(els.iFam) || "A",
    topLoadKg: undefined, // add if you have this field
    stack: true, // editable if you have a checkbox later
  };

  const rules = {
    gap: clamp(num(els.gap) || 5, 0, 200),
  };

  return { container, item, rules };
}

function colorForFamily(fam) {
  // consistent colors per family id
  const colors = [
    0x60a5fa, 0xf472b6, 0xf59e0b, 0x34d399, 0xa78bfa, 0xf87171, 0x22d3ee,
  ];
  let idx = 0;
  if (fam && typeof fam === "string") {
    for (let i = 0; i < fam.length; i++) idx = (idx + fam.charCodeAt(i)) % colors.length;
  }
  return colors[idx];
}

function normalizePlacement(p) {
  // Accepts a variety of likely key names from different backends
  const l = p.l ?? p.L ?? p.length ?? 0;
  const w = p.w ?? p.W ?? p.width ?? 0;
  const h = p.h ?? p.H ?? p.height ?? 0;

  let x = p.x ?? p.X ?? 0;
  let y = p.y ?? p.Y ?? 0;
  let z = p.z ?? p.Z ?? 0;

  if (Array.isArray(p.pos)) {
    [x, y, z] = p.pos;
  }

  return { x, y, z, l, w, h, id: p.id || p.sku || p.code };
}

async function runOptimization() {
  const url = getBackend();
  const { container, item, rules } = readInputs();

  // Update 3D container box immediately
  drawContainerWireframe(container.l, container.w, container.h);
  clearPlacements();
  text(els.resultsBox, "Running…");

  const payload = {
    emptyContainers: [
      {
        id: container.id,
        l: container.l,
        w: container.w,
        h: container.h,
        maxPayload: container.maxPayload,
      },
    ],
    cargoes: [
      {
        id: item.id,
        l: item.l,
        w: item.w,
        h: item.h,
        weight: item.weight,
        quantity: item.qty,
        rotation: item.rotation, // "all" | "none" etc.
        family: item.family,
      },
    ],
    rules: { gap: rules.gap },
  };

  try {
    const r = await fetch(`${url}/api/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();

    // ---- Interpret a few common response shapes ----
    // Expected (one container):
    // {
    //   containerID, containerSize:{l,w,h},
    //   utilizationPercent:{volume, weight}, totalWeight,
    //   placements:[{x,y,z,l,w,h, id, family? }], cargoSummary:[...], exceptions:[...]
    // }

    // Results text summary
    const volU = data?.utilizationPercent?.volume ?? data?.volUtil ?? 0;
    const wtU = data?.utilizationPercent?.weight ?? data?.wtUtil ?? 0;
    const totalWt = data?.totalWeight ?? 0;

    const loadedCount =
      Array.isArray(data?.cargoSummary)
        ? data.cargoSummary.reduce((a, c) => a + (c.loaded || c.loadedQty || 0), 0)
        : Array.isArray(data?.placements)
        ? data.placements.length
        : 0;

    text(
      els.resultsBox,
      `Container ${data?.containerID || container.id}  •  Vol ${volU}%  •  Wt ${wtU}%  •  TotalWt ${totalWt} kg  •  Loaded ${loadedCount}`
    );

    // Draw placements
    clearPlacements();
    const arr = Array.isArray(data?.placements) ? data.placements : [];
    for (const p of arr) {
      const np = normalizePlacement(p);
      const fam = p.family || item.family;
      addPlacementBox(np.x, np.y, np.z, np.l, np.w, np.h, colorForFamily(fam));
    }
  } catch (e) {
    console.error("simulate error:", e);
    text(els.resultsBox, `Error: ${String(e.message || e)}`);
  }
}

/* ============ REPORT (PDF) ============ */
async function downloadReport() {
  const url = getBackend();
  // try to capture a snapshot of the current 3D canvas
  let snapshot = null;
  try {
    snapshot = renderer?.domElement?.toDataURL("image/png");
  } catch (_) {}
  // Send a light payload with fields used by backend PDF route
  const { container, item, rules } = readInputs();

  try {
    const r = await fetch(`${url}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        meta: {
          createdAt: new Date().toISOString(),
          title: "LogixMaster Pro — Load Plan Report",
        },
        input: { container, item, rules },
        snapshot, // may be null; backend should handle
      }),
    });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `logixmaster_report_${Date.now()}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 2000);
  } catch (e) {
    console.error("report error:", e);
    alert("Report generation failed: " + String(e.message || e));
  }
}

/* ============ WIRE UP UI ============ */
function wireEvents() {
  if (els.backendCheckBtn) els.backendCheckBtn.addEventListener("click", pingBackend);
  if (els.runBtn) els.runBtn.addEventListener("click", runOptimization);
  if (els.reportBtn) els.reportBtn.addEventListener("click", downloadReport);

  // Enter presses should not submit a (non-existent) form
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.target?.tagName === "INPUT" || e.target?.tagName === "SELECT")) {
      e.preventDefault();
    }
  });
}

/* ============ BOOT ============ */
window.addEventListener("DOMContentLoaded", () => {
  // show default backend url in the field if empty
  if (els.backendUrl && !val(els.backendUrl)) els.backendUrl.value = DEFAULT_BACKEND;
  init3D();
  wireEvents();
  // optional: ping once on load
  pingBackend();
});
