function estimateSunPath(latitude) {
  const absLat = Math.abs(latitude);
  const exposureBand = absLat < 23.5 ? "high" : absLat < 45 ? "moderate" : "low";
  const summerSolarGain = Math.max(4, 10 - absLat / 12).toFixed(1);

  return {
    exposureBand,
    summerSolarGainHours: Number(summerSolarGain),
    designHint:
      exposureBand === "high"
        ? "Prioritize shade canopy and evapotranspirative cooling."
        : exposureBand === "moderate"
          ? "Balance shade and winter solar access."
          : "Maximize southern solar penetration and wind shelter."
  };
}

function estimateSoilType(latitude, longitude) {
  const signature = Math.abs(Math.round((latitude * 100 + longitude * 75) % 5));
  const catalog = [
    { type: "Sandy loam", drainageClass: "well-drained" },
    { type: "Clay loam", drainageClass: "slow-draining" },
    { type: "Silty clay", drainageClass: "poorly-drained" },
    { type: "Loam", drainageClass: "balanced" },
    { type: "Gravelly loam", drainageClass: "rapid-draining" }
  ];
  return catalog[signature];
}

function estimateRainfall(latitude, longitude) {
  const base = 450;
  const climateWave = Math.abs(Math.sin(latitude / 9) + Math.cos(longitude / 8));
  const annualMM = Math.round(base + climateWave * 700);
  const stormIntensity = annualMM > 1000 ? "high" : annualMM > 700 ? "moderate" : "low";
  return { annualMM, stormIntensity };
}

function estimateHardinessZone(latitude) {
  const zone = Math.max(3, Math.min(11, Math.round(12 - Math.abs(latitude) / 8)));
  return `USDA ${zone}`;
}

function hardinessZoneFromMinTempC(minTempC) {
  const minTempF = minTempC * (9 / 5) + 32;
  const zone = Math.max(1, Math.min(13, Math.floor((minTempF + 60) / 10) + 1));
  return `USDA ${zone}`;
}

async function fetchOpenMeteoClimate(latitude, longitude) {
  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  const now = new Date();
  const endYear = now.getUTCFullYear() - 1;
  const startYear = endYear - 4;
  url.searchParams.set("latitude", latitude);
  url.searchParams.set("longitude", longitude);
  url.searchParams.set("start_date", `${startYear}-01-01`);
  url.searchParams.set("end_date", `${endYear}-12-31`);
  url.searchParams.set(
    "daily",
    "sunshine_duration,precipitation_sum,temperature_2m_min,temperature_2m_max"
  );
  url.searchParams.set("timezone", "UTC");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed (${response.status})`);
  }

  const json = await response.json();
  const daily = json.daily;
  if (!daily || !daily.sunshine_duration || !daily.precipitation_sum) {
    throw new Error("Open-Meteo daily climate fields missing");
  }

  const days = daily.sunshine_duration.length || 1;
  const totalSunSeconds = daily.sunshine_duration.reduce((sum, value) => sum + (value || 0), 0);
  const avgSunHours = totalSunSeconds / days / 3600;
  const totalRainMM = daily.precipitation_sum.reduce((sum, value) => sum + (value || 0), 0);
  const annualRainMM = totalRainMM / 5;
  const minTempSeries = daily.temperature_2m_min.filter((value) => Number.isFinite(value));
  const annualExtremeMinC = minTempSeries.length > 0 ? Math.min(...minTempSeries) : -12;

  return {
    avgSunHours,
    annualRainMM,
    annualExtremeMinC
  };
}

async function fetchSoilGrids(latitude, longitude) {
  const url = new URL("https://rest.isric.org/soilgrids/v2.0/properties/query");
  url.searchParams.set("lat", latitude);
  url.searchParams.set("lon", longitude);
  url.searchParams.append("property", "clay");
  url.searchParams.append("property", "sand");
  url.searchParams.set("depth", "0-5cm");
  url.searchParams.set("value", "mean");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`SoilGrids request failed (${response.status})`);
  }

  const json = await response.json();
  const layers = json.properties?.layers || [];

  const findMean = (name) => {
    const layer = layers.find((item) => item.name === name);
    return layer?.depths?.[0]?.values?.mean;
  };

  const clay = findMean("clay");
  const sand = findMean("sand");
  if (!Number.isFinite(clay) || !Number.isFinite(sand)) {
    throw new Error("SoilGrids values missing");
  }

  if (clay >= 40) {
    return { type: "Clay loam", drainageClass: "slow-draining" };
  }
  if (sand >= 55) {
    return { type: "Sandy loam", drainageClass: "well-drained" };
  }
  if (clay >= 30 && sand < 45) {
    return { type: "Silty clay", drainageClass: "poorly-drained" };
  }
  if (sand >= 35 && clay <= 30) {
    return { type: "Gravelly loam", drainageClass: "rapid-draining" };
  }
  return { type: "Loam", drainageClass: "balanced" };
}

export async function getEnvironmentalProfile({ latitude, longitude }) {
  const fallback = {
    sun: estimateSunPath(latitude),
    soil: estimateSoilType(latitude, longitude),
    rainfall: estimateRainfall(latitude, longitude),
    hardinessZone: estimateHardinessZone(latitude),
    sources: ["fallback-estimators"]
  };

  try {
    const climate = await fetchOpenMeteoClimate(latitude, longitude);
    const rainfall = {
      annualMM: Math.round(climate.annualRainMM),
      stormIntensity:
        climate.annualRainMM > 1000 ? "high" : climate.annualRainMM > 700 ? "moderate" : "low"
    };
    const sun = {
      ...estimateSunPath(latitude),
      summerSolarGainHours: Number(climate.avgSunHours.toFixed(1))
    };
    const hardinessZone = hardinessZoneFromMinTempC(climate.annualExtremeMinC);

    let soil = fallback.soil;
    const sources = ["open-meteo"];

    try {
      soil = await fetchSoilGrids(latitude, longitude);
      sources.push("soilgrids");
    } catch (_error) {
      sources.push("soil-fallback");
    }

    return {
      sun,
      soil,
      rainfall,
      hardinessZone,
      sources
    };
  } catch (_error) {
    return fallback;
  }
}
