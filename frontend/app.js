const API = "/api";
const KARNATAKA_CENTER = [14.9, 75.7];
const OVERVIEW_ZOOM = 7;

const map = L.map("map", { zoomControl: true, attributionControl: false }).setView(KARNATAKA_CENTER, OVERVIEW_ZOOM);

L.tileLayer(`/api/tiles/{z}/{x}/{y}`, {
  attribution: "&copy; OpenStreetMap &copy; CARTO",
  maxZoom: 18,
}).addTo(map);

const districtLayer = L.layerGroup().addTo(map);
const hotspotLayer = L.layerGroup().addTo(map);
const schoolLayer = L.layerGroup().addTo(map);
const hubLayer = L.layerGroup();

const ledgerBody = document.getElementById("ledgerBody");
const deployBody = document.getElementById("deployBody");
const resetBtn = document.getElementById("resetView");
const legendEl = document.querySelector(".legend");

let hotspots = [];
let maxLift = 1;
let activeClusterId = null;
let currentFilters = { management: 'all', category: 'all', q: '', risk_tier: 'all' };
let currentGeofence = null;
let trendChartInstance = null;
let activeTab = "hotspots";
let lastOptimizeResult = null;

// ---- color helpers -------------------------------------------------

const RISK_LOW = [86, 204, 157];   // lighter green for dark theme
const RISK_MID = [255, 204, 0];    // lighter yellow
const RISK_HIGH = [255, 107, 107]; // lighter red

function lerp(a, b, t) { return a + (b - a) * t; }

function colorForT(t) {
  t = Math.max(0, Math.min(1, t));
  const [c1, c2] = t < 0.5 ? [RISK_LOW, RISK_MID] : [RISK_MID, RISK_HIGH];
  const tt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const rgb = c1.map((v, i) => Math.round(lerp(v, c2[i], tt)));
  return `rgb(${rgb.join(",")})`;
}

const TIER_COLOR = { Low: colorForT(0), Medium: colorForT(0.5), High: colorForT(1) };

// ---- data loading ----------------------------------------------------


async function fetchWithFilters(endpoint, retries = 4) {
  let url = `${API}/${endpoint}`;
  const params = new URLSearchParams();
  if(currentFilters.management !== 'all') params.append('management', currentFilters.management);
  if(currentFilters.category !== 'all') params.append('category', currentFilters.category);
  if(currentFilters.q) params.append('q', currentFilters.q);
  if(currentFilters.risk_tier && currentFilters.risk_tier !== 'all') params.append('risk_tier', currentFilters.risk_tier);
  if(currentGeofence) params.append('bounds', JSON.stringify(currentGeofence));
  const query = params.toString();
  if (query) url += (url.includes('?') ? '&' : '?') + query;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("application/json")) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          continue;
        }
        const text = await res.text();
        throw new Error(`Endpoint ${endpoint} returned ${res.status}: ${text.slice(0, 100)}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}
async function loadStats() {
  const s = await fetchWithFilters("stats");
  document.getElementById("statTotal").textContent = s.total_schools.toLocaleString();

  document.getElementById("statHigh").textContent = (s.risk_tier_counts.High || 0).toLocaleString();
  document.getElementById("statHotspots").textContent = s.hotspot_count;
  document.getElementById("statDistricts").textContent = s.districts;
}

async function loadHotspots() {
  hotspots = await fetchWithFilters("hotspots");
  maxLift = Math.max(...hotspots.map((h) => h.risk_lift), 0.01);
  drawHotspots();
  drawLedger();
}


async function loadDistrictChoropleth() {
  districtLayer.clearLayers();
  const geojson = await fetchWithFilters("districts/geojson");


  const risks = geojson.features.map((f) => f.properties.avg_risk);
  const lo = Math.min(...risks), hi = Math.max(...risks);
  const norm = (v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);

  L.geoJSON(geojson, {
    style: (feature) => ({
      color: "rgba(255,255,255,0.1)",
      weight: 1,
      fillColor: colorForT(norm(feature.properties.avg_risk)),
      fillOpacity: 0.25,
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(
        `<strong>${p.display_name}</strong><br/>${p.school_count.toLocaleString()} Schools · Avg risk ${p.avg_risk}`,
        { sticky: true }
      );
      layer.on("mouseover", () => layer.setStyle({ weight: 2, color: "rgba(255,255,255,0.4)", fillOpacity: 0.45 }));
      layer.on("mouseout", () => layer.setStyle({ weight: 1, color: "rgba(255,255,255,0.1)", fillOpacity: 0.25 }));
      layer.on("click", () => { if (p.history) renderChart(p.display_name, p.history); });
      layer.on("click", () => map.flyToBounds(layer.getBounds(), { duration: 0.6, maxZoom: 9 }));
    },
  }).addTo(districtLayer);
}

// ---- map drawing ----------------------------------------------------

function drawHotspots() {
  hotspotLayer.clearLayers();
  hotspots.forEach((h) => {
    const t = h.risk_lift / maxLift;
    const circle = L.circleMarker([h.centroid_lat, h.centroid_lon], {
      radius: 8 + Math.sqrt(h.school_count) * 2.2,
      color: "rgba(255,255,255,0.3)",
      weight: 1,
      fillColor: colorForT(t),
      fillOpacity: 0.8,
    });
    circle.bindTooltip(
      `<strong>${h.district}</strong><br/>${h.school_count} Schools · Risk lift +${h.risk_lift.toFixed(2)}`,
      { sticky: true }
    );
    circle.on("click", () => selectHotspot(h.cluster_id));
    circle.addTo(hotspotLayer);
  });
}

function drawSchools(list) {
  schoolLayer.clearLayers();
  list.forEach((s) => {
    const isLowConf = s.confidence === "Low";
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 6,
      color: isLowConf ? "#ffffff" : "rgba(255,255,255,0.5)",
      weight: isLowConf ? 2 : 1,
      dashArray: isLowConf ? "3, 3" : null,
      fillColor: TIER_COLOR[s.risk_tier] || TIER_COLOR.Medium,
      fillOpacity: 0.9,
    });
    const ruralContrib = (s.is_rural * 0.25).toFixed(2);
    const transContrib = (s.is_terminal_primary * 0.175).toFixed(2);
    const govtContrib = (s.is_govt * 0.075).toFixed(2);
    const infraContrib = (s.infra_gap_score * 0.5).toFixed(2);
    marker.bindPopup(`
      <div class="school-popup">
        <span class="name">${s.schname}</span>
        <span class="meta">${s.district} · ${s.rural_urban} · ${s.management}</span>
        <span class="meta">${s.school_cat}</span>
        <span class="risk">Demo risk score: ${s.risk_score} (${s.risk_tier} · ${s.confidence} confidence)</span>
        <span class="meta" style="margin-top: 4px; font-size: 0.85em; display:block; line-height: 1.35;">
          <strong>Breakdown:</strong> rural (+${ruralContrib}), transition-risk school (+${transContrib}), government (+${govtContrib}), district infra gap (+${infraContrib})<br/>
          <strong>Confidence:</strong> ${s.confidence === "Low" ? "Low (structural features diverge from district context)" : "High (signals align)"}
        </span>
      </div>
    `);
    marker.addTo(schoolLayer);
  });
}

// ---- ledger panel -----------------------------------------------------

function drawLedger() {
  ledgerBody.innerHTML = "";
  hotspots.forEach((h, i) => {
    const row = document.createElement("li");
    row.className = "ledger-row";
    row.dataset.clusterId = h.cluster_id;
    row.setAttribute("tabindex", "0");
    row.innerHTML = `
      <span class="rank">${i + 1}</span>
      <span class="name">${h.district}</span>
      <span class="count">${h.school_count}</span>
      <span class="lift" style="color:${colorForT(h.risk_lift / maxLift)}">+${h.risk_lift.toFixed(2)}</span>
    `;
    row.addEventListener("click", () => selectHotspot(h.cluster_id));
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") selectHotspot(h.cluster_id);
    });
    ledgerBody.appendChild(row);
  });
}

function setActiveLedgerRow(clusterId) {
  document.querySelectorAll(".ledger-row").forEach((row) => {
    row.classList.toggle("active", Number(row.dataset.clusterId) === clusterId);
  });
}

// ---- interaction -----------------------------------------------------

async function selectHotspot(clusterId) {
  activeClusterId = clusterId;
  const hotspot = hotspots.find((h) => h.cluster_id === clusterId);
  if (!hotspot) return;

  
  
  const params = new URLSearchParams({ cluster_id: clusterId });
  if(currentFilters.management !== 'all') params.append('management', currentFilters.management);
  if(currentFilters.category !== 'all') params.append('category', currentFilters.category);
  if(currentFilters.q) params.append('q', currentFilters.q);
  if(currentFilters.risk_tier && currentFilters.risk_tier !== 'all') params.append('risk_tier', currentFilters.risk_tier);
  const r = await fetch(`${API}/schools?${params.toString()}`);

  const schools = await r.json();
  drawSchools(schools);

  map.flyTo([hotspot.centroid_lat, hotspot.centroid_lon], 12, { duration: 0.6 });
  setActiveLedgerRow(clusterId);
  document.getElementById('printReportBtn').style.display = 'inline-flex';
  resetBtn.hidden = false;
}

resetBtn.addEventListener("click", () => {
  activeClusterId = null;
  schoolLayer.clearLayers();
  map.flyTo(KARNATAKA_CENTER, OVERVIEW_ZOOM, { duration: 0.6 });
  setActiveLedgerRow(null);
  resetBtn.hidden = true;
  document.getElementById('printReportBtn').style.display = 'none';
});

// ---- deploy-units tab ------------------------------------------------

const HOTSPOT_LEGEND = `
  <span class="legend-title">Risk Level</span>
  <div class="legend-scale"><span class="swatch low"></span><span class="swatch mid"></span><span class="swatch high"></span></div>
  <div class="legend-labels" style="width: 140px;"><span>Lower Risk</span><span>Higher Risk</span></div>
  <div class="legend-labels" style="width: auto; margin-top:8px; display: block; line-height: 1.4;">
    <div style="margin-bottom: 2px;">Shaded Areas = District Average</div>
    <div>Circles = Risk Hotspots</div>
  </div>
`;
const DEPLOY_LEGEND = `
  <span class="legend-title">Deployment Plan</span>
  <div class="legend-labels" style="margin-top:6px;"><span>&#9670; Proposed Mobile Unit Base</span></div>
  <div class="legend-labels"><span>Dashed circle = Service Area</span></div>
`;

function switchTab(tab) {
  activeTab = tab;
  const isHotspots = tab === "hotspots";
  const isDeploy = tab === "deploy";
  const isAbout = tab === "about";

  document.getElementById("navHotspots").classList.toggle("active", isHotspots);
  document.getElementById("navDeploy").classList.toggle("active", isDeploy);
  document.getElementById("navAbout").classList.toggle("active", isAbout);
  
  document.getElementById("hotspotsPanel").hidden = !isHotspots;
  document.getElementById("deployPanel").hidden = !isDeploy;
  document.getElementById("aboutPanel").hidden = !isAbout;
  
  const breadcrumb = document.getElementById("currentViewBreadcrumb");
  if(breadcrumb) {
    if (isHotspots) breadcrumb.textContent = "Hotspots Overview";
    else if (isDeploy) breadcrumb.textContent = "Deployment Plan";
    else if (isAbout) breadcrumb.textContent = "About";
  }

  // Handle map layers
  if (isHotspots) {
    map.addLayer(districtLayer);
    map.addLayer(hotspotLayer);
    map.addLayer(schoolLayer);
    map.removeLayer(hubLayer);
    legendEl.innerHTML = HOTSPOT_LEGEND;
    resetBtn.hidden = activeClusterId === null;
  } else if (isDeploy) {
    map.removeLayer(districtLayer);
    map.removeLayer(hotspotLayer);
    map.removeLayer(schoolLayer);
    map.addLayer(hubLayer);
    resetBtn.hidden = true;
  document.getElementById('printReportBtn').style.display = 'none';
    legendEl.innerHTML = DEPLOY_LEGEND;
    if (lastOptimizeResult) map.flyTo(KARNATAKA_CENTER, OVERVIEW_ZOOM, { duration: 0.4 });
  } else if (isAbout) {
    // Optionally clear layers or keep them as is
  }
}

document.getElementById("navHotspots").addEventListener("click", () => switchTab("hotspots"));
document.getElementById("navDeploy").addEventListener("click", () => switchTab("deploy"));
document.getElementById("navAbout").addEventListener("click", () => switchTab("about"));


document.getElementById("equityInput").addEventListener("change", (e) => {
  document.getElementById("capInput").disabled = !e.target.checked;
});

function drawHubs(chosenSites, radiusKm) {
  hubLayer.clearLayers();
  chosenSites.forEach((s) => {
    L.circle([s.lat, s.lon], {
      radius: radiusKm * 1000,
      color: "rgba(255,255,255,0.4)",
      weight: 1,
      dashArray: "4,4",
      fillColor: "rgba(255,255,255,0.1)",
      fillOpacity: 0.1,
    }).addTo(hubLayer);

    const hub = L.circleMarker([s.lat, s.lon], {
      radius: 9,
      color: "#fff",
      weight: 2,
      fillColor: "rgba(86, 204, 157, 0.9)", // Greenish hub
      fillOpacity: 0.95,
    });
    hub.bindTooltip(
      `<strong>${s.district}</strong><br/>Base for 1 unit · Covers up to ${s.school_count} schools nearby`,
      { sticky: true }
    );
    hub.addTo(hubLayer);
  });
}

function drawDeployLedger(chosenSites) {
  deployBody.innerHTML = "";
  chosenSites.forEach((s, i) => {
    const row = document.createElement("li");
    row.className = "ledger-row";
    row.setAttribute("tabindex", "0");
    row.innerHTML = `
      <span class="rank">${i + 1}</span>
      <span class="name">${s.district}</span>
      <span class="count">${s.school_count}</span>
      <span class="lift">${s.demand.toFixed(0)}</span>
    `;
    row.addEventListener("click", () => {
      map.flyTo([s.lat, s.lon], 10, { duration: 0.6 });
    });
    deployBody.appendChild(row);
  });
}


async function runOptimize() {
  const btn = document.getElementById("runOptimize");
  const hint = document.getElementById("deployHint");
  const k = document.getElementById("kInput").value;
  const radius = document.getElementById("radiusInput").value;
  const metric = document.getElementById("metricInput").value;
  const equity = document.getElementById("equityInput").checked;
  const cap = document.getElementById("capInput").value;

  btn.disabled = true;
  btn.textContent = "Solving…";
  hint.textContent = "Running the ILP over candidate sites — usually under a second.";

  try {
    const payload = {
      k: k,
      radius_km: radius,
      metric: metric,
      equity: equity,
      max_per_district: cap,
      geofence: currentGeofence
    };
    
    const r = await fetch(`${API}/optimize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const result = await r.json();
    lastOptimizeResult = result;

    document.getElementById("deployResults").hidden = false;
    document.getElementById("resultIlpPct").textContent = `${result.ilp_coverage_pct}%`;
    document.getElementById("resultGreedyPct").textContent = `${result.greedy_coverage_pct}%`;
    document.getElementById("resultGap").textContent =
      result.gap > 0.05 ? `+${result.gap.toFixed(1)} risk-units` : "matched greedy";
    document.getElementById("resultTime").textContent = `${result.solve_seconds}s (${result.status})`;

    drawHubs(result.chosen_sites, Number(radius));
    drawDeployLedger(result.chosen_sites);
    hint.textContent = `${result.chosen_sites.length} units placed, covering ${result.ilp_coverage_pct}% of statewide weighted risk.`;
    fetchAndRenderCurve(k, radius, metric, equity, cap);
  } catch (err) {
    hint.textContent = "Couldn't reach the optimizer endpoint — is the backend running on :8000?";
    console.error("optimize failed", err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Run optimizer";
  }
}

document.getElementById("runOptimize").addEventListener("click", runOptimize);

// ---- boot -----------------------------------------------------------

async function bootApp() {
  try {
    await Promise.all([
      loadStats(),
      loadHotspots(),
      loadDistrictChoropleth()
    ]);
  } catch (err) {
    console.error("Initialization failed while loading data from backend:", err);
  }
}
bootApp();

// ---- missing interactions -----------------------------------------------------
// Leaflet Draw Setup
const drawnItems = new L.FeatureGroup();
map.addLayer(drawnItems);
const drawControl = new L.Control.Draw({
  draw: {
    polygon: true,
    polyline: false,
    rectangle: false,
    circle: false,
    circlemarker: false,
    marker: false
  },
  edit: {
    featureGroup: drawnItems
  }
});
map.addControl(drawControl);

map.on(L.Draw.Event.CREATED, function (event) {
  const layer = event.layer;
  drawnItems.clearLayers(); // Only allow one geofence for now
  drawnItems.addLayer(layer);
  
  // Extract polygon coordinates for backend filtering
  const latlngs = layer.getLatLngs()[0].map(ll => [ll.lng, ll.lat]);
  if (latlngs.length > 0 && (latlngs[0][0] !== latlngs[latlngs.length - 1][0] || latlngs[0][1] !== latlngs[latlngs.length - 1][1])) {
    latlngs.push(latlngs[0]);
  }
  currentGeofence = { type: 'Polygon', coordinates: [latlngs] };
  
  // Reload data
  loadHotspots().then(() => drawLedger());
  loadDistrictChoropleth();
});
map.on(L.Draw.Event.DELETED, function () {
  currentGeofence = null;
  loadHotspots().then(() => drawLedger());
  loadDistrictChoropleth();
});

// Charting Logic
function renderChart(districtName, history) {
  const panel = document.getElementById('chartOverlay');
  document.getElementById('chartTitle').textContent = districtName + ' - Risk Trend';
  panel.hidden = false;
  
  const ctx = document.getElementById('trendChart').getContext('2d');
  if (trendChartInstance) trendChartInstance.destroy();
  
  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.year),
      datasets: [{
        label: 'Average Risk',
        data: history.map(h => h.risk.toFixed(3)),
        borderColor: '#56cc9d',
        backgroundColor: 'rgba(86, 204, 157, 0.2)',
        borderWidth: 2,
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: false, ticks: { color: '#ccc' } },
        x: { ticks: { color: '#ccc' } }
      }
    }
  });
}
document.getElementById('closeChart').addEventListener('click', () => {
  document.getElementById('chartOverlay').hidden = true;
});

// Filters Logic
function applyFilters() {
  currentFilters.management = document.getElementById('filterManagement').value;
  currentFilters.category = document.getElementById('filterCategory').value;
  currentFilters.q = document.getElementById('searchInput').value;
  currentFilters.risk_tier = document.getElementById('filterRiskTier').value;
  loadStats();
  loadHotspots().then(() => {
    drawLedger();
    if (hotspots.length > 0 && currentFilters.q.trim() !== '') {
      selectHotspot(hotspots[0].cluster_id);
    }
  });
  loadDistrictChoropleth();
}
document.getElementById('filterManagement').addEventListener('change', applyFilters);
document.getElementById('filterCategory').addEventListener('change', applyFilters);
document.getElementById('filterRiskTier').addEventListener('change', applyFilters);


// Export CSV Logic
document.getElementById('exportCsvBtn').addEventListener('click', () => {
  let csv = '';
  if (activeTab === 'hotspots') {
    csv = 'District,School Count,High Risk Count,Avg Risk,Risk Lift\n';
    hotspots.forEach(h => {
      csv += `${h.district},${h.school_count},${h.high_risk_count},${h.avg_risk},${h.risk_lift}\n`;
    });
  } else {
    if (!lastOptimizeResult) return alert('Run optimizer first.');
    csv = 'Site ID,District,Schools Covered,Demand\n';
    lastOptimizeResult.chosen_sites.forEach(s => {
      csv += `${s.site_id},${s.district},${s.school_count},${s.demand}\n`;
    });
  }
  
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${activeTab}_export.csv`;
  a.click();
});
document.getElementById('searchInput').addEventListener('change', applyFilters);

async function fetchAndRenderCurve(k, radius, metric, equity, cap) {
  const container = document.getElementById("curveChartContainer");
  if (!container) return;
  container.innerHTML = "<div style='font-size:10px;color:#aaa;padding:6px 0;text-align:center;'>Calculating marginal-returns curve…</div>";
  try {
    const r = await fetch(`${API}/optimize/curve?k_max=40&radius_km=${radius}&metric=${metric}&equity=${equity}&max_per_district=${cap}`);
    if (!r.ok) throw new Error("Curve fetch failed");
    const data = await r.json();
    if (!data || data.length === 0) {
      container.innerHTML = "";
      return;
    }
    
    // Render responsive SVG line chart
    const width = 280;
    const height = 110;
    const padLeft = 32;
    const padRight = 16;
    const padTop = 18;
    const padBottom = 22;
    const maxK = 40;
    const maxPct = Math.max(30, ...data.map(d => d.ilp_coverage_pct));
    
    let pathD = "";
    let areaD = "";
    data.forEach((pt, i) => {
      const x = padLeft + (pt.k / maxK) * (width - padLeft - padRight);
      const y = height - padBottom - (pt.ilp_coverage_pct / maxPct) * (height - padTop - padBottom);
      if (i === 0) {
        pathD += `M ${x} ${y} `;
        areaD += `M ${x} ${height - padBottom} L ${x} ${y} `;
      } else {
        pathD += `L ${x} ${y} `;
        areaD += `L ${x} ${y} `;
      }
    });
    const lastX = padLeft + (data[data.length - 1].k / maxK) * (width - padLeft - padRight);
    areaD += `L ${lastX} ${height - padBottom} Z`;
    
    const currK = Math.min(Number(k), maxK);
    const currPt = data.find(d => d.k === currK) || data.find(d => d.k >= currK) || data[data.length - 1];
    const currX = padLeft + (currK / maxK) * (width - padLeft - padRight);
    const currY = height - padBottom - ((currPt ? currPt.ilp_coverage_pct : 0) / maxPct) * (height - padTop - padBottom);
    const currPct = currPt ? currPt.ilp_coverage_pct : 0;
    
    container.innerHTML = `
      <div style="font-size:11px;font-weight:600;color:var(--text-main);margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
        <span>Marginal Returns (Units vs. Coverage)</span>
        <span style="font-family:var(--mono);color:var(--risk-low);">${currK} units → ${currPct}%</span>
      </div>
      <svg width="100%" height="90" viewBox="0 0 ${width} ${height}" style="overflow:visible;">
        <line x1="${padLeft}" y1="${height - padBottom}" x2="${width - padRight}" y2="${height - padBottom}" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
        <line x1="${padLeft}" y1="${padTop}" x2="${width - padRight}" y2="${padTop}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="2,2" stroke-width="1" />
        
        <text x="${padLeft - 4}" y="${height - padBottom + 3}" fill="#888" font-size="9" text-anchor="end">0%</text>
        <text x="${padLeft - 4}" y="${padTop + 3}" fill="#888" font-size="9" text-anchor="end">${Math.round(maxPct)}%</text>
        
        <text x="${padLeft}" y="${height - 6}" fill="#888" font-size="9" text-anchor="start">0</text>
        <text x="${padLeft + (width - padLeft - padRight) / 2}" y="${height - 6}" fill="#888" font-size="9" text-anchor="middle">20 units</text>
        <text x="${width - padRight}" y="${height - 6}" fill="#888" font-size="9" text-anchor="end">40</text>

        <path d="${areaD}" fill="rgba(86, 204, 157, 0.12)" />
        <path d="${pathD}" fill="none" stroke="#56cc9d" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        
        <line x1="${currX}" y1="${padTop}" x2="${currX}" y2="${height - padBottom}" stroke="#56cc9d" stroke-dasharray="2,2" stroke-width="1" />
        <circle cx="${currX}" cy="${currY}" r="4" fill="#ffffff" stroke="#56cc9d" stroke-width="2" />
      </svg>
    `;
  } catch(e) {
    container.innerHTML = "<div style='font-size:10px;color:#888;text-align:center;'>Curve unavailable</div>";
    console.error(e);
  }
}


// Embed mode
if (new URLSearchParams(window.location.search).get('embed') === '1') {
  document.querySelector('.sidebar').style.display = 'none';
  document.querySelector('.topbar').style.display = 'none';
  document.querySelector('.dashboard-header').style.display = 'none';
  document.querySelector('.app-container').style.gridTemplateColumns = '1fr';
  document.querySelector('.main-wrapper').style.padding = '0';
  document.querySelector('.layout').style.height = '100vh';
}


// AI Query Logic
document.getElementById('aiInput').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const query = e.target.value.trim();
    if (!query) return;
    
    document.getElementById('aiLoading').style.display = 'block';
    try {
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      const data = await res.json();
      console.log('AI Action:', data);
      
      if (data.action === 'top_hotspots') {
         const n = data.n || 5;
         // Simulate sorting/filtering top N
         if (hotspots && hotspots.length > 0) {
           const topN = hotspots.slice(0, n);
           alert(`AI found ${n} top hotspots. Selecting the worst one: District ${topN[0].district}.`);
           selectHotspot(topN[0].cluster_id);
         }
      } else if (data.action === 'filter_district') {
         document.getElementById('searchInput').value = data.district;
         applyFilters();
         alert(`AI applied filter for district: ${data.district}`);
      } else if (data.action === 'explain_score') {
         document.getElementById('searchInput').value = data.school_id;
         applyFilters();
         alert(`AI mapping school ID: ${data.school_id}`);
      } else if (data.action === 'clarify') {
         alert('AI: ' + data.message);
      } else {
         alert('AI did not return a valid action.');
      }
    } catch(err) {
      console.error(err);
      alert('Error querying AI');
    } finally {
      document.getElementById('aiLoading').style.display = 'none';
      e.target.value = '';
    }
  }
});


// Print Logic
document.getElementById('printReportBtn').addEventListener('click', () => {
  if (!activeClusterId || !hotspots) return;
  const hotspot = hotspots.find(h => h.cluster_id === activeClusterId);
  if (!hotspot) return;

  const printSection = document.getElementById('printSection');
  document.getElementById('printTitle').innerText = `Risk Report: ${hotspot.district} District`;
  
  document.getElementById('printStats').innerHTML = `
    <p><strong>Total Schools:</strong> ${hotspot.school_count}</p>
    <p><strong>High Risk Schools:</strong> ${hotspot.high_risk_count}</p>
    <p><strong>Average Risk Score:</strong> ${hotspot.avg_risk.toFixed(2)}</p>
    <p><strong>Cluster Priority Lift:</strong> +${hotspot.risk_lift.toFixed(2)}</p>
  `;
  
  // Also collect schools if available.
  let schoolsHtml = '<p>No specific school list loaded.</p>';
  // the map's schoolLayer has the loaded schools for this district if it's selected
  let loadedSchools = [];
  schoolLayer.eachLayer(layer => {
      if (layer.feature && layer.feature.properties) {
         loadedSchools.push(layer.feature.properties);
      }
  });
  if (loadedSchools.length > 0) {
      schoolsHtml = '<table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">';
      schoolsHtml += '<tr style="border-bottom: 2px solid #333;"><th style="text-align: left; padding: 4px;">School Code</th><th style="text-align: left; padding: 4px;">Name</th><th style="text-align: right; padding: 4px;">Risk Score</th></tr>';
      loadedSchools.sort((a,b) => b.risk_score - a.risk_score).forEach(s => {
          schoolsHtml += `<tr style="border-bottom: 1px solid #ccc;">
            <td style="padding: 4px;">${s.schcd}</td>
            <td style="padding: 4px;">${s.schname}</td>
            <td style="padding: 4px; text-align: right;">${s.risk_score.toFixed(2)}</td>
          </tr>`;
      });
      schoolsHtml += '</table>';
  }
  document.getElementById('printHotspots').innerHTML = schoolsHtml;

  printSection.style.display = 'block';
  window.print();
  printSection.style.display = 'none';
});
