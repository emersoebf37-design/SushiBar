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
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

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
          whatsapp_notif: true,
          produtos_esgotados: [],
          combos_esgotados: [],
          motoboys: [],
        };

        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        const hojeTimestamp = hoje.getTime();

        // ✅ Filtra no Firestore, não traz o histórico inteiro
        const ordersSnap = await db
          .collection("orders")
          .where("createdAt", ">=", hojeTimestamp)
          .orderBy("createdAt", "desc")
          .get();

        const pedidosHoje = [];
        let totalDia = 0;

        ordersSnap.forEach(doc => {
          const order = doc.data();
          pedidosHoje.push({ id: doc.id, ...order });
          totalDia += order.total || 0;
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
      const { motoboy_on, restaurante_aberto, whatsapp_notif, produtos_esgotados, combos_esgotados, motoboys } = req.body;

      // 2. Gravando no Firestore incluindo a lista de motoboys
      await db.collection("config").doc("settings").set({
        motoboy_on: motoboy_on ?? false,
        restaurante_aberto: restaurante_aberto ?? true,
        whatsapp_notif: whatsapp_notif ?? true,
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

  // ========================
  // POST /api/admin?action=reprint
  // ========================
  if (req.method === "POST" && req.query.action === "reprint") {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: "orderId obrigatório." });
    }

    const reprintPort = process.env.REPRINT_PORT || "3099";
    const reprintSecret = process.env.REPRINT_SECRET || "kaizora-reprint";

    try {
      const http = require("http");
      const payload = JSON.stringify({ orderId: Number(orderId), secret: reprintSecret });

      await new Promise((resolve, reject) => {
        const request = http.request(
          {
            hostname: "127.0.0.1",
            port: reprintPort,
            path: "/reprint",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(payload),
            },
          },
          (response) => {
            let data = "";
            response.on("data", chunk => { data += chunk; });
            response.on("end", () => {
              if (response.statusCode === 200) {
                resolve(JSON.parse(data));
              } else {
                try {
                  reject(new Error(JSON.parse(data).error || `Status ${response.statusCode}`));
                } catch {
                  reject(new Error(`Status ${response.statusCode}`));
                }
              }
            });
          }
        );
        request.on("error", reject);
        request.write(payload);
        request.end();
      });

      return res.status(200).json({ success: true });
    } catch (err) {
      console.error("Erro na reimpressão:", err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}