const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_PRIVATE_KEY não definida");

  // Tenta todos os formatos possíveis
  if (key.includes("\\n")) {
    return key.replace(/\\n/g, "\n");
  }

  if (key.includes("\n")) {
    return key;
  }

  // Se vier sem quebras, reconstrói o formato PEM
  const body = key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");

  const lines = body.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: getPrivateKey(),
    }),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ========================
  // POST — Criar novo pedido
  // ========================
  if (req.method === "POST") {
    try {
      const order = req.body;

      const counterRef = db.collection("meta").doc("orderCounter");
      let nextId = 1;

      await db.runTransaction(async (transaction) => {
        const counterSnap = await transaction.get(counterRef);
        if (counterSnap.exists) {
          nextId = (counterSnap.data().current || 0) + 1;
          transaction.update(counterRef, { current: nextId });
        } else {
          transaction.set(counterRef, { current: 1 });
          nextId = 1;
        }
      });

      const newOrder = {
        ...order,
        orderId: nextId,
        createdAt: Date.now(),
        status: "Recebido",
      };

      await db.collection("orders").add(newOrder);

      return res.status(200).json({ success: true, orderId: nextId });
    } catch (error) {
      console.error("Erro ao criar pedido:", error);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }
  }

  // ========================
  // GET — Buscar pedidos por telefone
  // ========================
  if (req.method === "GET") {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Telefone não informado." });

    try {
      const snapshot = await db
        .collection("orders")
        .orderBy("createdAt", "desc")
        .get();

      const orders = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.phone === phone) {
          orders.push({ id: doc.id, ...data });
        }
      });

      return res.status(200).json({ orders });
    } catch (error) {
      console.error("Erro ao buscar pedidos:", error);
      return res.status(500).json({ error: "Erro ao buscar pedidos." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}