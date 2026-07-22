const { initializeApp, getApps, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// ========================
// RATE LIMIT
// ========================
const rateLimit = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 1 * 60 * 1000;
  const maxRequests = 30;

  if (!rateLimit.has(ip)) rateLimit.set(ip, []);

  const requests = rateLimit
    .get(ip)
    .filter(time => now - time < windowMs);

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
// FIREBASE
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
// COMBOS ELEGÍVEIS PARA CREAM CHEESE EXTRA
// (8+ peças de Hot Roll/Hossomaki). Combos customizados cadastrados
// pelo admin entram nessa lista dinamicamente via campo hotHossoMin8.
// ========================
const QUALIFYING_COMBOS_FIXOS = new Set([
  "Mega Combo Hot Roll",
  "Combo Crocantissimo",
  "Combo Individual",
  "Combo de Frios",
  "Combo Premium",
]);

const CREAM_CHEESE_ADDON_PRICES = {
  creamCheeseExtra: 1.00,
  creamCheeseCrocante: 1.50,
  creamCheeseCouve: 1.50,
  creamCheeseGeleiaPimenta: 1.50,
  creamCheeseTemakiExtra: 2.00,
};

// ========================
// PRODUTOS (ATUALIZADO COM OS NOVOS TAMANHOS)
// ========================
const PRODUCTS = {
  // ── Hots ──
  "Hot Roll Philadelphia Salmão (8 unidades)": 16,
  "Hot Roll Skin (8 unidades)": 8,
  "Hot Roll Kani (8 unidades)": 10.50,
  "Temaki Frito": 24,
  "Temaki": 20, // ← NOVO
  "Bolinho de Salmão (4 unidades)": 12,

  // ── Hossomaki ──
  "Hossomaki Philadelphia Salmão (8 unidades)": 14,
  "Hossomaki Skin (8 unidades)": 6.50,
  "Hossomaki Kani (8 unidades)": 8,

  // ── Sashimi / Joe ──
  "Sashimi de Salmão (4 unidades)": 12,   // ← NOVO
 

  // ── Harumaki ──
  "Harumaki de Legumes (3 unidades)": 13,
  "Harumaki de Salmão (3 unidades)": 19,
  "Harumaki de queijo (3 unidades)": 13,
  "Harumaki de Frango com Cream Cheese (3 unidades)": 13,
  "Harumaki de Doce de leite (3 unidades)": 13, // ← NOVO

  // ── Porções ──
  "Lula à Dorê (6 unidades)": 26,
  "Shimeji na Manteiga": 15,

  // ── Saladas ──
  "Salada Sunomono": 5,

  // ── Yakisoba ──
   "Frango Xadrez": 25, // ← NOVO
  "Yakisoba de Frango (M)": 25,
  "Yakisoba de Frango (G)": 30,
  "Yakisoba de Calabresa (M)": 19,
  "Yakisoba de Calabresa (G)": 27,
  "Yakisoba de Legumes (M)": 17,
  "Yakisoba de Legumes (G)": 25,  
  "Yakisoba de Carne (M)": 28,
  "Yakisoba de Carne (G)": 35,
  "Yakisoba Misto (M)": 25,
  "Yakisoba Misto (G)": 35,

  // ── Combos ──
  "Mega Combo Hot Roll": 40,
  "Combo Apaixonados": 60,
  "Combo Crocantissimo": 50,
  "Combo Individual": 40,
  "Combo de Frios": 30,
  "Combo Premium": 75,
  "Combo Primavera": 38,
  "Combo Salmão Lovers": 50,       
};

// ========================
// PRODUTOS CUSTOMIZADOS (cadastrados pelo admin)
// Cache em memória para não estourar o limite de leitura do Firestore
// ========================
let customProductsCache = null;
let customQualifyingCombosCache = new Set();
let customProductsCacheAt = 0;
const CUSTOM_PRODUCTS_CACHE_MS = 60 * 1000; // 60s

async function getFullProductList(db) {
  const now = Date.now();
  if (customProductsCache && (now - customProductsCacheAt < CUSTOM_PRODUCTS_CACHE_MS)) {
    return {
      products: { ...PRODUCTS, ...customProductsCache },
      qualifyingCombos: new Set([...QUALIFYING_COMBOS_FIXOS, ...customQualifyingCombosCache]),
    };
  }

  try {
    const snap = await db.collection("custom_products").get();
    const custom = {};
    const qualifying = new Set();
    snap.forEach(doc => {
      const data = doc.data();
      if (data && data.name && Number.isFinite(data.price)) {
        custom[data.name] = data.price;
        if (data.type === "combo" && data.hotHossoMin8 === true) {
          qualifying.add(data.name);
        }
      }
    });
    customProductsCache = custom;
    customQualifyingCombosCache = qualifying;
    customProductsCacheAt = now;
    return {
      products: { ...PRODUCTS, ...custom },
      qualifyingCombos: new Set([...QUALIFYING_COMBOS_FIXOS, ...qualifying]),
    };
  } catch (e) {
    console.warn("Erro ao buscar produtos customizados, usando apenas os fixos:", e.message);
    return {
      products: { ...PRODUCTS },
      qualifyingCombos: new Set(QUALIFYING_COMBOS_FIXOS),
    };
  }
}

// ========================
// API HANDLER
// ========================
export default async function handler(req, res) {
  const allowedOrigins = [
    "https://sushi-bar-beige.vercel.app",
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  // Inicializa Firebase
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

  // Rate Limit
  const ip = (
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  ).split(",")[0].trim();

  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." });
  }

  // ========================
  // PROCESSAR NOVO PEDIDO (POST)
  // ========================
  if (req.method === "POST") {
    try {
      const order = req.body;

      if (JSON.stringify(order).length > 100000) {
        return res.status(400).json({ error: "Pedido muito grande." });
      }

      if (!order || !order.customer || !order.phone || !order.items || !Array.isArray(order.items)) {
        return res.status(400).json({ error: "Pedido inválido." });
      }

      if (order.items.length > 50) {
        return res.status(400).json({ error: "Pedido excede limite permitido." });
      }

      order.customer   = clean(order.customer);
      order.phone      = clean(order.phone).replace(/\D/g, "");
      order.address    = clean(order.address);
      order.number     = clean(order.number);
      order.complement = clean(order.complement);
      order.payment    = clean(order.payment);

      if (order.phone.length < 10 || order.phone.length > 11) {
        return res.status(400).json({ error: "Telefone inválido." });
      }

      if (order.customer.length > 60) {
        return res.status(400).json({ error: "Nome muito grande." });
      }

      if (order.address.length > 120) {
        return res.status(400).json({ error: "Endereço muito grande." });
      }

      if (order.complement.length > 120) {
        return res.status(400).json({ error: "Complemento muito grande." });
      }

      // Recalcula Total
      const { products: ALL_PRODUCTS, qualifyingCombos } = await getFullProductList(db);
      let total = 0;
      const validatedItems = [];

      for (const item of order.items) {
        const itemName = clean(item.name);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
          return res.status(400).json({ error: "Quantidade inválida." });
        }

        if (!(itemName in ALL_PRODUCTS)) {
          return res.status(400).json({ error: `Produto inválido: ${itemName}` });
        }

        const unitPrice = ALL_PRODUCTS[itemName];
        const subtotal  = unitPrice * quantity;
        total += subtotal;

        validatedItems.push({ name: itemName, quantity, unitPrice, subtotal });
      }

      // Verifica se há algum Yakisoba de fato no pedido validado
      const temYakisobaNoPedido = validatedItems.some(item => 
        item.name.toLowerCase().includes("yakisoba")
      );

      // Verifica se há Hot Roll/Hossomaki avulso ou combo elegível (8+ peças) no pedido
      const temHotRollOuHossomakiNoPedido = validatedItems.some(item =>
        item.name.includes("Hot Roll") ||
        item.name.includes("Hossomaki") ||
        qualifyingCombos.has(item.name)
      );

      // Transação do ID sequencial
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

      // Adicionais e Taxas
      const addons = order.addons || {};
      const hashi = Math.max(0, parseInt(addons.hashi || 0));
      const geleia = Math.max(0, parseInt(addons.geleia || 0));
      const pimenta = Math.max(0, parseInt(addons.pimenta || 0));
      const amendoim = Math.max(0, parseInt(addons.amendoim || 0));
      const talheres = Math.max(0, parseInt(addons.talheres || 0));
      const creamCheeseExtra = Math.max(0, parseInt(addons.creamCheeseExtra || 0));
      const creamCheeseCrocante = Math.max(0, parseInt(addons.creamCheeseCrocante || 0));
      const creamCheeseCouve = Math.max(0, parseInt(addons.creamCheeseCouve || 0));
      const creamCheeseGeleiaPimenta = Math.max(0, parseInt(addons.creamCheeseGeleiaPimenta || 0));
      const creamCheeseTemakiExtra = Math.max(0, parseInt(addons.creamCheeseTemakiExtra || 0));

      if (
        hashi > 20 || geleia > 20 || amendoim > 20 || talheres > 20 ||
        creamCheeseExtra > 20 || creamCheeseCrocante > 20 ||
        creamCheeseCouve > 20 || creamCheeseGeleiaPimenta > 20 || creamCheeseTemakiExtra > 20
      ) {
        return res.status(400).json({ error: "Quantidade de adicionais inválida." });
      }

      if (pimenta > 0 && !temYakisobaNoPedido) {
        return res.status(400).json({ error: "A pimenta de Sichuan é exclusiva para pedidos com Yakisoba." });
      }

      const totalCreamCheeseExtras = creamCheeseExtra + creamCheeseCrocante + creamCheeseCouve + creamCheeseGeleiaPimenta;
      if (totalCreamCheeseExtras > 0 && !temHotRollOuHossomakiNoPedido) {
        return res.status(400).json({ error: "Os adicionais de cream cheese extra são exclusivos para pedidos com Hot Roll, Hossomaki ou combos com 8 ou mais dessas peças." });
      }

      const validPayments = ["Pix", "Cartão", "Dinheiro"];
      if (!validPayments.includes(order.payment)) {
        return res.status(400).json({ error: "Pagamento inválido." });
      }

      const taxaEntrega = Number(order.taxaEntrega) || 0;
      if (taxaEntrega < 0 || taxaEntrega > 50) {
        return res.status(400).json({ error: "Taxa de entrega inválida." });
      }
      total += geleia * 1.00;
      total += creamCheeseExtra * CREAM_CHEESE_ADDON_PRICES.creamCheeseExtra;
      total += creamCheeseCrocante * CREAM_CHEESE_ADDON_PRICES.creamCheeseCrocante;
      total += creamCheeseCouve * CREAM_CHEESE_ADDON_PRICES.creamCheeseCouve;
      total += creamCheeseGeleiaPimenta * CREAM_CHEESE_ADDON_PRICES.creamCheeseGeleiaPimenta;
      total += taxaEntrega;

      if (order.payment === "Cartão") total *= 1.10;
      total = Number(total.toFixed(2));

      const distanciaKm = Number(order.distanciaKm) || 0;

      const newOrder = {
        customer:    order.customer,
        phone:       order.phone,
        address:     order.address,
        number:      order.number,
        complement:  order.complement,
        payment:     order.payment,
        addons:      {
          hashi, pimenta, geleia, amendoim, talheres,
          creamCheeseExtra, creamCheeseCrocante, creamCheeseCouve, creamCheeseGeleiaPimenta, creamCheeseTemakiExtra,
        },
        items:       validatedItems,
        taxaEntrega,
        distanciaKm,
        total,
        orderId:     nextId,
        createdAt:   Date.now(),
        status:      "Recebido",
      };

      // Salva no banco de dados
      await db.collection("orders").add(newOrder);

      // ====================================================
      // DISPAROS DE WHATSAPP (EXCLUSIVO DAQUI)
      // ====================================================
      try {
        const {
                enviarMensagem,
                mensagemNovoPedido,
                mensagemPix,
                mensagemCodigoPix,
                mensagemMotoboy,
              } = require("../whatsapp");

              // 1. Mensagem de confirmação para o Cliente
              await enviarMensagem(newOrder.phone, mensagemNovoPedido(newOrder));

              // 2. Se for PIX, envia mensagem explicativa + chave isolada
              if (newOrder.payment === "Pix") {
                await enviarMensagem(newOrder.phone, mensagemPix(newOrder));
                await enviarMensagem(newOrder.phone, mensagemCodigoPix(newOrder));
              }

        // 3. Verificação e Envio para o Motoboy
        let motoboyOn = false;
        try {
          const configSnap = await db.collection("config").doc("settings").get();
          const raw = configSnap.exists ? configSnap.data().motoboy_on : false;
          motoboyOn = raw === true || raw === "true";
        } catch (configErr) {
          console.warn("Erro ao ler configuração do motoboy:", configErr.message);
        }

        // Condições: Painel ativo E distância maior que 3km
        if (motoboyOn && distanciaKm > 3) {
          const motoboyPhone = process.env.MOTOBOY_PHONE;
          if (motoboyPhone) {
            await enviarMensagem(motoboyPhone, mensagemMotoboy(newOrder));
            console.log(`🛵 Motoboy avisado via WhatsApp (${distanciaKm.toFixed(1)} km)`);
          } else {
            console.warn("MOTOBOY_PHONE não configurado no arquivo .env");
          }
        } else {
          console.log(`ℹ️ Motoboy não notificado | Ativo: ${motoboyOn} | Distância: ${distanciaKm.toFixed(1)} km`);
        }

      } catch (waErr) {
        console.error("Erro na rotina de disparos do WhatsApp:", waErr.message);
      }

      return res.status(200).json({ success: true, orderId: nextId });

    } catch (error) {
      console.error("Erro ao criar pedido:", error);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }
  }

  // ========================
  // CONSULTAR PEDIDOS (GET)
  // ========================
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
      snapshot.forEach((doc) => {
        orders.push({ id: doc.id, ...doc.data() });
      });

      return res.status(200).json({ orders });
    } catch (error) {
      console.error("Erro ao buscar pedidos:", error);
      return res.status(500).json({ error: "Erro ao buscar pedidos." });
    }
  }

  return res.status(405).json({ error: "Método não permitido." });
}