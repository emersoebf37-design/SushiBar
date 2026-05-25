// api/distance.js

const RESTAURANTE =
  "Av. Estácio de Sá, 787, Parque Novo Rio, RJ, CEP 25585-000, Brasil";

// ===========================
// RATE LIMIT
// ===========================

const rateLimit = new Map();

function isRateLimited(ip) {

  const now = Date.now();

  const WINDOW = 5 * 60 * 1000; // 5 min
  const MAX_REQUESTS = 10;

  if (!rateLimit.has(ip)) {
    rateLimit.set(ip, []);
  }

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

function getCache(address) {

  const item = cache.get(address);

  if (!item) return null;

  if (Date.now() > item.expires) {
    cache.delete(address);
    return null;
  }

  return item.data;
}

function setCache(address, data) {

  cache.set(address, {
    data,
    expires: Date.now() + CACHE_TIME
  });
}

// ===========================
// TAXA
// ===========================

function calcularTaxa(distanciaKm, motoboy_on) {

  const km = Math.ceil(distanciaKm);

  if (km > 8) {
    return {
      taxa: 0,
      entrega: false,
      motivo:
        "Endereço fora do raio máximo de entrega (8km)."
    };
  }

  let taxa = 2;

  if (km > 1) {
    taxa += 1;
  }

  if (km > 2) {
    taxa += (km - 2) * 2;
  }

  if (km > 3 && !motoboy_on) {
    return {
      taxa: 0,
      entrega: false,
      motivo:
        "Fora da área de entrega. Entre em contato conosco no (21) 3955-6573."
    };
  }

  return {
    taxa,
    entrega: true
  };
}

// ===========================
// API
// ===========================

export default async function handler(req, res) {

  const allowedOrigin =
  "https://sushi-bar-beige.vercel.app";

  const origin = req.headers.origin;

  if (!origin || origin !== allowedOrigin) {
  return res.status(403).json({
    error: "Origem não permitida."
  });
  }

  if (req.method === "OPTIONS") {

  res.setHeader(
    "Access-Control-Allow-Origin",
    allowedOrigin
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
  "Cache-Control",
  "s-maxage=1800"
  );

  return res.status(200).end();
  }

  if(origin === allowedOrigin){
    res.setHeader(
      "Access-Control-Allow-Origin",
      allowedOrigin
    );
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");


  if (req.method !== "GET") {
    return res
      .status(405)
      .json({ error: "Método não permitido." });
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
      error:
        "Muitas consultas realizadas. Aguarde alguns minutos."
    });
  }

  // ===========================
  // VALIDAÇÃO
  // ===========================

  let { address, motoboy_on } = req.query;

  if (!address) {
    return res
      .status(400)
      .json({ error: "Endereço não informado." });
  }

  if (address.length < 10) {
    return res.status(400).json({
      error: "Endereço inválido."
    });
  }

  if (address.length > 200) {
  return res.status(400).json({
    error: "Endereço muito grande."
  });
}

  // ===========================
  // CACHE
  // ===========================

  const normalizedAddress =
    address.trim().toLowerCase();

  const cached = getCache(normalizedAddress);

  if (cached) {
    return res.status(200).json(cached);
  }

  // ===========================
  // GOOGLE API
  // ===========================

  const apiKey = process.env.GOOGLE_MAPS_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "Chave do Google Maps não configurada."
    });
  }

  try {

    const origem =
      encodeURIComponent(RESTAURANTE);

    const destino =
      encodeURIComponent(address);

    const url =
      `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origem}&destinations=${destino}&mode=driving&language=pt-BR&key=${apiKey}`;

    // ===========================
    // TIMEOUT
    // ===========================

    const controller =
      new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, 7000);

    const response = await fetch(url, {
      signal: controller.signal
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(400).json({
        error:
          "Não foi possível calcular a distância."
      });
    }

    const element =
      data.rows[0]?.elements[0];

    if (!element || element.status !== "OK") {
      return res.status(400).json({
        error:
          "Endereço não encontrado."
      });
    }

    const distanciaMetros =
      element.distance.value;

    const distanciaKm =
      distanciaMetros / 1000;

    const distanciaTexto =
      element.distance.text;

    const duracaoTexto =
      element.duration.text;

    const motoboy =
      motoboy_on === "true";

    const resultado =
      calcularTaxa(
        distanciaKm,
        motoboy
      );

    const finalData = {

      distanciaKm:
        Math.round(distanciaKm * 10) / 10,

      distanciaTexto,

      duracaoTexto,

      taxa: resultado.taxa,

      entrega: resultado.entrega,

      motivo:
        resultado.motivo || null
    };

    // salva cache
    setCache(
      normalizedAddress,
      finalData
    );

    return res.status(200).json(finalData);

  } catch (error) {

    console.error(
      "Erro ao calcular distância:",
      error
    );

    return res.status(500).json({
      error:
        "Erro ao calcular distância."
    });
  }
}

