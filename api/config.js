const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

function getPrivateKey() {
  const key = process.env.FIREBASE_PRIVATE_KEY;
  if (!key) throw new Error("FIREBASE_PRIVATE_KEY não definida");
  if (key.includes("\\n")) return key.replace(/\\n/g, "\n");
  return key;
}

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
} catch(e) {
  console.error("ERRO AO INICIALIZAR FIREBASE:", e.message);
}

const db = getFirestore();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const configRef = db.collection("config").doc("settings");
      const snap = await configRef.get();

      if (!snap.exists) {
        // Retorna defaults se não existir ainda
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
