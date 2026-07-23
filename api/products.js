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
      const category = clean(body.category) || "Outros";
      const description = clean(body.description);
      const descricaoModal = clean(body.descricaoModal);
      const imageFile = clean(body.image).replace(/^\/+/, ""); // remove barras iniciais
      const price = Number(body.price);
      const hotHossoMin8 = body.hotHossoMin8 === true || body.hotHossoMin8 === "true";
      const temakiFrito = body.temakiFrito === true || body.temakiFrito === "true";

      if (!VALID_TYPES.includes(type)) {
        return res.status(400).json({ error: "Tipo inválido. Use produto, adicional ou combo." });
      }
      if (!name || name.length > 80) {
        return res.status(400).json({ error: "Nome inválido." });
      }
      if (!description || description.length > 400) {
        return res.status(400).json({ error: "Descrição inválida (máx. 400 caracteres)." });
      }
      if (!Number.isFinite(price) || price <= 0 || price > 1000) {
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
      if (type === "combo") {
        newItem.hotHossoMin8 = hotHossoMin8;
        newItem.temakiFrito = temakiFrito;
      }

      const ref = await db.collection("custom_products").add(newItem);

      return res.status(200).json({ success: true, id: ref.id, item: newItem });
    } catch (error) {
      console.error("Erro ao criar produto:", error);
      return res.status(500).json({ error: "Erro ao salvar o novo item." });
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
