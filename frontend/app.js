const API = "/api";
const KARNATAKA_CENTER = [14.9, 75.7];
const OVERVIEW_ZOOM = 7;

const map = L.map("map", { zoomControl: true, attributionControl: false }).setView(KARNATAKA_CENTER, OVERVIEW_ZOOM);

// High-contrast, watermark-free basemaps (Zero API key required)
const darkCanvasLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
  attribution: "&copy; Esri &mdash; Esri, DeLorme, NAVTEQ",
  maxZoom: 16,
});

const osmLayer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 18,
});

const satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
  attribution: "&copy; Esri &mdash; Earthstar Geographics",
  maxZoom: 18,
});

// Default to Dark Canvas
darkCanvasLayer.addTo(map);

// Add base layer switcher control so users can toggle between Dark Canvas, OSM, and Satellite
L.control.layers({
  "Dark Canvas": darkCanvasLayer,
  "OpenStreetMap": osmLayer,
  "Satellite": satelliteLayer
}, null, { position: "topright" }).addTo(map);

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
let currentFilters = { management: 'all', category: 'all', q: '', risk_tier: 'all', real_weight: 0.5 };
let currentGeofence = null;
let trendChartInstance = null;
let activeTab = "hotspots";
let lastOptimizeResult = null;

// ---- color helpers -------------------------------------------------

let isColorblind = false;
const DEFAULT_LOW = [86, 204, 157];   // #56cc9d green
const DEFAULT_MID = [255, 204, 0];    // #ffcc00 yellow
const DEFAULT_HIGH = [255, 107, 107]; // #ff6b6b coral red

const COLORBLIND_LOW = [44, 123, 182];    // #2c7bb6 high-contrast ocean blue
const COLORBLIND_MID = [253, 184, 99];    // #fdb863 golden amber
const COLORBLIND_HIGH = [123, 50, 148];   // #7b3294 rich purple-violet

let RISK_LOW = DEFAULT_LOW;
let RISK_MID = DEFAULT_MID;
let RISK_HIGH = DEFAULT_HIGH;

function lerp(a, b, t) { return a + (b - a) * t; }

function colorForT(t) {
  t = Math.max(0, Math.min(1, t));
  const [c1, c2] = t < 0.5 ? [RISK_LOW, RISK_MID] : [RISK_MID, RISK_HIGH];
  const tt = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const rgb = c1.map((v, i) => Math.round(lerp(v, c2[i], tt)));
  return `rgb(${rgb.join(",")})`;
}

let TIER_COLOR = { Low: colorForT(0), Medium: colorForT(0.5), High: colorForT(1) };

function updateColorblindState(active) {
  isColorblind = active;
  document.body.classList.toggle("colorblind-mode", isColorblind);
  const btn = document.getElementById("toggleColorblindBtn");
  if (btn) {
    btn.classList.toggle("active", isColorblind);
    btn.title = isColorblind
      ? "Colorblind Mode: Active (Ocean Blue / Amber / Purple)"
      : "Toggle Colorblind-Safe Mode";
  }
  if (isColorblind) {
    RISK_LOW = COLORBLIND_LOW;
    RISK_MID = COLORBLIND_MID;
    RISK_HIGH = COLORBLIND_HIGH;
  } else {
    RISK_LOW = DEFAULT_LOW;
    RISK_MID = DEFAULT_MID;
    RISK_HIGH = DEFAULT_HIGH;
  }
  TIER_COLOR = { Low: colorForT(0), Medium: colorForT(0.5), High: colorForT(1) };

  // 1. Immediately redraw hotspots on the map
  if (hotspots && hotspots.length > 0) {
    drawHotspots();
    drawLedger();
  }

  // 2. Immediately re-style district choropleth polygons on the map
  updateDistrictChoroplethStyles();

  // 3. Immediately re-style any active school markers on the map
  schoolLayer.eachLayer((layer) => {
    const s = layer.schoolData || (layer.feature && layer.feature.properties);
    if (s && s.risk_tier) {
      layer.setStyle({
        fillColor: TIER_COLOR[s.risk_tier] || TIER_COLOR.Medium,
      });
    }
  });

  // 4. Update deployment hub markers if active
  if (lastOptimizeResult && lastOptimizeResult.chosen_sites) {
    drawHubs(lastOptimizeResult.chosen_sites, Number(document.getElementById("radiusInput")?.value || 15));
  }
}

// ---- data loading ----------------------------------------------------


async function fetchWithFilters(endpoint, retries = 4) {
  let url = `${API}/${endpoint}`;
  const params = new URLSearchParams();
  if(currentFilters.management !== 'all') params.append('management', currentFilters.management);
  if(currentFilters.category !== 'all') params.append('category', currentFilters.category);
  if(currentFilters.q) params.append('q', currentFilters.q);
  if(currentFilters.risk_tier && currentFilters.risk_tier !== 'all') params.append('risk_tier', currentFilters.risk_tier);
  params.append('real_weight', currentFilters.real_weight);
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

  if (s.data_quality) {
    const dEl = document.getElementById("qaDup");
    const oEl = document.getElementById("qaOob");
    const mEl = document.getElementById("qaMiss");
    if (dEl) dEl.textContent = s.data_quality.duplicate_schcd ?? s.data_quality.duplicate_ids ?? 0;
    if (oEl) oEl.textContent = s.data_quality.out_of_bounds_coords ?? s.data_quality.out_of_bounds ?? 0;
    if (mEl) mEl.textContent = s.data_quality.missing_fields ?? 0;
  }
}

async function loadHotspots() {
  hotspots = await fetchWithFilters("hotspots");
  maxLift = Math.max(...hotspots.map((h) => h.risk_lift), 0.01);
  drawHotspots();
  drawLedger();
}


let cachedDistrictGeojson = null;
let districtGeoJsonLayer = null;
let cachedRiskNorm = null;
let currentSchoolsList = [];
let currentChoroplethMode = "relative_risk";

function getDistrictFeatureFill(props) {
  if (currentChoroplethMode === "lisa") {
    const norm = typeof props.lisa_norm === "number" ? props.lisa_norm : 0.5;
    return colorForT(norm);
  }
  const normVal = cachedRiskNorm ? cachedRiskNorm(props.avg_risk) : 0.5;
  return colorForT(normVal);
}

function getDistrictTooltipHTML(p) {
  if (currentChoroplethMode === "lisa") {
    const clusterLabel = p.lisa_label || p.lisa_cluster || "Not Significant";
    const iVal = typeof p.lisa_i === "number" ? (p.lisa_i > 0 ? `+${p.lisa_i}` : p.lisa_i) : "0.0";
    const lagVal = typeof p.lisa_lag === "number" ? (p.lisa_lag > 0 ? `+${p.lisa_lag}` : p.lisa_lag) : "0.0";
    return `<strong>${p.display_name}</strong><br/>Spatial Cluster: <strong>${clusterLabel}</strong><br/>Local Moran's I: ${iVal} (Lag: ${lagVal})<br/>${p.school_count.toLocaleString()} Schools · Avg risk ${p.avg_risk}`;
  }
  const liftStr = typeof p.risk_lift === "number" ? (p.risk_lift > 0 ? `+${p.risk_lift}` : p.risk_lift) : "";
  return `<strong>${p.display_name}</strong><br/>${p.school_count.toLocaleString()} Schools · Avg risk ${p.avg_risk}${liftStr ? ` · Lift ${liftStr}` : ''}`;
}

function setChoroplethMode(mode) {
  currentChoroplethMode = mode;
  document.getElementById("btnChoroplethRisk")?.classList.toggle("active", mode === "relative_risk");
  document.getElementById("btnChoroplethLisa")?.classList.toggle("active", mode === "lisa");
  
  if (legendEl && activeTab === "hotspots") {
    legendEl.innerHTML = getHotspotLegendHTML();
  }
  updateDistrictChoroplethStyles();
}

function updateDistrictChoroplethStyles() {
  if (districtGeoJsonLayer) {
    districtGeoJsonLayer.eachLayer((layer) => {
      if (layer.feature && layer.feature.properties) {
        const p = layer.feature.properties;
        layer.setStyle({
          fillColor: getDistrictFeatureFill(p),
        });
        if (layer.getTooltip()) {
          layer.setTooltipContent(getDistrictTooltipHTML(p));
        }
      }
    });
  } else if (cachedDistrictGeojson) {
    renderDistrictChoropleth(cachedDistrictGeojson);
  }
}

function renderDistrictChoropleth(geojson) {
  districtLayer.clearLayers();
  cachedDistrictGeojson = geojson;

  if (geojson.lisa_summary) {
    const agreeEl = document.getElementById("lisaAgreementText");
    if (agreeEl && geojson.lisa_summary.interpretation) {
      agreeEl.textContent = geojson.lisa_summary.interpretation;
    }
  }

  const risks = geojson.features.map((f) => f.properties.avg_risk);
  const lo = Math.min(...risks), hi = Math.max(...risks);
  cachedRiskNorm = (v) => (hi > lo ? (v - lo) / (hi - lo) : 0.5);

  districtGeoJsonLayer = L.geoJSON(geojson, {
    style: (feature) => ({
      color: "rgba(255,255,255,0.15)",
      weight: 1,
      fillColor: getDistrictFeatureFill(feature.properties),
      fillOpacity: 0.35,
    }),
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      layer.bindTooltip(
        getDistrictTooltipHTML(p),
        { sticky: true }
      );
      layer.on("mouseover", () => layer.setStyle({ weight: 2, color: "rgba(255,255,255,0.5)", fillOpacity: 0.55 }));
      layer.on("mouseout", () => {
        layer.setStyle({ weight: 1, color: "rgba(255,255,255,0.15)", fillOpacity: 0.35, fillColor: getDistrictFeatureFill(p) });
      });
      layer.on("click", () => { if (p.history) renderChart(p.display_name, p.history); });
      layer.on("click", () => map.flyToBounds(layer.getBounds(), { duration: 0.6, maxZoom: 9 }));
    },
  }).addTo(districtLayer);
}

async function loadDistrictChoropleth() {
  const geojson = await fetchWithFilters("districts/geojson");
  renderDistrictChoropleth(geojson);
}

document.getElementById("btnChoroplethRisk")?.addEventListener("click", () => setChoroplethMode("relative_risk"));
document.getElementById("btnChoroplethLisa")?.addEventListener("click", () => setChoroplethMode("lisa"));

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
  currentSchoolsList = list || [];
  schoolLayer.clearLayers();
  currentSchoolsList.forEach((s) => {
    const isLowConf = s.confidence === "Low";
    const marker = L.circleMarker([s.lat, s.lon], {
      radius: 6,
      color: isLowConf ? "#ffffff" : "rgba(255,255,255,0.5)",
      weight: isLowConf ? 2 : 1,
      dashArray: isLowConf ? "3, 3" : null,
      fillColor: TIER_COLOR[s.risk_tier] || TIER_COLOR.Medium,
      fillOpacity: 0.9,
    });
    marker.schoolData = s;
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
  params.append('real_weight', currentFilters.real_weight);
  const r = await fetch(`${API}/schools?${params.toString()}`);

  const schools = await r.json();
  drawSchools(schools);

  map.flyTo([hotspot.centroid_lat, hotspot.centroid_lon], 12, { duration: 0.6 });
  setActiveLedgerRow(clusterId);
  document.getElementById('printReportBtn').style.display = 'inline-flex';
  resetBtn.hidden = false;

  if (hotspot && hotspot.district) {
    syncWhatIfWithDistrict(hotspot.district);
  }
}

resetBtn.addEventListener("click", () => {
  activeClusterId = null;
  currentSchoolsList = [];
  schoolLayer.clearLayers();
  map.flyTo(KARNATAKA_CENTER, OVERVIEW_ZOOM, { duration: 0.6 });
  setActiveLedgerRow(null);
  resetBtn.hidden = true;
  document.getElementById('printReportBtn').style.display = 'none';
});

// ---- deploy-units tab ------------------------------------------------

function getHotspotLegendHTML() {
  const lowText = currentChoroplethMode === 'lisa' ? 'Coldspot (Low-Low)' : 'Lower Risk';
  const hiText = currentChoroplethMode === 'lisa' ? 'Hotspot (High-High)' : 'Higher Risk';
  return `
  <span class="legend-title">${currentChoroplethMode === 'lisa' ? 'Spatial Autocorrelation' : 'Risk Level'}</span>
  <div class="legend-scale"><span class="swatch low"></span><span class="swatch mid"></span><span class="swatch high"></span></div>
  <div class="legend-labels" style="width: 140px;"><span id="legendLowLabel">${lowText}</span><span id="legendHighLabel">${hiText}</span></div>
  <div class="legend-labels" style="width: auto; margin-top:8px; display: block; line-height: 1.4;">
    <div style="margin-bottom: 2px;">${currentChoroplethMode === 'lisa' ? 'Shaded = Moran\'s I Cluster' : 'Shaded Areas = District Average'}</div>
    <div>Circles = Risk Hotspots</div>
  </div>
`;
}
const DEPLOY_LEGEND = `
  <span class="legend-title">Deployment Plan</span>
  <div class="legend-labels" style="margin-top:6px;"><span>&#9670; Proposed Mobile Unit Base</span></div>
  <div class="legend-labels"><span>Dashed circle = Service Area</span></div>
`;

function switchTab(tab) {
  activeTab = tab;
  const isHotspots = tab === "hotspots";
  const isDeploy = tab === "deploy";
  const isFairness = tab === "fairness";
  const isAbout = tab === "about";

  document.getElementById("navHotspots").classList.toggle("active", isHotspots);
  document.getElementById("navDeploy").classList.toggle("active", isDeploy);
  document.getElementById("navFairness")?.classList.toggle("active", isFairness);
  document.getElementById("navAbout").classList.toggle("active", isAbout);
  
  document.getElementById("hotspotsPanel").hidden = !isHotspots;
  document.getElementById("deployPanel").hidden = !isDeploy;
  const aboutPanelEl = document.getElementById("aboutPanel");
  if (aboutPanelEl) aboutPanelEl.hidden = !isAbout;

  const layoutEl = document.querySelector(".layout");
  const infoViewEl = document.getElementById("infoView");
  const fairnessViewEl = document.getElementById("fairnessView");
  const headerTitle = document.getElementById("mainHeaderTitle");
  const statStrip = document.getElementById("statStrip");
  const topbarFilters = [
    document.getElementById("filterManagement"),
    document.getElementById("filterCategory"),
    document.getElementById("toggleColorblindBtn"),
    document.getElementById("exportCsvBtn"),
    document.getElementById("printReportBtn")
  ];
  
  const breadcrumb = document.getElementById("currentViewBreadcrumb");

  if (isFairness) {
    if (layoutEl) layoutEl.style.display = "none";
    if (infoViewEl) infoViewEl.hidden = true;
    if (fairnessViewEl) fairnessViewEl.hidden = false;
    topbarFilters.forEach((el) => { if (el) el.style.display = "none"; });
    if (breadcrumb) breadcrumb.textContent = "Fairness & Demographic Parity Audit";
    if (headerTitle) headerTitle.textContent = "Model Fairness Audit";
    if (statStrip) statStrip.style.display = "none";
    loadFairnessAudit();
  } else if (isAbout) {
    if (layoutEl) layoutEl.style.display = "none";
    if (infoViewEl) infoViewEl.hidden = false;
    if (fairnessViewEl) fairnessViewEl.hidden = true;
    topbarFilters.forEach((el) => { if (el) el.style.display = "none"; });
    if (breadcrumb) breadcrumb.textContent = "Information & Methodology";
    if (headerTitle) headerTitle.textContent = "Project Information";
    if (statStrip) statStrip.style.display = "none";
  } else {
    if (layoutEl) layoutEl.style.display = "grid";
    if (infoViewEl) infoViewEl.hidden = true;
    if (fairnessViewEl) fairnessViewEl.hidden = true;
    topbarFilters.forEach((el) => {
      if (el && el.id !== "printReportBtn") el.style.display = "";
    });
    if (statStrip) statStrip.style.display = "flex";
    if (headerTitle) headerTitle.textContent = "Hotspot Mapper";
    if (breadcrumb) {
      breadcrumb.textContent = isHotspots ? "Hotspots Overview" : "Deployment Plan";
    }
    // Refresh Leaflet container dimensions when restoring the map
    setTimeout(() => { map.invalidateSize(); }, 60);
  }

  // Handle map layers
  if (isHotspots) {
    map.addLayer(districtLayer);
    map.addLayer(hotspotLayer);
    map.addLayer(schoolLayer);
    map.removeLayer(hubLayer);
    legendEl.innerHTML = getHotspotLegendHTML();
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
  }
}

function switchHotspotsSubtab(subtab) {
  const isStats = subtab === "stats";
  document.getElementById("subtabDistrictStats")?.classList.toggle("active", isStats);
  document.getElementById("subtabWhatIf")?.classList.toggle("active", !isStats);
  
  const viewStats = document.getElementById("viewDistrictStats");
  const viewWhatIf = document.getElementById("viewWhatIf");
  if (viewStats) viewStats.hidden = !isStats;
  if (viewWhatIf) viewWhatIf.hidden = isStats;

  if (!isStats) {
    runWhatIfSimulation();
  }
}

document.getElementById("navHotspots").addEventListener("click", () => switchTab("hotspots"));
document.getElementById("navDeploy").addEventListener("click", () => switchTab("deploy"));
document.getElementById("navFairness")?.addEventListener("click", () => switchTab("fairness"));
document.getElementById("navAbout").addEventListener("click", () => switchTab("about"));
document.getElementById("infoReturnBtn")?.addEventListener("click", () => switchTab("hotspots"));
document.getElementById("fairnessReturnBtn")?.addEventListener("click", () => switchTab("hotspots"));
document.getElementById("subtabDistrictStats")?.addEventListener("click", () => switchHotspotsSubtab("stats"));
document.getElementById("subtabWhatIf")?.addEventListener("click", () => switchHotspotsSubtab("whatif"));
document.getElementById("btnSwitchToDistrictStats")?.addEventListener("click", () => switchHotspotsSubtab("stats"));
document.getElementById("toggleColorblindBtn")?.addEventListener("click", () => updateColorblindState(!isColorblind));


document.getElementById("equityInput").addEventListener("change", (e) => {
  document.getElementById("capInput").disabled = !e.target.checked;
});

function drawHubs(chosenSites, radiusKm) {
  hubLayer.clearLayers();
  const hubColor = isColorblind ? "rgba(44, 123, 182, 0.95)" : "rgba(86, 204, 157, 0.95)";
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
      fillColor: hubColor,
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
        borderColor: isColorblind ? '#2c7bb6' : '#56cc9d',
        backgroundColor: isColorblind ? 'rgba(44, 123, 182, 0.25)' : 'rgba(86, 204, 157, 0.2)',
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


// AI Query Logic & Sidebar Insights Card (Zero interference with map)
function showAiMessage(query, message, actionText = null) {
  const card = document.getElementById('aiChatPopover');
  const queryEl = document.getElementById('aiChatQuery');
  const msgEl = document.getElementById('aiChatMsg');
  const badgeEl = document.getElementById('aiActionBadge');
  const cardContent = document.getElementById('aiCardContent');
  const minimizeBtn = document.getElementById('aiMinimizeBtn');
  const topbarPill = document.getElementById('aiTopPill');
  if (!card || !msgEl) return;

  // Restore expanded state if was minimized
  card.classList.remove('minimized');
  if (cardContent) cardContent.style.display = 'block';
  if (minimizeBtn) {
    minimizeBtn.innerHTML = '&minus;';
    minimizeBtn.title = 'Minimize';
  }

  if (queryEl) queryEl.textContent = query ? `Q: "${query}"` : '';
  msgEl.textContent = message;

  if (actionText && badgeEl) {
    badgeEl.textContent = actionText;
    badgeEl.style.display = 'inline-flex';
  } else if (badgeEl) {
    badgeEl.style.display = 'none';
  }

  // Display the card in the sidebar ledger
  card.style.display = 'block';

  // Highlight pulse animation
  card.classList.remove('ai-pulse');
  void card.offsetWidth; // Trigger reflow
  card.classList.add('ai-pulse');

  // Activate topbar indicator pill
  if (topbarPill) {
    topbarPill.style.display = 'inline-flex';
  }

  // Ensure sidebar scrolls to top so AI insights are immediately visible
  const ledger = document.querySelector('.ledger');
  if (ledger) {
    ledger.scrollTop = 0;
  }
}

function hideAiMessage() {
  const card = document.getElementById('aiChatPopover');
  const topbarPill = document.getElementById('aiTopPill');
  if (card) card.style.display = 'none';
  if (topbarPill) topbarPill.style.display = 'none';
}

function toggleAiMinimize() {
  const card = document.getElementById('aiChatPopover');
  const cardContent = document.getElementById('aiCardContent');
  const minimizeBtn = document.getElementById('aiMinimizeBtn');
  if (!card || !cardContent) return;

  const isMin = card.classList.toggle('minimized');
  if (isMin) {
    cardContent.style.display = 'none';
    if (minimizeBtn) {
      minimizeBtn.innerHTML = '&#43;';
      minimizeBtn.title = 'Expand';
    }
  } else {
    cardContent.style.display = 'block';
    if (minimizeBtn) {
      minimizeBtn.innerHTML = '&minus;';
      minimizeBtn.title = 'Minimize';
    }
  }
}

document.getElementById('aiCloseBtn')?.addEventListener('click', hideAiMessage);
document.getElementById('aiMinimizeBtn')?.addEventListener('click', toggleAiMinimize);
document.getElementById('aiTopPill')?.addEventListener('click', () => {
  const card = document.getElementById('aiChatPopover');
  if (card) {
    card.style.display = 'block';
    card.classList.remove('minimized');
    const content = document.getElementById('aiCardContent');
    if (content) content.style.display = 'block';
    const ledger = document.querySelector('.ledger');
    if (ledger) ledger.scrollTop = 0;
  }
});

// Dismiss AI card on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const card = document.getElementById('aiChatPopover');
    if (card && card.style.display !== 'none') {
      hideAiMessage();
    }
  }
});

// Delegated or direct click for suggestion chips
document.querySelectorAll('.ai-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const q = chip.getAttribute('data-query');
    if (q) {
      const input = document.getElementById('aiInput');
      if (input) input.value = q;
      handleAiQuery(q);
    }
  });
});

async function handleAiQuery(query) {
  if (!query) return;
  const loadingEl = document.getElementById('aiLoading');
  if (loadingEl) loadingEl.style.display = 'block';

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await res.json();

    // Ensure map and ledger layout is active if query is spatial
    const ensureLayoutVisible = () => {
      const infoView = document.getElementById("infoView");
      const fairnessView = document.getElementById("fairnessView");
      if ((infoView && !infoView.hidden) || (fairnessView && !fairnessView.hidden)) {
        switchTab("hotspots");
      }
    };

    if (data.action === 'top_hotspots') {
      ensureLayoutVisible();
      const n = data.n || 5;
      if (hotspots && hotspots.length > 0) {
        const topN = hotspots.slice(0, n);
        selectHotspot(topN[0].cluster_id);
        showAiMessage(
          query,
          data.message || `Identified top ${n} high-priority dropout risk hotspots across Karnataka.`,
          `Action: Selected #${topN[0].cluster_id} in ${topN[0].district}`
        );
      } else {
        showAiMessage(query, data.message || `Identified top ${n} hotspots.`);
      }
    } else if (data.action === 'filter_district') {
      ensureLayoutVisible();
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = data.district;
        applyFilters();
      }
      showAiMessage(
        query,
        data.message || `Filtered view and analytics for ${data.district} district.`,
        `Action: Filtered by ${data.district}`
      );
    } else if (data.action === 'explain_score') {
      ensureLayoutVisible();
      const searchInput = document.getElementById('searchInput');
      if (searchInput) {
        searchInput.value = data.school_id;
        applyFilters();
      }
      showAiMessage(
        query,
        data.message || `Located school ${data.school_id}.`,
        `Action: Located school ${data.school_id}`
      );
    } else if (data.action === 'fairness_audit') {
      switchTab("fairness");
      showAiMessage(
        query,
        data.message || "Viewing Model Fairness & Demographic Parity Audit across gender and urban/rural divides.",
        "Action: Switched to Fairness Audit"
      );
    } else if (data.action === 'what_if') {
      ensureLayoutVisible();
      switchHotspotsSubtab("whatif");
      if (data.district) {
        const select = document.getElementById("whatIfDistrictSelect");
        if (select) {
          select.value = data.district;
          runWhatIfSimulation();
        }
      }
      showAiMessage(
        query,
        data.message || "Opened the What-If Infrastructure Simulator in the sidebar.",
        `Action: ${data.district ? data.district + ' Simulator' : 'What-If Mode'}`
      );
    } else {
      showAiMessage(query, data.message || "Here is information based on your query.", null);
    }
  } catch (err) {
    console.error(err);
    showAiMessage(query, "Sorry, I encountered an issue processing that query. Please try again.", null);
  } finally {
    if (loadingEl) loadingEl.style.display = 'none';
  }
}

document.getElementById('aiInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const query = e.target.value.trim();
    if (query) handleAiQuery(query);
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


let weightTimeout = null;
document.addEventListener('DOMContentLoaded', () => {
    const slider = document.getElementById('realWeightSlider');
    if(slider) {
        slider.addEventListener('input', (e) => {
          const val = parseFloat(e.target.value);
          document.getElementById('weightValue').innerText = val.toFixed(2);
          currentFilters.real_weight = val;
          
          if (weightTimeout) clearTimeout(weightTimeout);
          weightTimeout = setTimeout(() => {
            applyFilters();
            runWhatIfSimulation();
            if (activeTab === "about" || activeTab === "fairness") {
              loadFairnessAudit();
            }
          }, 300);
        });
    }

    initWhatIfSimulator();
});

// =========================================================
// Task 20: What-If Infrastructure Simulator
// =========================================================

let whatIfDistricts = [];
let whatIfCurrentDistrict = null;
let whatIfFixedSet = new Set();
let whatIfDebounceTimer = null;

async function initWhatIfSimulator() {
  const selectEl = document.getElementById("whatIfDistrictSelect");
  if (!selectEl) return;

  try {
    const res = await fetch(`${API}/whatif/districts`);
    whatIfDistricts = await res.json();
    if (!Array.isArray(whatIfDistricts) || whatIfDistricts.length === 0) return;

    selectEl.innerHTML = whatIfDistricts.map(d => 
      `<option value="${d.district_name}">${d.display_name} (${d.total_schools.toLocaleString()} schools)</option>`
    ).join("");

    // Default to Chamarajanagara if available, or first district
    const defaultDist = whatIfDistricts.find(d => d.district_name.toUpperCase().includes("CHAMARAJA")) || whatIfDistricts[0];
    selectEl.value = defaultDist.district_name;
    whatIfCurrentDistrict = defaultDist;

    renderWhatIfToggles();
    runWhatIfSimulation();

    selectEl.addEventListener("change", (e) => {
      const found = whatIfDistricts.find(d => d.district_name === e.target.value);
      if (found) {
        whatIfCurrentDistrict = found;
        whatIfFixedSet.clear();
        renderWhatIfToggles();
        runWhatIfSimulation();
      }
    });
  } catch (err) {
    console.error("Failed to load whatif districts:", err);
  }
}

function syncWhatIfWithDistrict(districtName) {
  if (!districtName || !whatIfDistricts.length) return;
  const match = whatIfDistricts.find(d => 
    d.district_name.toLowerCase().trim() === districtName.toLowerCase().trim() ||
    d.display_name.toLowerCase().trim() === districtName.toLowerCase().trim()
  );
  if (match) {
    const sel = document.getElementById("whatIfDistrictSelect");
    if (sel && sel.value !== match.district_name) {
      sel.value = match.district_name;
      whatIfCurrentDistrict = match;
      whatIfFixedSet.clear();
      renderWhatIfToggles();
      runWhatIfSimulation();
    }
  }
}

function renderWhatIfToggles() {
  const container = document.getElementById("whatIfToggles");
  if (!container || !whatIfCurrentDistrict) return;

  const d = whatIfCurrentDistrict;
  const dims = [
    { id: "toilets", name: "Toilets", gap: d.toilets_gap_pct },
    { id: "library", name: "Library", gap: d.library_gap_pct },
    { id: "computer", name: "Computer Lab", gap: d.computer_gap_pct },
    { id: "internet", name: "Internet Access", gap: d.internet_gap_pct }
  ];

  container.innerHTML = dims.map(dim => {
    const isChecked = whatIfFixedSet.has(dim.id);
    return `
      <div class="whatif-row ${isChecked ? 'active' : ''}">
        <div class="whatif-dim-meta">
          <span class="whatif-dim-name">${dim.name}</span>
          <span class="whatif-dim-gap">${dim.gap}% gap</span>
        </div>
        <label class="switch" title="Toggle infrastructure fix for ${dim.name}">
          <input type="checkbox" data-dim="${dim.id}" ${isChecked ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `;
  }).join("");

  container.querySelectorAll("input[type='checkbox']").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const dimId = e.target.getAttribute("data-dim");
      if (e.target.checked) {
        whatIfFixedSet.add(dimId);
      } else {
        whatIfFixedSet.delete(dimId);
      }
      e.target.closest(".whatif-row").classList.toggle("active", e.target.checked);
      runWhatIfSimulation();
    });
  });
}

async function runWhatIfSimulation() {
  if (!whatIfCurrentDistrict) return;
  if (whatIfDebounceTimer) clearTimeout(whatIfDebounceTimer);

  whatIfDebounceTimer = setTimeout(async () => {
    try {
      const payload = {
        district: whatIfCurrentDistrict.district_name,
        fix: Array.from(whatIfFixedSet),
        real_weight: currentFilters.real_weight
      };

      const res = await fetch(`${API}/whatif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!data || data.error) {
        console.error("What-if simulation error:", data?.error);
        return;
      }

      const nowRiskEl = document.getElementById("whatIfNowRisk");
      const nowHighEl = document.getElementById("whatIfNowHigh");
      const fixedRiskEl = document.getElementById("whatIfFixedRisk");
      const fixedHighEl = document.getElementById("whatIfFixedHigh");
      const rankShiftEl = document.getElementById("whatIfRankShift");

      if (nowRiskEl) nowRiskEl.textContent = data.before.avg_risk.toFixed(3);
      if (nowHighEl) nowHighEl.textContent = `${data.before.high_risk_count.toLocaleString()} High-Risk`;

      if (fixedRiskEl) {
        const pct = data.reduction.risk_reduction_pct;
        const pctTxt = pct > 0 ? ` (-${pct}%)` : "";
        fixedRiskEl.textContent = `${data.after.avg_risk.toFixed(3)}${pctTxt}`;
      }
      if (fixedHighEl) {
        const prev = data.reduction.high_risk_prevented;
        const prevTxt = prev > 0 ? ` (${prev.toLocaleString()} fixed)` : "";
        fixedHighEl.textContent = `${data.after.high_risk_count.toLocaleString()} High-Risk${prevTxt}`;
      }
      if (rankShiftEl) {
        rankShiftEl.textContent = data.reduction.hotspot_rank_change || "Unchanged";
      }
    } catch (err) {
      console.error("What-if simulation call failed:", err);
    }
  }, 100);
}

// =========================================================
// Task 22: Fairness & Demographic Parity Audit
// =========================================================

async function loadFairnessAudit() {
  const tbody = document.getElementById("fairnessTableBody");
  if (!tbody) return;

  try {
    const res = await fetch(`${API}/fairness-audit?real_weight=${currentFilters.real_weight}`);
    const data = await res.json();
    if (!data || !data.groups) return;

    tbody.innerHTML = data.groups.map(g => `
      <tr>
        <td>
          <span class="fairness-group-name">${g.group_name}</span>
          <span class="fairness-dim-tag">${g.dimension}</span>
        </td>
        <td class="fairness-num">${g.pct_of_schools.toFixed(1)}% (${g.school_count.toLocaleString()})</td>
        <td class="fairness-num">${g.pct_of_high_risk.toFixed(1)}% (${g.high_risk_count.toLocaleString()})</td>
        <td class="fairness-num" style="font-weight: 600;">${g.observed_ratio.toFixed(2)}&times;</td>
        <td class="fairness-num" style="color: var(--text-muted);">${g.expected_ratio.toFixed(2)}&times;</td>
        <td><span class="${g.tag_class}">${g.tag}</span></td>
        <td class="fairness-formula-note">${g.formula_weight_note} &middot; <span style="color: rgba(255,255,255,0.7);">${g.note}</span></td>
      </tr>
    `).join("");
  } catch (err) {
    console.error("Fairness audit load failed:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="color: var(--risk-high); padding: 16px;">Failed to load fairness audit telemetry.</td></tr>`;
  }
}

