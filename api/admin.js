import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// ========================
// FIREBASE CONFIG
// ========================
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

// ========================
// API HANDLER (ESM)
// ========================
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
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

  // ✅ CORREÇÃO: Extração do escopo global da requisição para todas as condicionais usarem com segurança
  const action = req.query.action;

  // ─── POST: LOGIN ───
  if (req.method === "POST" && action === "login") {
    const { password } = req.body;
    if (password === process.env.ADMIN_PASSWORD) {
      return res.status(200).json({ success: true, token: process.env.ADMIN_PASSWORD });
    }
    return res.status(401).json({ error: "Senha incorreta." });
  }

  // Porteiro de autenticação das demais rotas do painel
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Não autorizado." });
  }

  // ─── GET: CLIENTES VIP ───
  if (req.method === "GET" && action === "vip_clientes") {
    try {
      const agora = Date.now();
      const snap = await db.collection("customers").where("isVip", "==", true).get();
      const clientes = [];

      snap.forEach(doc => {
        const d = doc.data();
        if (d.isVip && agora <= (d.vipExpires || 0)) {
          clientes.push({
            phone:           d.phone,
            pedidosRecentes: (d.pedidosRecentes || []).length,
            vipSince:        d.vipSince,
            vipExpires:      d.vipExpires,
          });
        }
      });

      return res.status(200).json({ clientes });
    } catch (error) {
      console.error("Erro ao buscar VIPs:", error);
      return res.status(500).json({ error: "Erro ao buscar clientes VIP." });
    }
  }

  // ─── GET: DASHBOARD PRINCIPAL ───
  if (req.method === "GET" && !action) {
    try {
      const configSnap = await db.collection("config").doc("settings").get();
      const config = configSnap.exists ? configSnap.data() : {
        motoboy_on: false,
        restaurante_aberto: true,
        produtos_esgotados: [],
        combos_esgotados: [],
        motoboys: [],
        promocoes: {},
        vip_config: {},
        vip_beneficios: {},
      };

      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const hojeTimestamp = hoje.getTime();

      const ordersSnap = await db.collection("orders").orderBy("createdAt", "desc").get();
      const pedidosHoje = [];
      let totalDia = 0;

      ordersSnap.forEach(doc => {
        const order = doc.data();
        if (order.createdAt >= hojeTimestamp) {
          pedidosHoje.push({ id: doc.id, ...order });
          totalDia += order.total || 0;
        }
      });

      const ticketMedio = pedidosHoje.length > 0 ? totalDia / pedidosHoje.length : 0;

      return res.status(200).json({ 
        config, 
        pedidosHoje, 
        totalDia, 
        ticketMedio, 
        totalPedidos: pedidosHoje.length 
      });
    } catch (error) {
      console.error("Erro no admin GET:", error);
      return res.status(500).json({ error: "Erro ao buscar dados." });
    }
  }

  // ─── POST: SALVAR ATUALIZAÇÕES CONFIG ───
  if (req.method === "POST" && action === "update") {
    try {
      const {
        motoboy_on, restaurante_aberto,
        produtos_esgotados, combos_esgotados,
        motoboys, promocoes, vip_config, vip_beneficios,
      } = req.body;

      await db.collection("config").doc("settings").set({
        motoboy_on:         motoboy_on         ?? false,
        restaurante_aberto: restaurante_aberto ?? true,
        produtos_esgotados: produtos_esgotados ?? [],
        combos_esgotados:   combos_esgotados   ?? [],
        motoboys:           motoboys           ?? [],
        promocoes:          promocoes          ?? {},
        vip_config:         vip_config         ?? {},
        vip_beneficios:     vip_beneficios     ?? {},
        updatedAt:          Date.now(),
      });

      return res.status(200).json({ success: true });
    } catch (error) {
      console.error("Erro ao salvar config:", error);
      return res.status(500).json({ error: "Erro ao salvar configurações." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}