// api/distance.js
// Calcula distância entre o restaurante e o endereço do cliente

const RESTAURANTE = "Av. Estácio de Sá, 787, Parque Novo Rio, RJ, CEP 25585-000, Brasil";

// Tabela de taxas por km
function calcularTaxa(distanciaKm, motoboy_on) {
  if (distanciaKm <= 1) return { taxa: 2, entrega: true };
  if (distanciaKm <= 2) return { taxa: 4, entrega: true };
  if (distanciaKm <= 3) return { taxa: 6, entrega: true };
  if (distanciaKm <= 4) return { taxa: 8, entrega: true };
  if (distanciaKm <= 5) return { taxa: 10, entrega: true };

  // Acima de 5km — só entrega se motoboy_on
  if (!motoboy_on) {
    return { taxa: 0, entrega: false, motivo: "Fora da área de entrega. Retire no local ou use um app." };
  }

  if (distanciaKm <= 6) return { taxa: 13, entrega: true };
  if (distanciaKm <= 7) return { taxa: 16, entrega: true };
  if (distanciaKm <= 8) return { taxa: 19, entrega: true };

  // Acima de 8km — não entregamos
  return { taxa: 0, entrega: false, motivo: "Endereço fora do raio máximo de entrega (8km)." };
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
