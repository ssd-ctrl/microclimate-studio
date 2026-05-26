function bounds(points) {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  points.forEach(([lat, lng]) => {
    minLat = Math.min(minLat, lat);
    minLng = Math.min(minLng, lng);
    maxLat = Math.max(maxLat, lat);
    maxLng = Math.max(maxLng, lng);
  });
  return { minLat, minLng, maxLat, maxLng };
}

function toSvgPoints(points, b, width, height, pad) {
  const latSpan = Math.max(0.000001, b.maxLat - b.minLat);
  const lngSpan = Math.max(0.000001, b.maxLng - b.minLng);
  return points
    .map(([lat, lng]) => {
      const x = pad + ((lng - b.minLng) / lngSpan) * (width - pad * 2);
      const y = height - pad - ((lat - b.minLat) / latSpan) * (height - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function canopySymbols(layout, b, width, height, pad) {
  return (layout.plantSuggestions || [])
    .slice(0, 30)
    .map((p, i) => {
      const [lat, lng] = p.coords;
      const x = pad + ((lng - b.minLng) / Math.max(0.000001, b.maxLng - b.minLng)) * (width - pad * 2);
      const y = height - pad - ((lat - b.minLat) / Math.max(0.000001, b.maxLat - b.minLat)) * (height - pad * 2);
      const r = 9 + (i % 4);
      const tone = p.suited ? "#7ea84f" : "#b5a25d";
      return `<g><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${tone}" fill-opacity="0.65" stroke="#3f5c2f" stroke-width="0.8"/><circle cx="${(x - r * 0.25).toFixed(1)}" cy="${(y - r * 0.22).toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="#d4e688" fill-opacity="0.55"/></g>`;
    })
    .join("");
}

export function renderIllustrativePlan(run) {
  const { site, layout } = run;
  const boundary = site.boundary || layout.siteBoundary || [];
  if (!boundary.length) {
    return "<p>No boundary available for illustrative plan.</p>";
  }

  const w = 760;
  const h = 500;
  const pad = 38;
  const b = bounds(boundary);

  const zonePolys = layout.zones
    .map((z) => {
      if (!z.polygon) {
        return "";
      }
      const fill = z.kind === "vegetation" ? "#dceca9" : z.kind === "hardscape" ? "#dfcfb7" : "#b9d9df";
      const stroke = z.kind === "vegetation" ? "#7f9e43" : z.kind === "hardscape" ? "#9e8a6b" : "#4f89a1";
      return `<polygon points="${toSvgPoints(z.polygon, b, w, h, pad)}" fill="${fill}" fill-opacity="0.78" stroke="${stroke}" stroke-width="1.5"/>`;
    })
    .join("");

  const flows = (layout.flowLines || [])
    .map((f) => `<polyline points="${toSvgPoints(f.path, b, w, h, pad)}" fill="none" stroke="#5d8aa5" stroke-width="1.1" stroke-dasharray="5 4"/>`)
    .join("");

  const plantDots = canopySymbols(layout, b, w, h, pad);

  return `
    <div class="illustrative-sheet">
      <div class="sheet-head">Microclimate Studio Illustrative Plan</div>
      <svg viewBox="0 0 ${w} ${h}" class="illustrative-svg" role="img" aria-label="Illustrative landscape plan">
        <defs>
          <filter id="paperNoise">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/>
            <feColorMatrix type="saturate" values="0"/>
            <feComponentTransfer><feFuncA type="table" tableValues="0 0.07"/></feComponentTransfer>
          </filter>
        </defs>
        <rect x="0" y="0" width="${w}" height="${h}" fill="#f8f5ea"/>
        <rect x="0" y="0" width="${w}" height="${h}" filter="url(#paperNoise)"/>
        ${zonePolys}
        ${flows}
        ${plantDots}
        <text x="${pad}" y="${h - 10}" font-size="12" fill="#4a4a4a">Site: ${site.siteName || "Untitled"}</text>
        <text x="${w - 175}" y="${h - 10}" font-size="12" fill="#4a4a4a">Scale: Conceptual</text>
      </svg>
      <div class="sheet-notes">Hand-rendered style concept output generated from environmental + zoning model.</div>
    </div>
  `;
}
