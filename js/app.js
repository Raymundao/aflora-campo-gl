// Aflora Campo GL — protótipo do mapa do censo com motor GPU (MapLibre).
// Objetivo: comparar fluidez com o app atual (Leaflet). Mesma satélite, pontos,
// rotação por 2 dedos, placas, GPS e import de KML/KMZ.

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const GOOGLE = "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}";
const CAMADAS = [{ nome: "Esri", url: ESRI }, { nome: "Google", url: GOOGLE }];
let camadaIdx = 0;

const CENTRO_PADRAO = [-43.9008, -19.6512]; // [lng, lat] — Lagoa Santa/MG aprox.

const map = new maplibregl.Map({
  container: "mapa",
  attributionControl: false,
  maxZoom: 22,
  center: CENTRO_PADRAO,
  zoom: 16,
  pitchWithRotate: false, // só rotação no plano (não inclina), igual ao uso de campo
  style: {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: { sat: { type: "raster", tiles: [ESRI], tileSize: 256, maxzoom: 19 } },
    layers: [{ id: "sat", type: "raster", source: "sat" }],
  },
});

// controles nativos: zoom + bússola (gira o mapa) e GPS (segue + aponta a direção)
map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: false }), "bottom-right");
const geo = new maplibregl.GeolocateControl({
  positionOptions: { enableHighAccuracy: true },
  trackUserLocation: true,
  showUserHeading: true,
  showAccuracyCircle: true,
});
map.addControl(geo, "bottom-right");
map.touchZoomRotate.enable();
map.dragRotate.enable();

// ---------- dados de pontos (GeoJSON, desenhados na GPU) ----------
let pontos = []; // {lng, lat, placa, especie}
let pontosSaoTeste = true; // pontos gerados (não importados) → podem ser movidos pro GPS
let primeiraLoc = true;
const fc = () => ({
  type: "FeatureCollection",
  features: pontos.map((p, i) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    properties: { placa: String(p.placa || (i + 1)), especie: p.especie || "" },
  })),
});
function atualizarPontos() {
  const src = map.getSource("pts");
  if (src) src.setData(fc());
  document.getElementById("contador").textContent = `${pontos.length} ponto(s) · MapLibre (GPU)`;
}

map.on("load", () => {
  map.addSource("pts", { type: "geojson", data: fc() });
  // bolinhas (circle) — GPU, aguenta milhares lisinho
  map.addLayer({
    id: "pts-c", type: "circle", source: "pts",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 17, 7, 20, 9],
      "circle-color": "#1B5E20",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  // placas (texto) — MapLibre esconde sozinho as que se sobrepõem (sem emaranhado),
  // e só a partir do zoom 16.
  map.addLayer({
    id: "pts-l", type: "symbol", source: "pts", minzoom: 16,
    layout: {
      "text-field": ["get", "placa"], "text-font": ["Open Sans Bold"],
      "text-size": 11, "text-allow-overlap": false, "text-ignore-placement": false,
      "text-offset": [0, 0],
    },
    paint: { "text-color": "#ffffff", "text-halo-color": "#000000", "text-halo-width": 1.6 },
  });
  // começa com uma leva de pontos de teste pra já ver a fluidez
  gerarPontos(1500);
  setTimeout(() => geo.trigger(), 800); // tenta pegar GPS
});

// tocar num ponto → mostra placa/espécie
map.on("click", "pts-c", (e) => {
  const f = e.features[0]; const c = f.geometry.coordinates.slice();
  new maplibregl.Popup().setLngLat(c)
    .setHTML(`<b>${f.properties.placa || "ponto"}</b><br>${f.properties.especie || "—"}`).addTo(map);
});
map.on("mouseenter", "pts-c", () => { map.getCanvas().style.cursor = "pointer"; });
map.on("mouseleave", "pts-c", () => { map.getCanvas().style.cursor = ""; });

// ---------- régua: distância da minha posição até a mira (centro) ----------
let minhaPos = null; // [lng,lat]
geo.on("geolocate", (e) => {
  minhaPos = [e.coords.longitude, e.coords.latitude];
  // na 1ª localização, joga os pontos de TESTE pra perto de você (se não importou nada)
  if (primeiraLoc && pontosSaoTeste && pontos.length) {
    primeiraLoc = false; pontos = []; gerarPontosEm(minhaPos, 1500);
  }
  atualizarLeitura();
});
function dist(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLon = (b[0] - a[0]) * rad;
  const la1 = a[1] * rad, la2 = b[1] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function atualizarLeitura() {
  const el = document.getElementById("leitura");
  if (!minhaPos) { el.hidden = true; return; }
  const c = map.getCenter();
  el.hidden = false;
  el.textContent = `${dist(minhaPos, [c.lng, c.lat]).toFixed(0)} m`;
}
map.on("move", atualizarLeitura);

// ---------- gerar / limpar pontos de teste ----------
function gerarPontosEm(centro, n) {
  const [clng, clat] = centro;
  const base = pontos.length;
  pontosSaoTeste = true;
  for (let i = 0; i < n; i++) {
    // cluster espiral em volta do centro (~0.5 km)
    const ang = Math.PI * 2 * ((i * 137.5) % 360) / 360;
    const r = (((i * 2654435761) % 1000) / 1000) ** 0.5 * 0.006; // graus
    pontos.push({ lng: clng + Math.cos(ang) * r * 1.6, lat: clat + Math.sin(ang) * r, placa: base + i + 1, especie: "" });
  }
  atualizarPontos();
}
function gerarPontos(n) { const c = map.getCenter(); gerarPontosEm([c.lng, c.lat], n); }

// ---------- import KML/KMZ ----------
function parseKML(txt) {
  const doc = new DOMParser().parseFromString(txt, "application/xml");
  const out = [];
  for (const pm of doc.getElementsByTagName("Placemark")) {
    const nome = (pm.getElementsByTagName("name")[0]?.textContent || "").trim();
    const pt = pm.getElementsByTagName("Point")[0];
    if (!pt) continue;
    const c = (pt.getElementsByTagName("coordinates")[0]?.textContent || "").trim();
    if (!c) continue;
    const [lo, la] = c.split(/\s+/)[0].split(",").map(Number);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      let placa = nome, especie = "";
      if (nome.includes("|")) { const ps = nome.split("|").map((s) => s.trim()); placa = ps[0]; especie = ps[1] || ""; }
      out.push({ lng: lo, lat: la, placa, especie });
    }
  }
  return out;
}
async function kmlDeKMZ(buf) {
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  // acha EOCD
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error("KMZ inválido");
  const nEnt = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  for (let e = 0; e < nEnt; e++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const method = dv.getUint16(off + 10, true);
    const compSize = dv.getUint32(off + 20, true);
    const nameLen = dv.getUint16(off + 28, true);
    const extraLen = dv.getUint16(off + 30, true);
    const commLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    const nome = dec.decode(u8.subarray(off + 46, off + 46 + nameLen));
    off += 46 + nameLen + extraLen + commLen;
    if (!/\.kml$/i.test(nome)) continue;
    // local header → dados
    const lNameLen = dv.getUint16(lho + 26, true), lExtra = dv.getUint16(lho + 28, true);
    const dataStart = lho + 30 + lNameLen + lExtra;
    const comp = u8.subarray(dataStart, dataStart + compSize);
    if (method === 0) return dec.decode(comp);
    if (method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const ab = await new Response(new Blob([comp]).stream().pipeThrough(ds)).arrayBuffer();
      return dec.decode(new Uint8Array(ab));
    }
  }
  throw new Error("Sem .kml dentro do KMZ");
}

document.getElementById("b-importar").onclick = () => document.getElementById("file-kml").click();
document.getElementById("file-kml").onchange = async (ev) => {
  const file = ev.target.files && ev.target.files[0]; if (!file) return;
  try {
    const txt = /\.kmz$/i.test(file.name) ? await kmlDeKMZ(await file.arrayBuffer()) : await file.text();
    const novos = parseKML(txt);
    if (!novos.length) { alert("Não achei pontos nesse arquivo."); ev.target.value = ""; return; }
    pontosSaoTeste = false; primeiraLoc = false; // importou dados reais → não mexer
    pontos = pontos.concat(novos);
    atualizarPontos();
    // enquadra nos pontos importados
    const b = new maplibregl.LngLatBounds();
    novos.forEach((p) => b.extend([p.lng, p.lat]));
    map.fitBounds(b, { padding: 60, maxZoom: 18 });
    alert(`Importados ${novos.length} ponto(s).`);
  } catch (err) { alert("Erro ao ler: " + (err?.message || err)); }
  ev.target.value = "";
};

// ---------- botões ----------
document.getElementById("b-gerar").onclick = () => gerarPontos(500);
document.getElementById("b-limpar").onclick = () => { pontos = []; atualizarPontos(); };
document.getElementById("b-eu").onclick = () => geo.trigger();
document.getElementById("b-norte").onclick = () => map.easeTo({ bearing: 0, pitch: 0, duration: 300 });
document.getElementById("b-camada").onclick = () => {
  camadaIdx = (camadaIdx + 1) % CAMADAS.length;
  map.getSource("sat").setTiles([CAMADAS[camadaIdx].url]);
  const b = document.getElementById("b-camada");
  b.textContent = camadaIdx === 0 ? "🛰️" : "🗺️";
};
document.getElementById("b-labels").onclick = () => {
  const b = document.getElementById("b-labels");
  const vis = map.getLayoutProperty("pts-l", "visibility") !== "none";
  map.setLayoutProperty("pts-l", "visibility", vis ? "none" : "visible");
  b.classList.toggle("ativo", vis ? false : true);
};

// registra service worker (offline básico do app shell)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
