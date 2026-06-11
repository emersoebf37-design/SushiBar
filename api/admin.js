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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Firebase inicializado DENTRO do handler
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
  // POST /api/admin?action=login
  // ========================
  if (req.method === "POST" && req.query.action === "login") {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      return res.status(200).json({ success: true, token: process.env.ADMIN_PASSWORD });
    }
    return res.status(401).json({ error: "Senha incorreta." });
  }

  // Verifica token em todas as outras rotas
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  // ========================
  // GET /api/admin
  // ========================
  if (req.method === "GET") {
    try {
      const configRef = db.collection("config").doc("settings");
      const configSnap = await configRef.get();
      const config = configSnap.exists ? configSnap.data() : {
        motoboy_on: false,
        restaurante_aberto: true,
        produtos_esgotados: [],
        combos_esgotados: [],
        motoboys: [], // 👈 Adicionado fallback aqui
      };

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hojeTimestamp = hoje.getTime();

      const ordersSnap = await db
        .collection("orders")
        .orderBy("createdAt", "desc")
        .get();

      const pedidosHoje = [];
      let totalDia = 0;

      ordersSnap.forEach(doc => {
        const order = doc.data();
        if (order.createdAt >= hojeTimestamp) {
          pedidosHoje.push({ id: doc.id, ...order });
          totalDia += order.total || 0;
        }
      });

      const ticketMedio = pedidosHoje.length > 0
        ? totalDia / pedidosHoje.length
        : 0;

      return res.status(200).json({
        config,
        pedidosHoje,
        totalDia,
        ticketMedio,
        totalPedidos: pedidosHoje.length,
      });

    } catch (error) {
      console.error("Erro no admin GET:", error);
      return res.status(500).json({ error: "Erro ao buscar dados." });
    }
  }

  // ========================
  // POST /api/admin?action=update
  // ========================
  if (req.method === "POST" && req.query.action === "update") {
    try {
      // 1. Desestruturando "motoboys" que vem lá do admin.html
      const { motoboy_on, restaurante_aberto, produtos_esgotados, combos_esgotados, motoboys } = req.body;

      // 2. Gravando no Firestore incluindo a lista de motoboys
      await db.collection("config").doc("settings").set({
        motoboy_on: motoboy_on ?? false,
        restaurante_aberto: restaurante_aberto ?? true,
        produtos_esgotados: produtos_esgotados ?? [],
        combos_esgotados: combos_esgotados ?? [],
        motoboys: motoboys ?? [],
        updatedAt: Date.now(),
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Erro ao salvar config:", error);
      return res.status(500).json({ error: "Erro ao salvar configurações." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}