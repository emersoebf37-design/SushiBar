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

const VALID_TYPES = ["produto", "adicional", "combo"];
const MAX_APPLIES_TO = 200;

// ========================
// PRODUTOS BASE PADRÃO (migração do sistema antigo hardcoded)
// Usam ID fixo para integridade e estabilidade.
// Inseridos automaticamente uma única vez se a base estiver vazia.
// ========================
const DEFAULT_PRODUCTS_MIGRATION = [
  // --- Pratos ---
  {
    id: "prod_hot_roll_philadelphia",
    type: "produto",
    name: "Hot Roll Philadelphia Salmão (8 unidades)",
    price: 16,
    category: "Hots",
    description: "Sushi empanado com farinha Panko, recheado com salmão fresco, cream cheese e arroz, envolto em alga nori.",
    image: "Imagens/Hot Roll Philadelphia.jpg",
    esgotado: false
  },
  {
    id: "prod_haru_hot_philadelphia",
    type: "produto",
    name: "Haru hot Philadelphia Salmão (8 unidades)",
    price: 22,
    category: "Hots",
    description: "Sushi recheado com salmão fresco, cream cheese e arroz, envolto em massa de rolinho primavera crocante.",
    image: "Imagens/Haru Salmão.jpg",
    esgotado: false
  },
  {
    id: "prod_hot_roll_skin",
    type: "produto",
    name: "Hot Roll Skin (8 unidades)",
    price: 8,
    category: "Hots",
    description: "Sushi empanado com farinha Panko, recheado com Skin de Salmão, cream cheese e arroz, envolto em alga nori.",
    image: "Imagens/Hot Roll Skin.jpg",
    esgotado: false
  },
  {
    id: "prod_hot_roll_kani",
    type: "produto",
    name: "Hot Roll Kani (8 unidades)",
    price: 10.50,
    category: "Hots",
    description: "Sushi empanado com farinha Panko, recheado com kani, cream cheese e arroz, envolto em alga nori.",
    image: "Imagens/Hot Roll Kani.jpg",
    esgotado: false
  },
  {
    id: "prod_bolinho_bacalhau",
    type: "produto",
    name: "Bolinho de bacalhau (8 unidades)",
    price: 8,
    category: "Entradas",
    description: "Bolinhos de bacalhau crocantes.",
    image: "Imagens/Bolinho de bacalhau.jpg",
    esgotado: false
  },
  {
    id: "prod_harumaki_doce_leite",
    type: "produto",
    name: "Harumaki de Doce de leite (3 unidades)",
    price: 13,
    category: "Harumaki",
    description: "Rolinho primavera recheado com doce de leite, envolto em massa crocante.",
    image: "Imagens/Harumaki Doce de Leite.jpg",
    esgotado: false
  },
  {
    id: "prod_big_dog_hot",
    type: "produto",
    name: "Big Dog Hot",
    price: 35,
    category: "Hots",
    description: "Roll empanado frito com salmão fresco e cream cheese no topo, acompanhado de 3 unidades de camarão empanado",
    image: "Imagens/Big Dog Hot.jpg",
    esgotado: false
  },
  {
    id: "prod_temaki_frito",
    type: "produto",
    name: "Temaki Frito",
    price: 24,
    category: "Hots",
    description: "Temaki empanado com farinha Panko, recheado com salmão fresco, cream cheese e arroz, envolto em alga nori.",
    image: "Imagens/Temaki-Frito.jpg",
    esgotado: false
  },
  {
    id: "prod_croquete_camarao",
    type: "produto",
    name: "Croquete de Camarão (4 unidades)",
    price: 12,
    category: "Entradas",
    description: "Croquete de camarão e cream cheese crocantes.",
    image: "Imagens/Croquete de Camarão.jpeg",
    esgotado: false
  },
  {
    id: "prod_yaki_frango",
    type: "produto",
    name: "Yakisoba de Frango",
    price: 25,
    category: "Refeições",
    description: "Macarrão oriental selado na chapa com frango suculento, legumes e shoyu.",
    image: "Imagens/Yakisoba Frango.jpg",
    isVariable: true,
    sizes: [
      { id: "M", label: "Médio", price: 25 },
      { id: "G", label: "Grande", price: 30 }
    ],
    esgotado: false
  },
  {
    id: "prod_yaki_calabresa",
    type: "produto",
    name: "Yakisoba de Calabresa",
    price: 19,
    category: "Refeições",
    description: "Macarrão oriental selado na chapa com linguiça calabresa macia, legumes e shoyu.",
    image: "Imagens/Yakisoba Calabresa.JPG",
    isVariable: true,
    sizes: [
      { id: "M", label: "Médio", price: 19 },
      { id: "G", label: "Grande", price: 27 }
    ],
    esgotado: false
  },
  {
    id: "prod_yaki_carne",
    type: "produto",
    name: "Yakisoba de Carne",
    price: 28,
    category: "Refeições",
    description: "Macarrão oriental selado na chapa com carne bovina macia, legumes e shoyu.",
    image: "Imagens/Yakisoba Carne.jpg",
    isVariable: true,
    sizes: [
      { id: "M", label: "Médio", price: 28 },
      { id: "G", label: "Grande", price: 35 }
    ],
    esgotado: false
  },
  {
    id: "prod_yaki_legumes",
    type: "produto",
    name: "Yakisoba de Legumes",
    price: 17,
    category: "Refeições",
    description: "Macarrão oriental selado na chapa com cenoura, repolho roxo, cebola, brocolis e shoyu.",
    image: "Imagens/Yakisoba Legumes.jpg",
    isVariable: true,
    sizes: [
      { id: "M", label: "Médio", price: 17 },
      { id: "G", label: "Grande", price: 25 }
    ],
    esgotado: false
  },
  {
    id: "prod_yaki_misto",
    type: "produto",
    name: "Yakisoba Misto",
    price: 30,
    category: "Refeições",
    description: "Macarrão oriental selado na chapa com carne bovina, frango, linguiça calabresa, legumes, camarão e shoyu.",
    image: "Imagens/Yakisoba Misto.jpg",
    isVariable: true,
    sizes: [
      { id: "M", label: "Médio", price: 30 },
      { id: "G", label: "Grande", price: 37 }
    ],
    esgotado: false
  },
  {
    id: "prod_yaki_camarao",
    type: "produto",
    name: "Yakisoba Camarão",
    price: 30,
    category: "Refeições",
    description: "Macarrão oriental selado na chapa com camarão, legumes e shoyu.",
    image: "Imagens/Yakisoba Camarão.jpg",
    isVariable: true,
    sizes: [
      { id: "M", label: "Médio", price: 30 },
      { id: "G", label: "Grande", price: 35 }
    ],
    esgotado: false
  },

  // --- Combos ---
  {
    id: "combo_osaka",
    type: "combo",
    name: "Combo Osaka",
    price: 75,
    category: "Combos",
    description: "Combo completo individual",
    descricaoModal: "1 Temaki Frito de Salmão, 16 Hot Roll Philadelphia, 8 Hot Skin e 1 refrigerante Lata 350ml.",
    image: "Imagens/Combo Osaka.jpg",
    esgotado: false
  },
  {
    id: "combo_shanghai",
    type: "combo",
    name: "Combo Shanghai",
    price: 45,
    category: "Combos",
    description: "Um combo completo para se deliciar.",
    descricaoModal: "1 Yakisoba (Frango, Legumes ou calabresa), 8 Hot Roll Kani e 1 Guaravita.",
    image: "Imagens/Combo Shangai.jpg",
    esgotado: false
  },
  {
    id: "combo_kawaguchi",
    type: "combo",
    name: "Combo Kawaguchi",
    price: 47,
    category: "Combos",
    description: "32 unidades de puro sabor",
    descricaoModal: "8 Hot roll de salmão, 8 Hot Kani, 16 bolinho de bacalhau e 2 refrigerantes Lata 350ml.",
    image: "Imagens/Combo Kawaguchi.jpg",
    esgotado: false
  },
  {
    id: "combo_mega_hot_roll",
    type: "combo",
    name: "Mega Combo Hot Roll",
    price: 40,
    category: "Combos",
    description: "Hot Roll até não dar mais.",
    descricaoModal: "32 Hot Roll Philadelphia.",
    image: "Imagens/Mega Combo Hot Roll.jpg",
    esgotado: false
  },

  // --- Adicionais ---
  {
    id: "hashi",
    type: "adicional",
    name: "Adaptador de hashi",
    price: 0,
    category: "Adicionais",
    image: "Imagens/hashi.jpg",
    description: "Adaptador de hashi",
    appliesToAll: true,
    appliesTo: [],
    esgotado: false
  },
  {
    id: "talheres",
    type: "adicional",
    name: "Talheres",
    price: 0,
    category: "Adicionais",
    image: "Imagens/talheres.jpg",
    description: "Talheres",
    appliesToAll: true,
    appliesTo: [],
    esgotado: false
  },
  {
    id: "amendoim",
    type: "adicional",
    name: "Amendoim",
    price: 0,
    category: "Adicionais",
    image: "Imagens/amendoim.jpg",
    description: "Amendoim sem sal",
    appliesToAll: false,
    appliesTo: ["Frango Xadrez"],
    esgotado: false
  },
  {
    id: "cream-cheese-extra",
    type: "adicional",
    name: "Cream cheese extra (8 unidades)",
    price: 1.00,
    category: "Adicionais",
    image: "Imagens/cream-cheese-extra.jpg",
    description: "Cream cheese extra",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
    esgotado: false
  },
  {
    id: "cream-cheese-crocante",
    type: "adicional",
    name: "Cream cheese extra com crocante (8 unidades)",
    price: 1.50,
    category: "Adicionais",
    image: "Imagens/cream-cheese-crocante.jpg",
    description: "Cream cheese extra com crocante",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
    esgotado: false
  },
  {
    id: "cream-cheese-couve",
    type: "adicional",
    name: "Cream cheese extra com couve frita (8 unidades)",
    price: 1.50,
    category: "Adicionais",
    image: "Imagens/cream-cheese-couve.jpg",
    description: "Cream cheese extra com couve frita",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
    esgotado: false
  },
  {
    id: "cream-cheese-geleia-pimenta",
    type: "adicional",
    name: "Cream cheese extra com geleia de pimenta (8 unidades)",
    price: 1.50,
    category: "Adicionais",
    image: "Imagens/cream-cheese-geleia-pimenta.jpg",
    description: "Cream cheese extra com geleia de pimenta",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
    esgotado: false
  },
  {
    id: "cream-cheese-temaki",
    type: "adicional",
    name: "Cream cheese extra no temaki",
    price: 2.00,
    category: "Adicionais",
    image: "Imagens/cream-cheese-temaki.jpg",
    description: "Cream cheese extra no temaki",
    appliesToAll: false,
    appliesTo: ["Temaki Frito", "Combo Osaka"],
    esgotado: false
  },
];

// Cache em memória na instância serverless para minimizar leituras no Firestore
let productsCache = null;
let productsCacheAt = 0;
const PRODUCTS_CACHE_MS = 60 * 1000; // 60 segundos de cache

function invalidateProductsCache() {
  productsCache = null;
  productsCacheAt = 0;
}

// Garante que todos os itens padrão (pratos, combos e adicionais) existam na coleção custom_products
// Usa marcador 'meta/productsSeedV3' com transação para rodar APENAS 1 vez no banco inteiro
async function ensureDefaultProducts(db) {
  const markerRef = db.collection("meta").doc("productsSeedV3");
  const markerSnap = await markerRef.get();
  if (markerSnap.exists) return;

  try {
    const now = Date.now();
    const batch = db.batch();

    for (let i = 0; i < DEFAULT_PRODUCTS_MIGRATION.length; i++) {
      const item = DEFAULT_PRODUCTS_MIGRATION[i];
      const ref = db.collection("custom_products").doc(item.id);
      const toSave = {
        type: item.type,
        name: item.name,
        category: item.category,
        description: item.description,
        price: item.price,
        image: item.image,
        esgotado: item.esgotado || false,
        createdAt: now + i,
      };
      if (item.isVariable) {
        toSave.isVariable = true;
        toSave.sizes = item.sizes || [];
      }
      if (item.descricaoModal) toSave.descricaoModal = item.descricaoModal;
      if (item.type === "adicional") {
        toSave.appliesToAll = item.appliesToAll;
        toSave.appliesTo = item.appliesTo;
      }
      batch.set(ref, toSave, { merge: true });
    }

    batch.set(markerRef, { seededAt: now });
    await batch.commit();
  } catch (e) {
    console.warn("Erro ao popular produtos padrão:", e.message);
  }
}

function sanitizeAppliesTo(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  const seen = new Set();
  for (const entry of list) {
    const name = clean(entry).slice(0, 100);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    cleaned.push(name);
    if (cleaned.length >= MAX_APPLIES_TO) break;
  }
  return cleaned;
}

function sanitizeSizes(raw) {
  if (!Array.isArray(raw)) return null;
  const list = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const id = clean(s.id).slice(0, 30);
    const label = clean(s.label).slice(0, 50);
    const price = Number(s.price);
    if (!id || !label || !Number.isFinite(price) || price < 0 || price > 1000) continue;
    list.push({ id, label, price });
  }
  return list.length > 0 ? list : null;
}

// ========================
// API HANDLER
// ========================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

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
  // GET /api/products  (público — usado pelo cardápio e pelo admin)
  // ========================
  if (req.method === "GET") {
    try {
      const now = Date.now();
      if (productsCache && (now - productsCacheAt < PRODUCTS_CACHE_MS)) {
        res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
        return res.status(200).json({ items: productsCache });
      }

      await ensureDefaultProducts(db);
      const snap = await db.collection("custom_products").get();
      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));

      // Ordena por 'order' (se definido) ou por 'createdAt'
      items.sort((a, b) => {
        const orderA = Number.isFinite(a.order) ? a.order : (a.createdAt || 0);
        const orderB = Number.isFinite(b.order) ? b.order : (b.createdAt || 0);
        return orderA - orderB;
      });

      productsCache = items;
      productsCacheAt = now;

      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=120");
      return res.status(200).json({ items });
    } catch (error) {
      console.error("Erro ao buscar produtos customizados:", error);
      if (productsCache) {
        return res.status(200).json({ items: productsCache });
      }
      return res.status(500).json({ error: "Erro ao buscar produtos." });
    }
  }

  // A partir daqui, todas as rotas exigem autenticação de admin
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  // ========================
  // POST /api/products?action=reorder
  // ========================
  if (req.method === "POST" && req.query.action === "reorder") {
    try {
      const orders = req.body && Array.isArray(req.body.orders) ? req.body.orders : [];
      if (orders.length === 0) {
        return res.status(400).json({ error: "Lista de ordenação vazia." });
      }

      const batch = db.batch();
      orders.forEach(item => {
        if (item && item.id && Number.isFinite(item.order)) {
          const ref = db.collection("custom_products").doc(item.id);
          batch.update(ref, { order: item.order });
        }
      });

      await batch.commit();
      invalidateProductsCache();
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Erro ao reordenar produtos:", error);
      return res.status(500).json({ error: "Erro ao salvar nova ordem dos produtos." });
    }
  }

  // ========================
  // POST /api/products?action=toggle_stock&id=xxxx
  // ========================
  if (req.method === "POST" && req.query.action === "toggle_stock") {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "ID não informado." });

      const ref = db.collection("custom_products").doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Item não encontrado." });
      }
      const existing = snap.data();
      const esgotado = req.body && typeof req.body.esgotado === "boolean" 
        ? req.body.esgotado 
        : !existing.esgotado;

      await ref.update({ esgotado });
      invalidateProductsCache();
      return res.status(200).json({ success: true, id, esgotado });
    } catch (error) {
      console.error("Erro ao alterar estoque:", error);
      return res.status(500).json({ error: "Erro ao alterar estoque do item." });
    }
  }

  // ========================
  // POST /api/products?action=create
  // ========================
  if (req.method === "POST" && req.query.action === "create") {
    try {
      const body = req.body || {};

      const type = clean(body.type);
      const name = clean(body.name);
      const category = clean(body.category) || (type === "adicional" ? "Adicionais" : "Outros");
      const imageFile = clean(body.image).replace(/^\/+/, ""); // remove barras iniciais
      const price = Number(body.price);
      const descricaoModal = clean(body.descricaoModal);
      let description = clean(body.description);

      const isVariable = body.isVariable === true || body.isVariable === "true";
      const sanitizedSizes = sanitizeSizes(body.sizes);

      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: "Tipo inválido. Use produto, adicional ou combo." });
      }
      if (!name || name.length > 80) {
        return res.status(400).json({ error: "Nome inválido." });
      }
      // Adicionais não mostram descrição pro cliente — é opcional, cai pro nome.
      if (type === "adicional" && !description) description = name;
      if (!description || description.length > 400) {
        return res.status(400).json({ error: "Descrição inválida (máx. 400 caracteres)." });
      }
      if (isVariable) {
        if (!sanitizedSizes || sanitizedSizes.length === 0) {
          return res.status(400).json({ error: "Adicione ao menos um tamanho com preço válido." });
        }
      } else {
        if (!Number.isFinite(price) || price < 0 || price > 1000) {
          return res.status(400).json({ error: "Preço inválido." });
        }
        if (type !== "adicional" && price <= 0) {
          return res.status(400).json({ error: "Preço inválido." });
        }
      }
      if (!imageFile || imageFile.length > 150 || imageFile.includes("..")) {
        return res.status(400).json({ error: "Nome de arquivo de imagem inválido." });
      }

      // Evita duplicar nomes (o nome é a chave usada na validação de pedidos)
      const existingSnap = await db.collection("custom_products").where("name", "==", name).get();
      if (!existingSnap.empty) {
        return res.status(400).json({ error: "Já existe um item com esse nome." });
      }

      const newItem = {
        type,
        name,
        category,
        description,
        price: isVariable && sanitizedSizes ? Math.min(...sanitizedSizes.map(s => s.price)) : price,
        image: `Imagens/${imageFile}`,
        esgotado: false,
        createdAt: Date.now(),
      };

      if (type === "produto" && isVariable && sanitizedSizes) {
        newItem.isVariable = true;
        newItem.sizes = sanitizedSizes;
      }

      if (type === "combo" && descricaoModal) {
        newItem.descricaoModal = descricaoModal;
      }

      // ✨ Adicionais: a quais pratos/combos ele se aplica.
      // appliesToAll = true → aparece em todo pedido (ex: hashi, talheres).
      // appliesToAll = false → só aparece quando o carrinho tem pelo menos
      // um item cujo nome está em appliesTo (pratos e/ou combos, à escolha do admin).
      if (type === "adicional") {
        const appliesToAll = body.appliesToAll === true || body.appliesToAll === "true";
        newItem.appliesToAll = appliesToAll;
        newItem.appliesTo = appliesToAll ? [] : sanitizeAppliesTo(body.appliesTo);
        if (!appliesToAll && newItem.appliesTo.length === 0) {
          return res.status(400).json({ error: "Selecione ao menos um prato/combo, ou marque \"aplica a todos os pedidos\"." });
        }
      }

      const ref = await db.collection("custom_products").add(newItem);
      invalidateProductsCache();

      return res.status(200).json({ success: true, id: ref.id, item: newItem });
    } catch (error) {
      console.error("Erro ao criar produto:", error);
      return res.status(500).json({ error: "Erro ao salvar o novo item." });
    }
  }

  // ========================
  // POST /api/products?action=update&id=xxxx
  // Edita um item existente (produto, adicional ou combo).
  // ========================
  if (req.method === "POST" && req.query.action === "update") {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "ID não informado." });

      const ref = db.collection("custom_products").doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return res.status(404).json({ error: "Item não encontrado." });
      }
      const existing = snap.data();
      const type = existing.type;

      const body = req.body || {};
      const name = clean(body.name);
      const imageFile = clean(body.image).replace(/^\/+/, "");
      const price = Number(body.price);
      let description = clean(body.description);
      const category = clean(body.category) || existing.category;
      const descricaoModal = clean(body.descricaoModal);

      const isVariable = body.isVariable === true || body.isVariable === "true";
      const sanitizedSizes = sanitizeSizes(body.sizes);

      if (!name || name.length > 80) {
        return res.status(400).json({ error: "Nome inválido." });
      }
      if (type === "adicional" && !description) description = name;
      if (!description || description.length > 400) {
        return res.status(400).json({ error: "Descrição inválida (máx. 400 caracteres)." });
      }
      if (isVariable) {
        if (!sanitizedSizes || sanitizedSizes.length === 0) {
          return res.status(400).json({ error: "Adicione ao menos um tamanho com preço válido." });
        }
      } else {
        if (!Number.isFinite(price) || price < 0 || price > 1000) {
          return res.status(400).json({ error: "Preço inválido." });
        }
        if (type !== "adicional" && price <= 0) {
          return res.status(400).json({ error: "Preço inválido." });
        }
      }
      if (!imageFile || imageFile.length > 150 || imageFile.includes("..")) {
        return res.status(400).json({ error: "Nome de arquivo de imagem inválido." });
      }

      // Se o nome mudou, confere duplicidade contra outros itens (não ele mesmo)
      if (name !== existing.name) {
        const dupSnap = await db.collection("custom_products").where("name", "==", name).get();
        const dupOther = dupSnap.docs.some(d => d.id !== id);
        if (dupOther) {
          return res.status(400).json({ error: "Já existe um item com esse nome." });
        }
      }

      const updated = {
        name,
        category,
        description,
        price: isVariable && sanitizedSizes ? Math.min(...sanitizedSizes.map(s => s.price)) : price,
        image: `Imagens/${imageFile}`,
      };

      if (type === "produto") {
        if (isVariable && sanitizedSizes) {
          updated.isVariable = true;
          updated.sizes = sanitizedSizes;
        } else {
          updated.isVariable = false;
          updated.sizes = [];
        }
      }

      if (type === "combo") {
        updated.descricaoModal = descricaoModal || existing.descricaoModal || "";
      }

      if (type === "adicional") {
        const appliesToAll = body.appliesToAll === true || body.appliesToAll === "true";
        updated.appliesToAll = appliesToAll;
        updated.appliesTo = appliesToAll ? [] : sanitizeAppliesTo(body.appliesTo);
        if (!appliesToAll && updated.appliesTo.length === 0) {
          return res.status(400).json({ error: "Selecione ao menos um prato/combo, ou marque \"aplica a todos os pedidos\"." });
        }
      }

      await ref.update(updated);
      invalidateProductsCache();

      return res.status(200).json({ success: true, id, item: { ...existing, ...updated } });
    } catch (error) {
      console.error("Erro ao editar produto:", error);
      return res.status(500).json({ error: "Erro ao editar o item." });
    }
  }

  // ========================
  // DELETE /api/products?id=xxxx
  // ========================
  if (req.method === "DELETE") {
    try {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: "ID não informado." });

      await db.collection("custom_products").doc(id).delete();
      invalidateProductsCache();
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Erro ao remover produto:", error);
      return res.status(500).json({ error: "Erro ao remover item." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}
