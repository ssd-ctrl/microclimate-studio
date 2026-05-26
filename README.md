# Microclimate Studio

Browser-based generative design studio for architects that analyzes site microclimate and environmental data (sun, soil, rainfall, hardiness) to produce optimized vegetation, hardscape, and drainage layout concepts.

## Features

- Address/place search to locate a site quickly
- Latitude/longitude manual input fallback
- Environmental profile synthesis from open data sources
- Concept generation for:
  - Vegetation zones
  - Hardscape zones
  - Drainage zones
- Optional parcel boundary capture (map clicks) or GeoJSON input
- Export concept package as JSON
- Export concept report as text
- PWA scaffold (manifest + service worker)

## Tech Stack

- HTML/CSS/JavaScript (no framework)
- Leaflet map rendering
- OpenStreetMap tiles
- Nominatim geocoding
- Open-Meteo + SoilGrids integration (with fallbacks)

## Local Run

### Easiest

- Double-click `START_APP.cmd`
- Open `http://localhost:4173`
- Double-click `STOP_APP.cmd` to stop

### Manual

```powershell
cd "C:\Users\SydneyDeVille\Documents\Codex\2026-05-26\we"
node local-server.js
```

## Verification

Automated headless smoke test:

```powershell
node scripts/verify.mjs
```

or

```powershell
npm run verify
```

## Deploy (GitHub Pages)

This repo includes a GitHub Actions workflow at `.github/workflows/pages.yml`.

1. Push to `main`
2. In GitHub repo settings: `Settings -> Pages -> Source: GitHub Actions`
3. Your site will publish to:
   - `https://<username>.github.io/<repo>/`

## Project Structure

- `index.html` - App shell and controls
- `styles.css` - UI styling and responsive layout
- `src/main.js` - App controller and map interactions
- `src/environment.js` - Environmental data pipeline
- `src/generator.js` - Layout generation logic
- `manifest.webmanifest` - PWA manifest
- `sw.js` - Service worker scaffold
- `scripts/verify.mjs` - Automated verification runner

## Roadmap

- True parcel-constrained geometry operations
- Saved projects and session persistence
- Mobile-first field workflow and sync
- Expanded environmental datasets and model calibration

## License

MIT (recommended)
