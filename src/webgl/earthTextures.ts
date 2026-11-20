import * as THREE from 'three';
import { getGeoCountries } from '../data/geoIndex';
import { CONTINENTS } from '../data/paymentsDataset';

export interface EarthTextureBundle {
  biomeDataTexture: THREE.CanvasTexture;
  nightLightsTexture: THREE.CanvasTexture;
  roughnessTexture: THREE.CanvasTexture;
  normalTexture: THREE.CanvasTexture;
  dispose: () => void;
}

interface GeographicFeatureMask {
  lat: number;
  lon: number;
  rx: number; // radius in deg lon
  ry: number; // radius in deg lat
  strength: number;
  rotDeg?: number;
}

// Real-world arid desert belts (Sahara, Arabia, Gobi, Outback, Atacama, US SW, Namib)
const DESERT_ZONES: GeographicFeatureMask[] = [
  { lat: 23, lon: 12, rx: 28, ry: 11, strength: 1.0 }, // Sahara
  { lat: 23, lon: 46, rx: 14, ry: 10, strength: 0.95 }, // Arabian Peninsula
  { lat: 31, lon: 55, rx: 12, ry: 8, strength: 0.78 }, // Iranian Plateau
  { lat: 41, lon: 63, rx: 14, ry: 8, strength: 0.82 }, // Kyzylkum / Karakum
  { lat: 41, lon: 98, rx: 18, ry: 7, strength: 0.88 }, // Gobi / Taklamakan
  { lat: 27, lon: 71, rx: 6, ry: 5, strength: 0.72 }, // Thar
  { lat: -24, lon: 133, rx: 16, ry: 9, strength: 0.92 }, // Australian Outback
  { lat: 33, lon: -112, rx: 10, ry: 7, strength: 0.8 }, // Sonoran / Mojave
  { lat: -23, lon: -69, rx: 3.5, ry: 9, strength: 0.88 }, // Atacama
  { lat: -24, lon: 17, rx: 5, ry: 8, strength: 0.85 }, // Namib / Kalahari
  { lat: 8, lon: 47, rx: 6, ry: 6, strength: 0.72 }, // Horn of Africa
];

// Real-world major mountain belts for elevation & normal relief
const MOUNTAIN_BELTS: GeographicFeatureMask[] = [
  { lat: 32, lon: 86, rx: 18, ry: 7, strength: 1.0, rotDeg: -10 }, // Himalayas & Tibet
  { lat: 37, lon: 72, rx: 9, ry: 5, strength: 0.9 }, // Pamir / Hindu Kush
  { lat: -16, lon: -69, rx: 4, ry: 22, strength: 0.95, rotDeg: 8 }, // Central/Northern Andes
  { lat: -38, lon: -71, rx: 3, ry: 14, strength: 0.85, rotDeg: 5 }, // Southern Andes
  { lat: 44, lon: -112, rx: 8, ry: 17, strength: 0.82, rotDeg: -18 }, // Rockies
  { lat: 62, lon: -148, rx: 10, ry: 5, strength: 0.85 }, // Alaska Range
  { lat: 46, lon: 10, rx: 8, ry: 3.5, strength: 0.78 }, // Alps
  { lat: 42, lon: 44, rx: 6, ry: 3, strength: 0.8 }, // Caucasus
  { lat: 9, lon: 39, rx: 6, ry: 7, strength: 0.72 }, // Ethiopian Highlands
  { lat: 63, lon: 14, rx: 4, ry: 9, strength: 0.65, rotDeg: 18 }, // Scandinavian Mountains
  { lat: -43, lon: 171, rx: 2.5, ry: 5, strength: 0.75, rotDeg: 25 }, // Southern Alps NZ
];

// Real-world dense night-light corridors
const URBAN_CORRIDORS: Array<[number, number, number, number]> = [
  // [lat, lon, spreadDeg, intensity]
  [40.7, -74.0, 2.2, 1.0], // NY - Boston - DC corridor
  [39.9, -75.2, 2.0, 0.85],
  [41.9, -87.6, 2.4, 0.9], // Chicago / Great Lakes
  [34.0, -118.2, 2.2, 0.95], // SoCal
  [37.7, -122.2, 1.8, 0.85], // Bay Area
  [29.7, -95.4, 2.0, 0.85], // Texas Triangle
  [32.8, -96.8, 1.8, 0.8],
  [25.8, -80.2, 1.4, 0.75], // South Florida
  [51.5, -0.1, 2.2, 1.0], // London / UK Midlands
  [53.4, -2.2, 1.8, 0.85],
  [48.8, 2.3, 2.0, 0.95], // Paris
  [50.9, 5.5, 2.6, 0.95], // Benelux / Ruhr Blue Banana
  [45.5, 9.2, 2.2, 0.9], // Milan / Po Valley
  [40.4, -3.7, 1.5, 0.78], // Madrid
  [52.5, 13.4, 1.6, 0.82], // Berlin
  [55.7, 37.6, 2.3, 0.92], // Moscow
  [41.0, 29.0, 1.6, 0.88], // Istanbul
  [30.0, 31.2, 1.8, 0.95], // Nile Delta
  [26.5, 31.8, 0.9, 0.65], // Nile Valley
  [25.2, 55.3, 1.6, 0.95], // Dubai / Persian Gulf
  [24.7, 46.7, 1.5, 0.82], // Riyadh
  [19.1, 72.9, 2.0, 0.95], // Mumbai-Pune
  [28.6, 77.2, 2.6, 0.98], // Delhi-NCR / Gangetic
  [25.5, 85.1, 3.2, 0.75], // Gangetic Plain
  [23.8, 90.4, 2.0, 0.92], // Dhaka / Bengal
  [13.0, 77.6, 1.8, 0.85], // Bengaluru-Chennai
  [31.2, 121.5, 2.8, 1.0], // Yangtze Delta
  [39.9, 116.4, 2.8, 0.98], // Beijing-Tianjin
  [22.5, 114.1, 2.3, 1.0], // Pearl River Delta / HK
  [30.6, 104.1, 2.2, 0.82], // Chengdu
  [37.5, 127.0, 1.6, 0.98], // Seoul
  [35.7, 139.7, 2.2, 1.0], // Tokyo
  [34.7, 135.5, 1.8, 0.95], // Osaka-Kyoto
  [25.0, 121.5, 1.1, 0.88], // Taipei
  [13.7, 100.5, 1.7, 0.88], // Bangkok
  [1.35, 103.8, 1.2, 0.95], // Singapore
  [-6.2, 106.8, 2.2, 0.92], // Jakarta / Java
  [14.6, 121.0, 1.5, 0.85], // Manila
  [-23.5, -46.6, 2.2, 0.95], // Sao Paulo
  [-22.9, -43.2, 1.5, 0.85], // Rio
  [-34.6, -58.4, 1.8, 0.88], // Buenos Aires
  [19.4, -99.1, 1.8, 0.9], // Mexico City
  [-26.2, 28.0, 1.7, 0.85], // Johannesburg
  [6.5, 3.4, 1.5, 0.82], // Lagos
  [-1.3, 36.8, 1.3, 0.72], // Nairobi
  [-33.8, 151.2, 1.4, 0.88], // Sydney
  [-37.8, 145.0, 1.3, 0.82], // Melbourne
];

function drawEllipticalField(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  list: GeographicFeatureMask[],
  rgbPrefix: string
) {
  for (const item of list) {
    const cx = ((item.lon + 180) / 360) * w;
    const cy = ((90 - item.lat) / 180) * h;
    const rx = (item.rx / 360) * w;
    const ry = (item.ry / 180) * h;

    ctx.save();
    ctx.translate(cx, cy);
    if (item.rotDeg) ctx.rotate((item.rotDeg * Math.PI) / 180);
    ctx.scale(1, ry / Math.max(rx, 1));
    const grad = ctx.createRadialGradient(0, 0, rx * 0.12, 0, 0, rx);
    grad.addColorStop(0, `rgba(${rgbPrefix}, ${item.strength})`);
    grad.addColorStop(0.55, `rgba(${rgbPrefix}, ${item.strength * 0.55})`);
    grad.addColorStop(1, `rgba(${rgbPrefix}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function createProceduralEarthTextures(maxAnisotropy: number): EarthTextureBundle {
  const width = 2048;
  const height = 1024;
  const countries = getGeoCountries();

  const lonToX = (lon: number) => ((lon + 180) / 360) * width;
  const latToY = (lat: number) => ((90 - lat) / 180) * height;

  const traceAllCountries = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const lx = (lon: number) => ((lon + 180) / 360) * w;
    const ly = (lat: number) => ((90 - lat) / 180) * h;
    for (const country of countries) {
      for (const poly of country.polygons) {
        if (poly.rings.length === 0) continue;
        ctx.beginPath();
        for (const ring of poly.rings) {
          for (let i = 0; i < ring.coords.length; i++) {
            const [lon, lat] = ring.coords[i];
            const x = lx(lon);
            const y = ly(lat);
            if (i === 0) ctx.moveTo(x, y);
            else if (Math.abs(lon - ring.coords[i - 1][0]) > 180) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
        }
        ctx.fill('evenodd');
      }
    }
  };

  // --------------------------------------------------------------------------
  // 1. Land Mask & Bathymetry / Elevation / Aridity Packed Data Canvas
  //    R = Land mask (255 land, 0 ocean)
  //    G = Elevation (on land) / Shallow Bathymetry (on ocean)
  //    B = Aridity / Desert weight (0 lush -> 255 desert)
  // --------------------------------------------------------------------------
  const landCanvas = document.createElement('canvas');
  landCanvas.width = width;
  landCanvas.height = height;
  const landCtx = landCanvas.getContext('2d')!;
  landCtx.fillStyle = '#000000';
  landCtx.fillRect(0, 0, width, height);
  landCtx.fillStyle = '#ffffff';
  traceAllCountries(landCtx, width, height);

  // Bathymetry + Mountain Elevation Canvas
  const elevCanvas = document.createElement('canvas');
  elevCanvas.width = width;
  elevCanvas.height = height;
  const elevCtx = elevCanvas.getContext('2d')!;
  elevCtx.fillStyle = '#000000';
  elevCtx.fillRect(0, 0, width, height);

  // Coastal shelf glow (wide blur around land silhouettes -> shallow ocean turquoise)
  elevCtx.save();
  elevCtx.filter = 'blur(18px)';
  elevCtx.drawImage(landCanvas, 0, 0);
  elevCtx.filter = 'blur(5px)';
  elevCtx.globalAlpha = 0.7;
  elevCtx.drawImage(landCanvas, 0, 0);
  elevCtx.restore();

  // Mountain elevation belts
  const mtnCanvas = document.createElement('canvas');
  mtnCanvas.width = width;
  mtnCanvas.height = height;
  const mtnCtx = mtnCanvas.getContext('2d')!;
  mtnCtx.fillStyle = '#000000';
  mtnCtx.fillRect(0, 0, width, height);
  mtnCtx.globalCompositeOperation = 'lighter';
  drawEllipticalField(mtnCtx, width, height, MOUNTAIN_BELTS, '255, 255, 255');

  // Aridity / Desert canvas
  const aridCanvas = document.createElement('canvas');
  aridCanvas.width = width;
  aridCanvas.height = height;
  const aridCtx = aridCanvas.getContext('2d')!;
  aridCtx.fillStyle = '#000000';
  aridCtx.fillRect(0, 0, width, height);
  aridCtx.globalCompositeOperation = 'lighter';
  drawEllipticalField(aridCtx, width, height, DESERT_ZONES, '255, 255, 255');

  // Pack cleanly into final biomeDataCanvas via pixel buffer (zero alpha artifacts)
  const biomeCanvas = document.createElement('canvas');
  biomeCanvas.width = width;
  biomeCanvas.height = height;
  const biomeCtx = biomeCanvas.getContext('2d')!;

  const landData = landCtx.getImageData(0, 0, width, height).data;
  const elevData = elevCtx.getImageData(0, 0, width, height).data;
  const mtnData = mtnCtx.getImageData(0, 0, width, height).data;
  const aridData = aridCtx.getImageData(0, 0, width, height).data;
  const outImg = biomeCtx.createImageData(width, height);
  const out = outImg.data;

  // Height scalar buffer for Sobel normal map generation
  const heightField = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const isLand = landData[idx]; // 0..255
    const shelf = elevData[idx]; // 0..255
    const mtn = mtnData[idx]; // 0..255
    const arid = aridData[idx]; // 0..255

    const landF = isLand / 255;
    const combinedElev =
      landF > 0.5
        ? Math.min(255, Math.round(55 + mtn * 0.78))
        : Math.min(255, shelf);

    out[idx] = isLand;
    out[idx + 1] = combinedElev;
    out[idx + 2] = arid;
    out[idx + 3] = 255;

    heightField[i] = landF * (0.28 + (mtn / 255) * 0.72);
  }
  biomeCtx.putImageData(outImg, 0, 0);

  // --------------------------------------------------------------------------
  // 2. Tangent-Space Normal Map from Elevation & Coastline Relief
  // --------------------------------------------------------------------------
  const normalCanvas = document.createElement('canvas');
  normalCanvas.width = width;
  normalCanvas.height = height;
  const normalCtx = normalCanvas.getContext('2d')!;
  const normImg = normalCtx.createImageData(width, height);
  const normOut = normImg.data;
  const strength = 3.2;

  for (let y = 0; y < height; y++) {
    const ym1 = Math.max(0, y - 1);
    const yp1 = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm1 = (x - 1 + width) % width;
      const xp1 = (x + 1) % width;

      const tl = heightField[ym1 * width + xm1];
      const t = heightField[ym1 * width + x];
      const tr = heightField[ym1 * width + xp1];
      const l = heightField[y * width + xm1];
      const r = heightField[y * width + xp1];
      const bl = heightField[yp1 * width + xm1];
      const b = heightField[yp1 * width + x];
      const br = heightField[yp1 * width + xp1];

      const dX = tr + 2 * r + br - (tl + 2 * l + bl);
      const dY = bl + 2 * b + br - (tl + 2 * t + tr);

      let nx = -dX * strength;
      let ny = -dY * strength;
      let nz = 1.0;
      const invLen = 1 / Math.hypot(nx, ny, nz);
      nx *= invLen;
      ny *= invLen;
      nz *= invLen;

      const idx = (y * width + x) * 4;
      normOut[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      normOut[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normOut[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      normOut[idx + 3] = 255;
    }
  }
  normalCtx.putImageData(normImg, 0, 0);

  // --------------------------------------------------------------------------
  // 3. NASA Black Marble Style Night City Lights Network
  // --------------------------------------------------------------------------
  const nightCanvas = document.createElement('canvas');
  nightCanvas.width = width;
  nightCanvas.height = height;
  const nightCtx = nightCanvas.getContext('2d')!;
  nightCtx.fillStyle = '#000000';
  nightCtx.fillRect(0, 0, width, height);

  // Deterministic pseudo-random for crisp urban filaments
  let rng = 133742;
  const rand = () => {
    rng = (rng * 1664525 + 1013904223) >>> 0;
    return rng / 4294967296;
  };

  nightCtx.save();
  nightCtx.globalCompositeOperation = 'lighter';

  const stampCityNetwork = (lat: number, lon: number, spreadDeg: number, intensity: number) => {
    const cx = lonToX(lon);
    const cy = latToY(lat);
    const radiusPx = (spreadDeg / 360) * width;

    // Warm golden ambient metropolitan bloom
    const grad = nightCtx.createRadialGradient(cx, cy, 0, cx, cy, radiusPx * 1.4);
    grad.addColorStop(0, `rgba(255, 200, 110, ${0.42 * intensity})`);
    grad.addColorStop(0.4, `rgba(234, 130, 40, ${0.18 * intensity})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    nightCtx.fillStyle = grad;
    nightCtx.beginPath();
    nightCtx.arc(cx, cy, radiusPx * 1.4, 0, Math.PI * 2);
    nightCtx.fill();

    // Crisp pinpoint satellite street-light speckles
    const speckleCount = Math.round(28 * intensity + spreadDeg * 14);
    for (let s = 0; s < speckleCount; s++) {
      const ang = rand() * Math.PI * 2;
      const r = Math.pow(rand(), 1.65) * radiusPx * 1.25;
      const sx = cx + Math.cos(ang) * r;
      const sy = cy + Math.sin(ang) * r * 0.85;
      const px = Math.min(width - 1, Math.max(0, Math.round(sx)));
      const py = Math.min(height - 1, Math.max(0, Math.round(sy)));
      // Keep lights strictly on land
      if (landData[(py * width + px) * 4] < 128) continue;

      const size = 0.7 + rand() * 1.5;
      const alpha = (0.35 + rand() * 0.65) * intensity;
      nightCtx.fillStyle = rand() > 0.35 ? `rgba(255, 224, 150, ${alpha})` : `rgba(251, 169, 75, ${alpha})`;
      nightCtx.fillRect(sx, sy, size, size);
    }
  };

  for (const [lat, lon, spread, intensity] of URBAN_CORRIDORS) {
    stampCityNetwork(lat, lon, spread, intensity);
  }
  for (const cont of CONTINENTS) {
    for (const country of cont.countries) {
      for (const city of country.cities) {
        stampCityNetwork(city.lat, city.lon, 1.15, 0.9);
      }
    }
  }
  for (const c of countries) {
    stampCityNetwork(c.centroid.lat, c.centroid.lon, 0.7, 0.38);
  }
  nightCtx.restore();

  // --------------------------------------------------------------------------
  // 4. Roughness Map (Oceans specular 0.20, Land matte 0.88)
  // --------------------------------------------------------------------------
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 1024;
  roughCanvas.height = 512;
  const roughCtx = roughCanvas.getContext('2d')!;
  roughCtx.fillStyle = 'rgb(52, 52, 52)';
  roughCtx.fillRect(0, 0, 1024, 512);
  roughCtx.fillStyle = 'rgb(224, 224, 224)';
  traceAllCountries(roughCtx, 1024, 512);

  // Build Three.js Textures
  const biomeDataTexture = new THREE.CanvasTexture(biomeCanvas);
  biomeDataTexture.colorSpace = THREE.NoColorSpace;
  biomeDataTexture.anisotropy = maxAnisotropy;
  biomeDataTexture.needsUpdate = true;

  const nightLightsTexture = new THREE.CanvasTexture(nightCanvas);
  nightLightsTexture.colorSpace = THREE.SRGBColorSpace;
  nightLightsTexture.anisotropy = maxAnisotropy;
  nightLightsTexture.needsUpdate = true;

  const roughnessTexture = new THREE.CanvasTexture(roughCanvas);
  roughnessTexture.colorSpace = THREE.NoColorSpace;
  roughnessTexture.anisotropy = maxAnisotropy;
  roughnessTexture.needsUpdate = true;

  const normalTexture = new THREE.CanvasTexture(normalCanvas);
  normalTexture.colorSpace = THREE.NoColorSpace;
  normalTexture.anisotropy = maxAnisotropy;
  normalTexture.needsUpdate = true;

  return {
    biomeDataTexture,
    nightLightsTexture,
    roughnessTexture,
    normalTexture,
    dispose: () => {
      biomeDataTexture.dispose();
      nightLightsTexture.dispose();
      roughnessTexture.dispose();
      normalTexture.dispose();
    },
  };
}
