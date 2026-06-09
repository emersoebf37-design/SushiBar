import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { processarVip } from '../lib/vip-logic.js';

// ========================
// RATE LIMIT
// ========================
const rateLimit = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 1 * 60 * 1000;
  const maxRequests = 30;

  if (!rateLimit.has(ip)) rateLimit.set(ip, []);

  const requests = rateLimit.get(ip).filter(time => now - time < windowMs);
  requests.push(now);
  rateLimit.set(ip, requests);

  return requests.length > maxRequests;
}

// ========================
// SANITIZAÇÃO
// ========================
function clean(text) {
  return String(text || "").replace(/[<>]/g, "").trim();
}

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
// PRODUTOS BASE
// ========================
const PRODUCTS = {
  "Hot Roll Philadelphia Salmão (8 unidades)": 16,
  "Temaki Frito": 23.99,
  "Temaki": 19.99,
  "Hossomaki Philadelphia Salmão (8 unidades)": 14,
  "Shimeji na Manteiga": 14.90,
  "Hot Roll Skin (8 unidades)": 7.99,
  "Hossomaki Skin (8 unidades)": 6.65,
  "Hot Roll Kani (8 unidades)": 10.65,
  "Hossomaki Kani (8 unidades)": 7.99,
  "Lula à Dorê (6 unidades)": 25.90,
  "Harumaki de Legumes (3 unidades)": 12.99,
  "Harumaki de Salmão (3 unidades)": 19,
  "Harumaki de queijo (3 unidades)": 12.99,
  "Harumaki de Frango com Cream Cheese (3 unidades)": 12.99,
  "Salada Sunomono": 5,
  "Combo Crocantissimo": 49.90,
  "Combo Individual": 39.90,
  "Combo de Frios": 29.90,
  "Combo Premium": 74.90,
  "Combo Primavera": 37.90,
  "Mega Combo Hot Roll": 39.90,
  "Yakisoba de Frango (M)": 18.90,
  "Yakisoba de Frango (G)": 25.90,
  "Yakisoba de Calabresa (M)": 18.90,
  "Yakisoba de Calabresa (G)": 25.90,
  "Yakisoba de Legumes (M)": 16.90,
  "Yakisoba de Legumes (G)": 19.90,
  "Yakisoba de Carne (M)": 21.90,
  "Yakisoba de Carne (G)": 27.90,
  "Yakisoba Misto (M)": 24.90,
  "Yakisoba Misto (G)": 29.90,
};

// 📈 SINCRO DE MARGEM (+15%): Atualiza os preços no back-end automaticamente
for (const key in PRODUCTS) {
  PRODUCTS[key] = Number((PRODUCTS[key] * 1.15).toFixed(2));
}

const PRODUTOS_GRATIS = ["Lula à Dorê (6 unidades)", "Temaki Frito"];

// ========================
// API HANDLER (ESM)
// ========================
export default async function handler(req, res) {
  const allowedOrigins = ["https://sushi-bar-beige.vercel.app"];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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

  const ip = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown")
    .split(",")[0].trim();

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  }

  // ─── POST: CRIAR PEDIDO ───
  if (req.method === "POST") {
    try {
      const order = req.body;

      if (JSON.stringify(order).length > 100000) return res.status(400).json({ error: "Pedido muito grande." });
      if (!order || !order.customer || !order.phone || !order.items || !Array.isArray(order.items)) {
        return res.status(400).json({ error: "Pedido inválido." });
      }
      if (order.items.length > 50) return res.status(400).json({ error: "Pedido excede limite permitido." });

      order.customer   = clean(order.customer);
      order.phone      = clean(order.phone).replace(/\D/g, "");
      order.address    = clean(order.address);
      order.number     = clean(order.number);
      order.complement = clean(order.complement);
      order.payment    = clean(order.payment);

      if (order.phone.length < 10 || order.phone.length > 11) return res.status(400).json({ error: "Telefone inválido." });
      if (order.customer.length > 60) return res.status(400).json({ error: "Nome muito grande." });
      if (order.address.length > 120) return res.status(400).json({ error: "Endereço muito grande." });
      if (order.complement.length > 120) return res.status(400).json({ error: "Complemento muito grande." });

      let total = 0;
      const validatedItems = [];

      for (const item of order.items) {
        const itemName = clean(item.name);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
          return res.status(400).json({ error: "Quantidade inválida." });
        }

        if (item.gratis === true && PRODUTOS_GRATIS.includes(itemName)) {
          validatedItems.push({ name: itemName, quantity, unitPrice: 0, subtotal: 0, gratis: true });
          continue;
        }

        if (!(itemName in PRODUCTS)) return res.status(400).json({ error: `Produto inválido: ${itemName}` });

        const unitPrice = PRODUCTS[itemName];
        const subtotal  = unitPrice * quantity;
        total += subtotal;

        validatedItems.push({ name: itemName, quantity, unitPrice, subtotal });
      }

      // Contador Sequencial
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

      const addons = order.addons || {};
      const hashi = Math.max(0, parseInt(addons.hashi || 0));
      if (hashi > 20) return res.status(400).json({ error: "Quantidade de adicionais inválida." });

      const validPayments = ["Pix", "Cartão", "Dinheiro"];
      if (!validPayments.includes(order.payment)) return res.status(400).json({ error: "Pagamento inválido." });

      const taxaEntrega = Number(order.taxaEntrega) || 0;
      if (taxaEntrega < 0 || taxaEntrega > 50) return res.status(400).json({ error: "Taxa de entrega inválida." });
      total += taxaEntrega;

      if (order.payment === "Cartão") total *= 1.10;
      total = Number(total.toFixed(2));

      const distanciaKm = Number(order.distanciaKm) || 0;

      const newOrder = {
        customer: order.customer,
        phone: order.phone,
        address: order.address,
        number: order.number,
        complement: order.complement,
        payment: order.payment,
        addons: { hashi },
        items: validatedItems,
        taxaEntrega,
        distanciaKm,
        total,
        orderId: nextId,
        createdAt: Date.now(),
        status: "Recebido",
      };

      // ✅ CORREÇÃO: Variável docRef declarada corretamente para não quebrar o update abaixo
      const docRef = await db.collection("orders").add(newOrder);

      // Processar lógica de Clientes VIP
      let isVip = false;
      const promos_aplicadas = [];
      try {
        const cfgSnap = await db.collection('config').doc('settings').get();
        const siteConfig = cfgSnap.exists ? cfgSnap.data() : {};
        const vipResult = await processarVip(db, order.phone, siteConfig);
        
        isVip = vipResult?.isVip || false;
        const promos = siteConfig.promocoes || {};
        const vipBen = siteConfig.vip_beneficios || {};
        const subtotalSemFrete = total - taxaEntrega;

        if (promos.frete_gratis || (isVip && vipBen.frete_gratis)) promos_aplicadas.push('Entrega grátis');
        if (promos.lula_gratis) promos_aplicadas.push('Lula à Dorê grátis');
        if ((promos.temaki_gratis && subtotalSemFrete >= 75) || (isVip && vipBen.temaki_gratis && subtotalSemFrete >= 50)) {
          promos_aplicadas.push('Temaki Frito grátis');
        }

        await db.collection('orders').doc(docRef.id).update({
          isVip,
          promos_aplicadas,
        });
      } catch (vipErr) {
        console.error("Erro ao processar VIP/Promos:", vipErr.message);
      }

      // Notificações via WhatsApp
      try {
        // ✅ CORREÇÃO: Usando 'import()' dinâmico compatível com módulos ES6 (Vercel Node)
        const { enviarMensagem, mensagemNovoPedido, mensagemPix, mensagemMotoboy } = await import("../whatsapp.js");

        await enviarMensagem(newOrder.phone, mensagemNovoPedido(newOrder));

        if (newOrder.payment === "Pix") {
          await enviarMensagem(newOrder.phone, mensagemPix(newOrder));
        }

        let motoboyOn = false;
        try {
          const configSnap = await db.collection("config").doc("settings").get();
          const raw = configSnap.exists ? configSnap.data().motoboy_on : false;
          motoboyOn = raw === true || raw === "true";
        } catch (configErr) {
          console.warn("Erro ao ler config do motoboy:", configErr.message);
        }

        if (motoboyOn && distanciaKm > 3) {
          const motoboyPhone = process.env.MOTOBOY_PHONE;
          if (motoboyPhone) {
            await enviarMensagem(motoboyPhone, mensagemMotoboy(newOrder));
            console.log(`跑 Motoboy avisado (${distanciaKm.toFixed(1)} km)`);
          }
        }
      } catch (waErr) {
        console.error("Erro no módulo do WhatsApp:", waErr.message);
      }

      return res.status(200).json({ success: true, orderId: nextId });
    } catch (error) {
      console.error("Erro ao criar pedido:", error);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }
  }

  // ─── GET: CONSULTAR HISTÓRICO ───
  if (req.method === "GET") {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Telefone não informado." });

    try {
      const snapshot = await db
        .collection("orders")
        .where("phone", "==", phone)
        .orderBy("createdAt", "desc")
        .limit(20)
        .get();

      const orders = [];
      snapshot.forEach((doc) => orders.push({ id: doc.id, ...doc.data() }));
      return res.status(200).json({ orders });
    } catch (error) {
      console.error("Erro ao buscar pedidos:", error);
      return res.status(500).json({ error: "Erro ao buscar pedidos." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}