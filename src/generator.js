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

  const zones = hasBoundary
    ? [
        {
          kind: "vegetation",
          polygon: scalePolygon(site.boundary, 0.95),
          color: "#4f9f6e"
        },
        {
          kind: "hardscape",
          polygon: scalePolygon(site.boundary, 0.68),
          color: "#8f8a77"
        },
        {
          kind: "drainage",
          polygon: scalePolygon(site.boundary, 0.42 + (slopeFactor - 1) * 0.1),
          color: "#4e7da8"
        }
      ]
    : [
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
      hasBoundary ? "Boundary-aware zoning generated from supplied site polygon." : "No boundary provided; zoning generated from radial site model."
    ],
    zones
  };
}
