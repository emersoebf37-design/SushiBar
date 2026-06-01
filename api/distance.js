// api/distance.js

const RESTAURANTE =
  "Av. Estácio de Sá, 787, Parque Novo Rio, São João de Meriti, RJ, CEP 25585-000, Brasil";

// ===========================
// RAIOS DE ENTREGA
// ===========================

const RAIO_SEM_MOTOBOY_KM = 3;  // sem motoboy: até 3 km
const RAIO_COM_MOTOBOY_KM = 8;  // com motoboy: até 8 km

// ===========================
// RATE LIMIT
// ===========================

const rateLimit = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const WINDOW = 5 * 60 * 1000; // 5 min
  const MAX_REQUESTS = 10;

  if (!rateLimit.has(ip)) rateLimit.set(ip, []);

  const requests = rateLimit
    .get(ip)
    .filter(time => now - time < WINDOW);

  requests.push(now);
  rateLimit.set(ip, requests);

  return requests.length > MAX_REQUESTS;
}

// ===========================
// CACHE
// ===========================

const cache = new Map();
const CACHE_TIME = 1000 * 60 * 30; // 30 min

function getCache(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCache(key, data) {
  cache.set(key, {
    data,
    expires: Date.now() + CACHE_TIME
  });
}

// ===========================
// TAXA
// ===========================

function calcularTaxa(distanciaKm, motoboyAtivo) {

  const km = distanciaKm; // usa float real, não arredondado
  const raioMax = motoboyAtivo
    ? RAIO_COM_MOTOBOY_KM
    : RAIO_SEM_MOTOBOY_KM;

  // Fora do raio permitido
  if (km > raioMax) {
    const motivo = motoboyAtivo
      ? `Endereço fora do raio máximo de entrega (${RAIO_COM_MOTOBOY_KM} km).`
      : `Fora da área de entrega sem motoboy (máx. ${RAIO_SEM_MOTOBOY_KM} km). Entre em contato: (21) 3955-6573.`;

    return { taxa: 0, entrega: false, motivo };
  }

  // Tabela de taxa por km real (arredondado para cima)
  const kmCeil = Math.ceil(km);
  let taxa = 2; // base: até 1 km

  if (kmCeil > 1) taxa += 1;             // 2 km  → R$3
  if (kmCeil > 2) taxa += (kmCeil - 2) * 2; // 3 km  → R$5, 4 km → R$7, etc.

  return { taxa, entrega: true };
}

// ===========================
// API
// ===========================

export default async function handler(req, res) {

  const allowedOrigin = "https://sushi-bar-beige.vercel.app";
  const origin = req.headers.origin;

  if (origin && origin !== allowedOrigin) {
    return res.status(403).json({ error: "Origem não permitida." });
  }

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "s-maxage=1800");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  // ===========================
  // RATE LIMIT
  // ===========================

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    "unknown";

  if (isRateLimited(ip)) {
    return res.status(429).json({
      error: "Muitas consultas realizadas. Aguarde alguns minutos."
    });
  }

  // ===========================
  // VALIDAÇÃO
  // ===========================

  let { address, motoboy_on } = req.query;

  if (!address) {
    return res.status(400).json({ error: "Endereço não informado." });
  }

  if (address.length < 10) {
    return res.status(400).json({ error: "Endereço inválido." });
  }

  if (address.length > 200) {
    return res.status(400).json({ error: "Endereço muito grande." });
  }

  // Converte flag do motoboy corretamente
  const motoboyAtivo = motoboy_on === "true";

  // ===========================
  // CACHE
  // (chave inclui flag do motoboy pois o resultado muda)
  // ===========================

  const cacheKey = `${address.trim().toLowerCase()}__motoboy:${motoboyAtivo}`;
  const cached = getCache(cacheKey);

  if (cached) {
    console.log(`📦 Cache hit: ${cacheKey}`);
    return res.status(200).json(cached);
  }

  // ===========================
  // GOOGLE MAPS API
  // ===========================

  const apiKey = process.env.GOOGLE_MAPS_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: "Chave do Google Maps não configurada." });
  }

  try {
    const origem  = encodeURIComponent(RESTAURANTE);
    const destino = encodeURIComponent(address);

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json` +
      `?origins=${origem}` +
      `&destinations=${destino}` +
      `&mode=driving` +
      `&language=pt-BR` +
      `&key=${apiKey}`;

    // Timeout de 7s
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    const data = await response.json();

    if (data.status !== "OK") {
      console.error("Google Maps status:", data.status, data.error_message);
      return res.status(400).json({ error: "Não foi possível calcular a distância." });
    }

    const element = data.rows[0]?.elements[0];

    if (!element || element.status !== "OK") {
      console.error("Element status:", element?.status);
      return res.status(400).json({ error: "Endereço não encontrado pelo Google Maps." });
    }

    const distanciaKm    = element.distance.value / 1000;
    const distanciaTexto = element.distance.text;
    const duracaoTexto   = element.duration.text;

    const resultado = calcularTaxa(distanciaKm, motoboyAtivo);

    console.log(
      `📍 Distância: ${distanciaKm.toFixed(2)} km | ` +
      `Motoboy: ${motoboyAtivo} | ` +
      `Entrega: ${resultado.entrega} | ` +
      `Taxa: R$${resultado.taxa}`
    );

    const finalData = {
      distanciaKm:   Math.round(distanciaKm * 10) / 10,
      distanciaTexto,
      duracaoTexto,
      taxa:          resultado.taxa,
      entrega:       resultado.entrega,
      motivo:        resultado.motivo || null,
    };

    setCache(cacheKey, finalData);

    return res.status(200).json(finalData);

  } catch (error) {
    if (error.name === "AbortError") {
      console.error("Google Maps timeout");
      return res.status(504).json({ error: "Timeout ao calcular distância." });
    }
    console.error("Erro ao calcular distância:", error);
    return res.status(500).json({ error: "Erro ao calcular distância." });
  }
}