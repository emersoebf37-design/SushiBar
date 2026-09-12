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
// ADICIONAIS PADRÃO (migração do sistema antigo hardcoded)
// Usam ID fixo (em vez de auto-gerado) para que a chave usada no carrinho
// (custom_<id>) e nos pedidos antigos continue estável.
// São inseridos automaticamente uma única vez, na primeira vez que
// GET /api/products roda após o deploy desta versão (ver ensureDefaultAddons).
// ========================
const DEFAULT_ADICIONAIS = [
  {
    id: "hashi",
    name: "Adaptador de hashi",
    price: 0,
    image: "Imagens/hashi.jpg",
    description: "Adaptador de hashi",
    appliesToAll: true,
    appliesTo: [],
  },
  {
    id: "talheres",
    name: "Talheres",
    price: 0,
    image: "Imagens/talheres.jpg",
    description: "Talheres",
    appliesToAll: true,
    appliesTo: [],
  },
  {
    id: "amendoim",
    name: "Amendoim",
    price: 0,
    image: "Imagens/amendoim.jpg",
    description: "Amendoim sem sal",
    appliesToAll: false,
    appliesTo: ["Frango Xadrez"],
  },
  {
    id: "cream-cheese-extra",
    name: "Cream cheese extra (8 unidades)",
    price: 1.00,
    image: "Imagens/cream-cheese-extra.jpg",
    description: "Cream cheese extra",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
  },
  {
    id: "cream-cheese-crocante",
    name: "Cream cheese extra com crocante (8 unidades)",
    price: 1.50,
    image: "Imagens/cream-cheese-crocante.jpg",
    description: "Cream cheese extra com crocante",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
  },
  {
    id: "cream-cheese-couve",
    name: "Cream cheese extra com couve frita (8 unidades)",
    price: 1.50,
    image: "Imagens/cream-cheese-couve.jpg",
    description: "Cream cheese extra com couve frita",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
  },
  {
    id: "cream-cheese-geleia-pimenta",
    name: "Cream cheese extra com geleia de pimenta (8 unidades)",
    price: 1.50,
    image: "Imagens/cream-cheese-geleia-pimenta.jpg",
    description: "Cream cheese extra com geleia de pimenta",
    appliesToAll: false,
    appliesTo: [
      "Hot Roll Philadelphia Salmão (8 unidades)", "Hot Roll Skin (8 unidades)", "Hot Roll Kani (8 unidades)",
      "Hossomaki Philadelphia Salmão (8 unidades)", "Hossomaki Skin (8 unidades)", "Hossomaki Kani (8 unidades)",
      "Mega Combo Hot Roll", "Combo Osaka", "Combo Shanghai", "Combo Kawaguchi",
    ],
  },
  {
    id: "cream-cheese-temaki",
    name: "Cream cheese extra no temaki",
    price: 2.00,
    image: "Imagens/cream-cheese-temaki.jpg",
    description: "Cream cheese extra no temaki",
    appliesToAll: false,
    appliesTo: ["Temaki Frito", "Combo Osaka"],
  },
];

// Garante que os adicionais padrão existam, uma única vez.
// Usa um documento marcador (meta/adicionaisSeed) pra nunca rodar de novo —
// mesmo que o admin apague algum adicional padrão depois, ele não "renasce".
async function ensureDefaultAddons(db) {
  const markerRef = db.collection("meta").doc("adicionaisSeed");
  const markerSnap = await markerRef.get();
  if (markerSnap.exists) return;

  try {
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(markerRef);
      if (snap.exists) return;

      const now = Date.now();
      DEFAULT_ADICIONAIS.forEach((item) => {
        const ref = db.collection("custom_products").doc(item.id);
        transaction.set(ref, {
          type: "adicional",
          name: item.name,
          category: "Adicionais",
          description: item.description,
          price: item.price,
          image: item.image,
          appliesToAll: item.appliesToAll,
          appliesTo: item.appliesTo,
          esgotado: false,
          createdAt: now,
        });
      });
      transaction.set(markerRef, { seededAt: now });
    });
  } catch (e) {
    // Se der ruim (ex: corrida entre duas requisições simultâneas), não é
    // fatal — a próxima requisição tenta de novo até o marcador existir.
    console.warn("Erro ao popular adicionais padrão:", e.message);
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
      await ensureDefaultAddons(db);
      const snap = await db.collection("custom_products").orderBy("createdAt", "asc").get();
      const items = [];
      snap.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ items });
    } catch (error) {
      console.error("Erro ao buscar produtos customizados:", error);
      return res.status(500).json({ error: "Erro ao buscar produtos." });
    }
  }

  // A partir daqui, todas as rotas exigem autenticação de admin
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
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
      if (!Number.isFinite(price) || price < 0 || price > 1000) {
        return res.status(400).json({ error: "Preço inválido." });
      }
      if (type !== "adicional" && price <= 0) {
        return res.status(400).json({ error: "Preço inválido." });
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
        price,
        image: `Imagens/${imageFile}`,
        esgotado: false,
        createdAt: Date.now(),
      };

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

      if (!name || name.length > 80) {
        return res.status(400).json({ error: "Nome inválido." });
      }
      if (type === "adicional" && !description) description = name;
      if (!description || description.length > 400) {
        return res.status(400).json({ error: "Descrição inválida (máx. 400 caracteres)." });
      }
      if (!Number.isFinite(price) || price < 0 || price > 1000) {
        return res.status(400).json({ error: "Preço inválido." });
      }
      if (type !== "adicional" && price <= 0) {
        return res.status(400).json({ error: "Preço inválido." });
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
        price,
        image: `Imagens/${imageFile}`,
      };

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
      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Erro ao remover produto:", error);
      return res.status(500).json({ error: "Erro ao remover item." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}
