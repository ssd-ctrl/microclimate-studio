function areaRadiusMeters(siteAreaM2) {
  return Math.sqrt(siteAreaM2 / Math.PI);
}

function metersToLatDegrees(meters) {
  return meters / 110540;
}

function metersToLngDegrees(meters, latitude) {
  return meters / (111320 * Math.cos((latitude * Math.PI) / 180));
}

function centroid(latlngs) {
  const totals = latlngs.reduce((acc, [lat, lng]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }), { lat: 0, lng: 0 });
  return [totals.lat / latlngs.length, totals.lng / latlngs.length];
}

function scalePolygon(latlngs, factor) {
  const [cLat, cLng] = centroid(latlngs);
  return latlngs.map(([lat, lng]) => [cLat + (lat - cLat) * factor, cLng + (lng - cLng) * factor]);
}

function translatePolygon(latlngs, deltaLat, deltaLng) {
  return latlngs.map(([lat, lng]) => [lat + deltaLat, lng + deltaLng]);
}

function normalizeVector([x, y]) {
  const length = Math.hypot(x, y) || 1;
  return [x / length, y / length];
}

function slopeDirectionVector(latitude, longitude) {
  const seedA = Math.sin(latitude * 8.3 + longitude * 5.1);
  const seedB = Math.cos(latitude * 4.4 - longitude * 6.2);
  return normalizeVector([seedA, seedB]);
}

function createDefaultBoundary(site) {
  const radiusM = Math.max(18, areaRadiusMeters(site.siteAreaM2));
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    const t = (Math.PI * 2 * i) / 10;
    const lat = site.latitude + metersToLatDegrees(Math.sin(t) * radiusM * 1.15);
    const lng = site.longitude + metersToLngDegrees(Math.cos(t) * radiusM, site.latitude);
    points.push([lat, lng]);
  }
  return points;
}

function createFlowLinesForBoundary(boundary, drainageBoundary, downslope, slopeFactor) {
  const [dLat, dLng] = downslope;
  const length = 0.00045 * slopeFactor;
  return boundary.map(([lat, lng], index) => {
    const end = index < drainageBoundary.length ? drainageBoundary[index] : [lat + dLat * length, lng + dLng * length];
    return { path: [[lat, lng], end], strength: slopeFactor };
  });
}

function createBoundaryZones(boundary, site, vegetatedPct, hardscapePct) {
  const slopeFactor = site.slopePercent > 6 ? 1.25 : site.slopePercent > 2 ? 1 : 0.85;
  const hardscapeInnerFactor = Math.max(0.38, 1 - vegetatedPct * 0.95);
  const drainageInnerFactor = Math.max(0.18, hardscapeInnerFactor - hardscapePct * 0.75);

  const hardscapeBoundary = scalePolygon(boundary, hardscapeInnerFactor);
  const drainageBoundaryBase = scalePolygon(boundary, drainageInnerFactor);

  const downslope = slopeDirectionVector(site.latitude, site.longitude);
  const shiftMagnitude = 0.00022 * slopeFactor;
  const drainageBoundary = translatePolygon(
    drainageBoundaryBase,
    downslope[0] * shiftMagnitude,
    downslope[1] * shiftMagnitude
  );

  return {
    zones: [
      { kind: "vegetation", polygon: boundary, color: "#4f9f6e" },
      { kind: "hardscape", polygon: hardscapeBoundary, color: "#8f8a77" },
      { kind: "drainage", polygon: drainageBoundary, color: "#4e7da8" }
    ],
    flowLines: createFlowLinesForBoundary(boundary, drainageBoundary, downslope, slopeFactor),
    drainageNote: `Drainage core shifted downslope (vector ${downslope[0].toFixed(2)}, ${downslope[1].toFixed(2)}).`
  };
}

function buildPlantSuggestions(site, env, zones) {
  const palette = [
    { species: "Live Oak", type: "canopy", waterNeed: "moderate" },
    { species: "Mexican Feather Grass", type: "ornamental grass", waterNeed: "low" },
    { species: "Switchgrass", type: "bioswale", waterNeed: "moderate" },
    { species: "Red Yucca", type: "accent", waterNeed: "low" },
    { species: "Serviceberry", type: "understory", waterNeed: "moderate" },
    { species: "Inkberry", type: "evergreen shrub", waterNeed: "high" }
  ];

  const vegZone = zones.find((z) => z.kind === "vegetation");
  const points = [];

  if (vegZone?.polygon && vegZone.polygon.length > 8) {
    const step = Math.max(1, Math.floor(vegZone.polygon.length / 18));
    for (let i = 0; i < vegZone.polygon.length; i += step) {
      const [lat, lng] = vegZone.polygon[i];
      points.push([lat + (i % 3) * 0.00001, lng - (i % 2) * 0.00001]);
      if (points.length >= 18) {
        break;
      }
    }
  }

  if (!points.length) {
    points.push([site.latitude + 0.0001, site.longitude - 0.0001]);
  }

  return points.map((point, index) => {
    const base = palette[index % palette.length];
    const drainageBias = env.soil.drainageClass.includes("slow") || env.rainfall.stormIntensity === "high";
    const suited = drainageBias ? base.waterNeed !== "low" : true;
    return { name: base.species, type: base.type, waterNeed: base.waterNeed, suited, coords: point };
  });
}

export function generateLayout(site, env) {
  const rainfallFactor = env.rainfall.stormIntensity === "high" ? 1.25 : env.rainfall.stormIntensity === "moderate" ? 1 : 0.75;
  const vegetatedPct = Math.min(0.65, Math.max(0.35, 0.45 + (rainfallFactor - 1) * 0.12));
  const hardscapePct = Math.max(0.2, 0.42 - (vegetatedPct - 0.45));
  const drainagePct = Number((1 - vegetatedPct - hardscapePct).toFixed(2));

  const userBoundary = Array.isArray(site.boundary) && site.boundary.length >= 3 ? site.boundary : null;
  const siteBoundary = userBoundary || createDefaultBoundary(site);

  const boundaryModel = createBoundaryZones(siteBoundary, site, vegetatedPct, hardscapePct);
  const plantSuggestions = buildPlantSuggestions(site, env, boundaryModel.zones);

  return {
    generatedAt: new Date().toISOString(),
    siteBoundary,
    metrics: {
      vegetatedAreaM2: Math.round(site.siteAreaM2 * vegetatedPct),
      hardscapeAreaM2: Math.round(site.siteAreaM2 * hardscapePct),
      drainageAreaM2: Math.round(site.siteAreaM2 * drainagePct)
    },
    recommendations: [
      `${env.hardinessZone} planting palette tuned for ${env.sun.exposureBand} sun exposure`,
      `${env.soil.type} soil suggests ${env.soil.drainageClass} substrate strategy`,
      `${env.rainfall.annualMM}mm annual rainfall supports stormwater retention + overflow plan`,
      userBoundary ? `Parcel subdivision mode active. ${boundaryModel.drainageNote}` : `Auto parcel boundary generated from site area. ${boundaryModel.drainageNote}`
    ],
    zones: boundaryModel.zones,
    flowLines: boundaryModel.flowLines,
    plantSuggestions
  };
}
