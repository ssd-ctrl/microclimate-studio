import { getEnvironmentalProfile } from "./environment.js";
import { generateLayout } from "./generator.js";

const map = L.map("map").setView([30.2672, -97.7431], 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const zoneLayer = L.layerGroup().addTo(map);
const boundaryLayer = L.layerGroup().addTo(map);
const siteMarker = L.marker([30.2672, -97.7431]).addTo(map);

const form = document.getElementById("site-form");
const results = document.getElementById("results");
const submitButton = form.querySelector("button[type='submit']");
const locationQueryInput = document.getElementById("location-query");
const findLocationButton = document.getElementById("find-location");
const latitudeInput = document.getElementById("latitude");
const longitudeInput = document.getElementById("longitude");
const boundaryText = document.getElementById("boundary-geojson");
const captureButton = document.getElementById("capture-boundary");
const clearBoundaryButton = document.getElementById("clear-boundary");
const exportJsonButton = document.getElementById("export-json");
const exportReportButton = document.getElementById("export-report");

let boundaryPoints = [];
let captureMode = false;
let currentRun = null;

async function geocodeLocation(query) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`Location search failed (${response.status})`);
  }

  const matches = await response.json();
  if (!Array.isArray(matches) || matches.length === 0) {
    throw new Error("No location matches found. Try a fuller address or city/state.");
  }

  return {
    latitude: Number(matches[0].lat),
    longitude: Number(matches[0].lon),
    label: matches[0].display_name
  };
}

function toPolygonFromText(value) {
  if (!value.trim()) {
    return null;
  }

  const parsed = JSON.parse(value);
  if (parsed.type !== "Polygon" || !Array.isArray(parsed.coordinates?.[0])) {
    throw new Error("Boundary must be a GeoJSON Polygon.");
  }

  return parsed.coordinates[0].map(([lng, lat]) => [lat, lng]);
}

function polygonToGeoJson(latlngs) {
  const closed = [...latlngs];
  if (latlngs.length > 0) {
    const first = latlngs[0];
    const last = latlngs[latlngs.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      closed.push(first);
    }
  }

  return {
    type: "Polygon",
    coordinates: [closed.map(([lat, lng]) => [lng, lat])]
  };
}

function drawBoundary(latlngs) {
  boundaryLayer.clearLayers();
  if (!latlngs || latlngs.length < 3) {
    return;
  }

  L.polygon(latlngs, {
    color: "#2f5d7c",
    fillColor: "#84b5d8",
    fillOpacity: 0.18,
    weight: 2
  }).addTo(boundaryLayer);
}

function renderResults(site, env, layout) {
  const sourceBadges = (env.sources || ["unknown-source"]).map(
    (source) => `<span class="badge green">${source}</span>`
  );

  results.innerHTML = `
    <h2>${site.siteName || "Generated Site Concept"}</h2>
    <div>
      <span class="badge green">${env.hardinessZone}</span>
      <span class="badge green">${env.soil.type}</span>
      <span class="badge warn">${env.rainfall.annualMM} mm/yr rain</span>
    </div>
    <div>${sourceBadges.join("")}</div>
    <p>${env.sun.designHint}</p>
    <p><strong>Program Areas:</strong></p>
    <p>Vegetation: ${layout.metrics.vegetatedAreaM2} m2</p>
    <p>Hardscape: ${layout.metrics.hardscapeAreaM2} m2</p>
    <p>Drainage: ${layout.metrics.drainageAreaM2} m2</p>
    <p><strong>Recommendations:</strong></p>
    <ul>
      ${layout.recommendations.map((r) => `<li>${r}</li>`).join("")}
    </ul>
  `;
}

function renderZones(layout) {
  zoneLayer.clearLayers();

  layout.zones.forEach((zone) => {
    if (zone.polygon) {
      L.polygon(zone.polygon, {
        color: zone.color,
        fillColor: zone.color,
        fillOpacity: 0.24,
        weight: 1.5
      })
        .bindPopup(zone.kind)
        .addTo(zoneLayer);
      return;
    }

    L.circle(zone.center, {
      radius: zone.radius,
      color: zone.color,
      fillColor: zone.color,
      fillOpacity: 0.32,
      weight: 1.5
    })
      .bindPopup(zone.kind)
      .addTo(zoneLayer);
  });
}

function setGeneratingState(isGenerating) {
  submitButton.disabled = isGenerating;
  submitButton.textContent = isGenerating ? "Generating..." : "Generate Layout";
}

function createDownload(filename, content, contentType) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

map.on("click", (event) => {
  if (!captureMode) {
    return;
  }

  boundaryPoints.push([event.latlng.lat, event.latlng.lng]);
  drawBoundary(boundaryPoints);

  if (boundaryPoints.length >= 3) {
    boundaryText.value = JSON.stringify(polygonToGeoJson(boundaryPoints));
  }
});

findLocationButton.addEventListener("click", async () => {
  const query = locationQueryInput.value.trim();
  if (!query) {
    results.innerHTML = "<h2>Results</h2><p>Enter an address or place name first.</p>";
    return;
  }

  findLocationButton.disabled = true;
  findLocationButton.textContent = "Finding...";

  try {
    const match = await geocodeLocation(query);
    latitudeInput.value = match.latitude.toFixed(6);
    longitudeInput.value = match.longitude.toFixed(6);
    siteMarker.setLatLng([match.latitude, match.longitude]);
    map.setView([match.latitude, match.longitude], 14);
    results.innerHTML = `<h2>Results</h2><p>Found: ${match.label}</p>`;
  } catch (error) {
    results.innerHTML = `<h2>Results</h2><p>Location search failed: ${error.message}</p>`;
  } finally {
    findLocationButton.disabled = false;
    findLocationButton.textContent = "Find Location";
  }
});

captureButton.addEventListener("click", () => {
  captureMode = !captureMode;
  captureButton.textContent = captureMode ? "Stop Capture" : "Capture Boundary";
});

clearBoundaryButton.addEventListener("click", () => {
  boundaryPoints = [];
  boundaryText.value = "";
  drawBoundary([]);
});

exportJsonButton.addEventListener("click", () => {
  if (!currentRun) {
    results.innerHTML = "<h2>Results</h2><p>Generate a concept first, then export JSON.</p>";
    return;
  }

  createDownload(
    `microclimate-concept-${Date.now()}.json`,
    JSON.stringify(currentRun, null, 2),
    "application/json"
  );
});

exportReportButton.addEventListener("click", () => {
  if (!currentRun) {
    results.innerHTML = "<h2>Results</h2><p>Generate a concept first, then export a report.</p>";
    return;
  }

  const { site, env, layout } = currentRun;
  const report = `
Microclimate Studio Concept Report
Generated: ${layout.generatedAt}

Site: ${site.siteName || "Untitled Site"}
Coordinates: ${site.latitude}, ${site.longitude}
Area: ${site.siteAreaM2} m2
Slope: ${site.slopePercent}%
Boundary Provided: ${site.boundary ? "Yes" : "No"}

Environmental Profile
- Hardiness Zone: ${env.hardinessZone}
- Soil: ${env.soil.type} (${env.soil.drainageClass})
- Rainfall: ${env.rainfall.annualMM} mm/year (${env.rainfall.stormIntensity})
- Sun Exposure: ${env.sun.exposureBand}
- Data Sources: ${(env.sources || []).join(", ")}

Program Areas
- Vegetation: ${layout.metrics.vegetatedAreaM2} m2
- Hardscape: ${layout.metrics.hardscapeAreaM2} m2
- Drainage: ${layout.metrics.drainageAreaM2} m2

Recommendations
${layout.recommendations.map((item) => `- ${item}`).join("\n")}
`.trim();

  createDownload(`microclimate-report-${Date.now()}.txt`, report, "text/plain");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const site = {
    siteName: document.getElementById("site-name").value.trim(),
    latitude: Number(latitudeInput.value),
    longitude: Number(longitudeInput.value),
    siteAreaM2: Number(document.getElementById("site-area").value),
    slopePercent: Number(document.getElementById("slope").value)
  };

  try {
    const boundary = toPolygonFromText(boundaryText.value);
    site.boundary = boundary;
    drawBoundary(boundary);

    setGeneratingState(true);
    results.innerHTML = "<h2>Results</h2><p>Pulling environmental data and generating layout...</p>";

    const env = await getEnvironmentalProfile(site);
    const layout = generateLayout(site, env);

    siteMarker.setLatLng([site.latitude, site.longitude]);
    map.setView([site.latitude, site.longitude], 14);

    renderResults(site, env, layout);
    renderZones(layout);

    currentRun = { site, env, layout };
  } catch (error) {
    results.innerHTML = `<h2>Results</h2><p>Generation failed: ${error.message}</p>`;
  } finally {
    setGeneratingState(false);
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // No-op to keep app functional if SW registration fails.
  });
}
