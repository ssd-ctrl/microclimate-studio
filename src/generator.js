function areaRadiusMeters(siteAreaM2) {
  return Math.sqrt(siteAreaM2 / Math.PI);
}

function centroid(latlngs) {
  const totals = latlngs.reduce(
    (acc, [lat, lng]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }),
    { lat: 0, lng: 0 }
  );
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

function buildRingPolygon(outer, inner) {
  return [...outer, ...[...inner].reverse()];
}

function slopeDirectionVector(latitude, longitude) {
  const seedA = Math.sin(latitude * 8.3 + longitude * 5.1);
  const seedB = Math.cos(latitude * 4.4 - longitude * 6.2);
  return normalizeVector([seedA, seedB]);
}

function createFlowLinesForBoundary(boundary, drainageBoundary, downslope, slopeFactor) {
  const [dLat, dLng] = downslope;
  const length = 0.00045 * slopeFactor;
  return boundary.map(([lat, lng], index) => {
    const end =
      index < drainageBoundary.length ? drainageBoundary[index] : [lat + dLat * length, lng + dLng * length];
    return {
      path: [
        [lat, lng],
        end
      ],
      strength: slopeFactor
    };
  });
}

function createFlowLinesForRadial(site, slopeFactor) {
  const downslope = slopeDirectionVector(site.latitude, site.longitude);
  const [dLat, dLng] = downslope;
  const start = [site.latitude - dLat * 0.00035, site.longitude - dLng * 0.00035];
  const middle = [site.latitude, site.longitude];
  const end = [site.latitude + dLat * 0.00045 * slopeFactor, site.longitude + dLng * 0.00045 * slopeFactor];
  return [
    { path: [start, middle, end], strength: slopeFactor },
    {
      path: [
        [start[0] + 0.00018, start[1] - 0.00012],
        [middle[0] + 0.0001, middle[1] - 0.00008],
        [end[0] + 0.00008, end[1] - 0.00006]
      ],
      strength: slopeFactor
    }
  ];
}

function createBoundaryZones(site, vegetatedPct, hardscapePct, drainagePct) {
  const slopeFactor = site.slopePercent > 6 ? 1.25 : site.slopePercent > 2 ? 1 : 0.85;

  const outer = site.boundary;
  const hardscapeInnerFactor = Math.max(0.38, 1 - vegetatedPct * 0.95);
  const drainageInnerFactor = Math.max(0.18, hardscapeInnerFactor - hardscapePct * 0.75);

  const hardscapeBoundary = scalePolygon(outer, hardscapeInnerFactor);
  const drainageBoundaryBase = scalePolygon(outer, drainageInnerFactor);

  const downslope = slopeDirectionVector(site.latitude, site.longitude);
  const shiftMagnitude = 0.00022 * slopeFactor;
  const drainageBoundary = translatePolygon(
    drainageBoundaryBase,
    downslope[0] * shiftMagnitude,
    downslope[1] * shiftMagnitude
  );

  return {
    zones: [
      {
        kind: "vegetation",
        polygon: buildRingPolygon(outer, hardscapeBoundary),
        color: "#4f9f6e"
      },
      {
        kind: "hardscape",
        polygon: buildRingPolygon(hardscapeBoundary, drainageBoundary),
        color: "#8f8a77"
      },
      {
        kind: "drainage",
        polygon: drainageBoundary,
        color: "#4e7da8"
      }
    ],
    flowLines: createFlowLinesForBoundary(outer, drainageBoundary, downslope, slopeFactor),
    drainageNote: `Drainage core shifted downslope (vector ${downslope[0].toFixed(2)}, ${downslope[1].toFixed(2)}).`
  };
}

export function generateLayout(site, env) {
  const radius = areaRadiusMeters(site.siteAreaM2);
  const rainfallFactor =
    env.rainfall.stormIntensity === "high" ? 1.25 : env.rainfall.stormIntensity === "moderate" ? 1 : 0.75;
  const slopeFactor = site.slopePercent > 6 ? 1.25 : site.slopePercent > 2 ? 1 : 0.85;

  const vegetatedPct = Math.min(0.65, Math.max(0.35, 0.45 + (rainfallFactor - 1) * 0.12));
  const hardscapePct = Math.max(0.2, 0.42 - (vegetatedPct - 0.45));
  const drainagePct = Number((1 - vegetatedPct - hardscapePct).toFixed(2));

  const offset = radius * 0.45;
  const hasBoundary = Array.isArray(site.boundary) && site.boundary.length >= 3;

  let zones;
  let flowLines;
  let boundaryRecommendation;

  if (hasBoundary) {
    const boundaryModel = createBoundaryZones(site, vegetatedPct, hardscapePct, drainagePct);
    zones = boundaryModel.zones;
    flowLines = boundaryModel.flowLines;
    boundaryRecommendation = `Parcel subdivision mode active. ${boundaryModel.drainageNote}`;
  } else {
    zones = [
      {
        kind: "vegetation",
        center: [site.latitude + 0.0007, site.longitude - 0.0007],
        radius: offset,
        color: "#4f9f6e"
      },
      {
        kind: "hardscape",
        center: [site.latitude - 0.0006, site.longitude + 0.0003],
        radius: offset * 0.8,
        color: "#8f8a77"
      },
      {
        kind: "drainage",
        center: [site.latitude + 0.0003, site.longitude + 0.0007],
        radius: offset * 0.55 * slopeFactor,
        color: "#4e7da8"
      }
    ];
    flowLines = createFlowLinesForRadial(site, slopeFactor);
    boundaryRecommendation = "No boundary provided; zoning generated from radial site model.";
  }

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      vegetatedAreaM2: Math.round(site.siteAreaM2 * vegetatedPct),
      hardscapeAreaM2: Math.round(site.siteAreaM2 * hardscapePct),
      drainageAreaM2: Math.round(site.siteAreaM2 * drainagePct)
    },
    recommendations: [
      `${env.hardinessZone} planting palette tuned for ${env.sun.exposureBand} sun exposure`,
      `${env.soil.type} soil suggests ${env.soil.drainageClass} substrate strategy`,
      `${env.rainfall.annualMM}mm annual rainfall supports stormwater retention + overflow plan`,
      boundaryRecommendation
    ],
    zones,
    flowLines
  };
}
