/* Frontend client: connects to backend, manages masters, runs optimizer and renders 3D */
const $ = (q)=>document.querySelector(q);
const backendInput = $("#backend");
const statusPill = $("#status");
const healthNote = $("#healthNote");
const token = () => localStorage.getItem("token") || "";

backendInput.value = localStorage.getItem("backend") || "";

async function api(path, opt={}) {
  const base = localStorage.getItem("backend");
  if (!base) throw new Error("Backend not set");
  const headers = {"Content-Type":"application/json"};
  if (token()) headers["Authorization"] = "Bearer " + token();
  const r = await fetch(base + path, {
    method: opt.method || "GET",
    headers,
    body: opt.body ? JSON.stringify(opt.body) : undefined
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

/* ----- health ----- */
async function checkBackend() {
  try {
    const base = backendInput.value.trim().replace(/\/+$/,'');
    if (!base) return;
    const r = await fetch(base + "/api/health");
    const j = await r.json();
    if (!j.ok) throw 0;
    localStorage.setItem("backend", base);
    statusPill.textContent = "OK"; statusPill.className = "pill ok";
    healthNote.textContent = "Backend OK • " + j.ts;
  } catch {
    statusPill.textContent = "ERR"; statusPill.className = "pill err";
    healthNote.textContent = "Backend not reachable";
  }
}
$("#btnCheck").onclick = checkBackend;

/* ----- containers ----- */
async function refreshC() {
  const j = await api("/api/containers");
  const t = $("#ctbl");
  t.innerHTML = "<tr><th>ID</th><th>L</th><th>W</th><th>H</th><th>Payload</th></tr>" +
    j.rows.map(r=>`<tr><td>${r.id}</td><td>${r.l}</td><td>${r.w}</td><td>${r.h}</td><td>${r.payload||0}</td></tr>`).join("");
}
$("#btnRefreshC").onclick = refreshC;

$("#btnAddC").onclick = async () => {
  const b = {
    id: $("#cid").value.trim(),
    l: +$("#cl").value, w: +$("#cw").value, h: +$("#ch").value,
    payload: +$("#cpayload").value || 0
  };
  if (!b.id || !b.l || !b.w || !b.h) return alert("Enter id,l,w,h");
  await api("/api/containers", { method:"POST", body:b });
  await refreshC();
};

/* ----- items ----- */
async function refreshI() {
  const j = await api("/api/items");
  const t = $("#itbl");
  t.innerHTML = "<tr><th>ID</th><th>L</th><th>W</th><th>H</th><th>Wt</th><th>Qty</th><th>Rot</th><th>Fam</th></tr>" +
    j.rows.map(r=>`<tr><td>${r.id}</td><td>${r.l}</td><td>${r.w}</td><td>${r.h}</td><td>${r.wt||0}</td><td>${r.qty||0}</td><td>${r.rotation}</td><td>${r.family||"A"}</td></tr>`).join("");
}
$("#btnRefreshI").onclick = refreshI;

$("#btnAddI").onclick = async () => {
  const b = {
    id: $("#iid").value.trim(),
    l: +$("#il").value, w: +$("#iw").value, h: +$("#ih").value,
    wt: +$("#iwt").value || 0, qty: +$("#iqty").value || 0,
    rotation: $("#irot").value, family: ($("#ifam").value || "A").trim()
  };
  if (!b.id || !b.l || !b.w || !b.h) return alert("Enter id,l,w,h");
  await api("/api/items", { method:"POST", body:b });
  await refreshI();
};

/* ----- 3D scene ----- */
let renderer, scene, camera, controls;
const view = $("#view");
init3D();

function init3D() {
  renderer = new THREE.WebGLRenderer({ antialias:true });
  renderer.setSize(view.clientWidth, view.clientHeight);
  view.innerHTML = ""; view.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b1220);

  camera = new THREE.PerspectiveCamera(45, view.clientWidth/view.clientHeight, 1, 100000);
  camera.position.set(2000, 2000, 2000);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);

  const light = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(light);
  animate();
}
function animate(){ requestAnimationFrame(animate); renderer.render(scene, camera); }
window.addEventListener("resize", ()=> {
  renderer.setSize(view.clientWidth, view.clientHeight);
  camera.aspect = view.clientWidth/view.clientHeight; camera.updateProjectionMatrix();
});

function drawContainer(c) {
  // wireframe box (x=L, y=W, z=H); our optimizer uses (x=length, y=width, z=height)
  const geo = new THREE.BoxGeometry(c.l, c.h, c.w);
  const mat = new THREE.MeshBasicMaterial({ color:0x66ccff, wireframe:true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(c.l/2, c.h/2, c.w/2);
  scene.add(mesh);
}

function colorFor(fam){
  const pal = {
    A:0x4ade80, B:0x60a5fa, C:0xf472b6, D:0xf59e0b, E:0x22d3ee, F:0x94a3b8
  };
  return pal[fam] || 0x9ca3af;
}

function drawPlacements(c, placements) {
  for (const p of placements) {
    const geo = new THREE.BoxGeometry(p.l, p.h, p.w);
    const mat = new THREE.MeshLambertMaterial({ color: colorFor(p.family), transparent:true, opacity:0.9 });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(p.x + p.l/2, p.z + p.h/2, p.y + p.w/2);
    scene.add(cube);
  }
}

/* ----- run optimize + render ----- */
let lastPlan = null;

$("#btnRun").onclick = async () => {
  const gap = +$("#gap").value || 0;

  // use first container from DB + all items (qty > 0)
  const cs = await api("/api/containers");
  if (!cs.rows.length) return alert("Add a container first and Refresh");
  const container = cs.rows[0];

  const result = await api("/api/optimize", {
    method:"POST",
    body: { containerId: container.id, gap }
  });

  // scene reset
  init3D();
  drawContainer(result.container);
  drawPlacements(result.container, result.placements);

  $("#summary").textContent =
    `Container ${result.container.id} · Vol ${result.utilizationPercent.volume}% · ` +
    `Wt ${result.utilizationPercent.weight}% · TotalWt ${result.loadedWeight} kg · ` +
    `Loaded ${result.placements.length} · Not placed: ` +
    (result.notPlaced || []).map(n=>`${n.id}:${n.qty}`).join(", ") || "-";

  lastPlan = result;
};

$("#btnPDF").onclick = async () => {
  if (!lastPlan) return alert("Run optimization first.");
  const base = localStorage.getItem("backend");
  if (!base) return alert("Connect backend first.");

  const snapshot = renderer.domElement.toDataURL("image/png");
  const summaryText = $("#summary").textContent;

  const r = await fetch(base + "/api/report", {
    method:"POST",
    headers: { "Content-Type":"application/json", ...(token()?{"Authorization":"Bearer "+token()}: {}) },
    body: JSON.stringify({
      title: "LogixMaster Pro — Load Plan Report",
      container: lastPlan.container,
      summary: summaryText,
      snapshot
    })
  });
  if (!r.ok) return alert("Report failed");
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "logixmaster_report.pdf"; a.click();
  URL.revokeObjectURL(url);
};

/* auto check + initial lists */
checkBackend().then(()=>{ refreshC(); refreshI(); });
