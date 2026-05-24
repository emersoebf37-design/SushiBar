// api/distance.js
// Calcula distância entre o restaurante e o endereço do cliente

const RESTAURANTE = "Av. Estácio de Sá, 787, Parque Novo Rio, RJ, CEP 25585-000, Brasil";

// Tabela de taxas por km
function calcularTaxa(distanciaKm, motoboy_on) {

  const km = Math.ceil(distanciaKm);

  // acima de 8km
  if (km > 8) {
    return {
      taxa: 0,
      entrega: false,
      motivo: "Endereço fora do raio máximo de entrega (8km)."
    };
  }

  let taxa = 2;

  // entre 1 e 2km
  if (km > 1) {
    taxa += 1;
  }

  // acima de 2km
  if (km > 2) {
    taxa += (km - 2) * 2;
  }

  // acima de 3km só com motoboy ativo
  if (km > 3 && !motoboy_on) {
    return {
      taxa: 0,
      entrega: false,
      motivo: "Fora da área de entrega. Entre em contato conosco no (21) 3955-6573."
    };
  }

  return {
    taxa,
    entrega: true
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Método não permitido." });
  }

  const { address, motoboy_on } = req.query;

  if (!address) {
    return res.status(400).json({ error: "Endereço não informado." });
  }

  const apiKey = process.env.GOOGLE_MAPS_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Chave do Google Maps não configurada." });
  }

  try {
    const origem = encodeURIComponent(RESTAURANTE);
    const destino = encodeURIComponent(address);

    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origem}&destinations=${destino}&mode=driving&language=pt-BR&key=${apiKey}`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== "OK") {
      return res.status(400).json({ error: "Não foi possível calcular a distância." });
    }

    const element = data.rows[0]?.elements[0];

    if (!element || element.status !== "OK") {
      return res.status(400).json({ error: "Endereço não encontrado. Verifique o endereço informado." });
    }

    const distanciaMetros = element.distance.value;
    const distanciaKm = distanciaMetros / 1000;
    const distanciaTexto = element.distance.text;
    const duracaoTexto = element.duration.text;

    const motoboy = motoboy_on === "true";
    const resultado = calcularTaxa(distanciaKm, motoboy);

    return res.status(200).json({
      distanciaKm: Math.round(distanciaKm * 10) / 10,
      distanciaTexto,
      duracaoTexto,
      taxa: resultado.taxa,
      entrega: resultado.entrega,
      motivo: resultado.motivo || null,
    });

  } catch (error) {
    console.error("Erro ao calcular distância:", error);
    return res.status(500).json({ error: "Erro ao calcular distância." });
  }
}
