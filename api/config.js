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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // ✅ Firebase inicializado DENTRO do handler
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

  if (req.method === "GET") {
    try {
      const configRef = db.collection("config").doc("settings");
      const snap = await configRef.get();

      if (!snap.exists) {
        return res.status(200).json({
          motoboy_on: false,
          restaurante_aberto: true,
          produtos_esgotados: [],
          combos_esgotados: [],
        });
      }

      return res.status(200).json(snap.data());
    } catch (error) {
      console.error("Erro ao buscar config:", error);
      return res.status(500).json({ error: "Erro ao buscar configurações." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}