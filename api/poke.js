// api/poke.js
//
// Gerencia a configuração do "Poke Personalizado":
//   - GET  (público)  -> devolve a configuração atual (preço base, grupos de
//                        ingredientes com disponibilidade/nome/descrição/preço,
//                        avisos e quantidade de opções de salada permitidas).
//   - POST ?action=update (admin) -> sobrescreve a configuração inteira.
//
// A validação "de verdade" (preço final, se o ingrediente ainda existe e está
// disponível) acontece sempre no servidor, dentro de /api/orders — este
// arquivo é responsável apenas por guardar/servir o catálogo de ingredientes.

const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_PRIVATE_KEY não definida");
  if (key.includes("\\n")) return key.replace(/\\n/g, "\n");
  if (key.includes("\n")) return key;

  const body = key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const lines = body.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

function clean(text) {
  return String(text || "").replace(/[<>]/g, "").trim();
}

const GROUP_KEYS = ["arroz", "proteina", "salada", "crocante"];

// Configuração padrão, usada na primeira vez (documento ainda não existe)
// e como fallback caso o Firestore falhe.
const DEFAULT_CONFIG = {
  title: "Poke Personalizado",
  description: "Monte do seu jeito: escolha o arroz, a proteína, as saladas e o crocante.",
  basePrice: 32.9,
  saladaQtd: 2,
  avisos: [],
  groups: {
    arroz: [
      { id: "arroz-japones", name: "Arroz Japonês", description: "", price: 0, available: true },
      { id: "arroz-brasileiro", name: "Arroz Brasileiro", description: "", price: 0, available: true },
    ],
    proteina: [
      { id: "salmao-cru", name: "Salmão Cru", description: "", price: 0, available: true },
      { id: "salmao-grelhado", name: "Salmão Grelhado", description: "", price: 0, available: true },
      { id: "salmao-cru-cream-cheese", name: "Salmão Cru com Cream Cheese", description: "", price: 0, available: true },
      { id: "salmao-grelhado-cream-cheese", name: "Salmão Grelhado com Cream Cheese", description: "", price: 0, available: true },
    ],
    salada: [
      { id: "cenoura", name: "Cenoura", description: "", price: 0, available: true },
      { id: "repolho", name: "Repolho", description: "", price: 0, available: true },
      { id: "couve-crispy", name: "Couve Crispy", description: "", price: 0, available: true },
    ],
    crocante: [
      { id: "tempura", name: "Tempurá", description: "", price: 0, available: true },
      { id: "chips-batata", name: "Chips de Batata", description: "", price: 0, available: true },
      { id: "chips-batata-doce", name: "Chips de Batata Doce", description: "", price: 0, available: true },
      { id: "couve-frita", name: "Couve Frita", description: "", price: 0, available: true },
      { id: "brocoli-frito", name: "Brócoli Frito", description: "", price: 0, available: true },
    ],
  },
};

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

// Sanitiza/valida a configuração recebida do admin antes de salvar.
function sanitizeConfig(body) {
  const title = clean(body.title).slice(0, 60) || DEFAULT_CONFIG.title;
  const description = clean(body.description).slice(0, 300) || DEFAULT_CONFIG.description;

  const basePrice = Number(body.basePrice);
  if (!Number.isFinite(basePrice) || basePrice < 0 || basePrice > 500) {
    throw new Error("Preço base inválido.");
  }

  const saladaQtd = Number(body.saladaQtd) || 2;
  if (!Number.isInteger(saladaQtd) || saladaQtd < 1 || saladaQtd > 5) {
    throw new Error("Quantidade de opções de salada inválida.");
  }

  const avisosRaw = Array.isArray(body.avisos) ? body.avisos : [];
  const avisos = avisosRaw
    .map(a => clean(a).slice(0, 200))
    .filter(Boolean)
    .slice(0, 20);

  const groups = {};
  const bodyGroups = body.groups || {};

  for (const key of GROUP_KEYS) {
    const list = Array.isArray(bodyGroups[key]) ? bodyGroups[key] : [];
    if (list.length === 0) {
      throw new Error(`O grupo "${key}" precisa ter ao menos uma opção.`);
    }
    if (list.length > 30) {
      throw new Error(`O grupo "${key}" excede o limite de opções.`);
    }

    const seenIds = new Set();
    groups[key] = list.map((opt) => {
      const name = clean(opt.name).slice(0, 60);
      if (!name) throw new Error(`Toda opção do grupo "${key}" precisa de um nome.`);

      let id = clean(opt.id) || slugify(name);
      id = slugify(id) || slugify(name) || Math.random().toString(36).slice(2, 8);
      // Evita ids duplicados dentro do mesmo grupo
      let finalId = id;
      let n = 2;
      while (seenIds.has(finalId)) {
        finalId = `${id}-${n++}`;
      }
      seenIds.add(finalId);

      const description = clean(opt.description).slice(0, 200);
      const price = Number(opt.price) || 0;
      if (price < 0 || price > 200) {
        throw new Error(`Preço inválido para a opção "${name}".`);
      }
      const available = opt.available !== false;

      return { id: finalId, name, description, price, available };
    });
  }

  return { title, description, basePrice, saladaQtd, avisos, groups, updatedAt: Date.now() };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") return res.status(200).end();

  let db;
  try {
    if (!getApps().length) {
      initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: getPrivateKey(),
        }),
      });
    }
    db = getFirestore();
  } catch (e) {
    console.error("ERRO FIREBASE:", e.message);
    return res.status(500).json({ error: "Erro ao conectar ao banco de dados." });
  }

  // ========================
  // GET /api/poke  (público — usado pelo cardápio e pelo admin)
  // ========================
  if (req.method === "GET") {
    try {
      const snap = await db.collection("poke_config").doc("settings").get();
      const config = snap.exists ? { ...DEFAULT_CONFIG, ...snap.data() } : DEFAULT_CONFIG;
      return res.status(200).json(config);
    } catch (error) {
      console.error("Erro ao buscar configuração do Poke:", error);
      return res.status(500).json({ error: "Erro ao buscar configuração do Poke." });
    }
  }

  // A partir daqui, exige autenticação de admin
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  // ========================
  // POST /api/poke?action=update
  // ========================
  if (req.method === "POST" && req.query.action === "update") {
    try {
      const config = sanitizeConfig(req.body || {});
      await db.collection("poke_config").doc("settings").set(config);
      return res.status(200).json({ success: true, config });
    } catch (error) {
      console.error("Erro ao salvar configuração do Poke:", error);
      return res.status(400).json({ error: error.message || "Erro ao salvar configuração do Poke." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}
