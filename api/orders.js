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
};

// ========================
// COMBOS ELEGÍVEIS PARA CREAM CHEESE EXTRA NO TEMAKI
// (contêm Temaki Frito). Combos customizados entram dinamicamente
// via campo temakiFrito.
// ========================
const QUALIFYING_COMBOS_TEMAKI_FIXOS = new Set([
  "Combo Apaixonados",
  "Combo Crocantissimo",
  "Combo Individual",
]);

const CREAM_CHEESE_TEMAKI_PRICE = 1.50;

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
  "Bolinho de bacalhau (8 unidades)": 5,

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
  "Combo Osaka": 65,
  "Combo Shangai": 35,
  "Combo Kawaguchi": 40,
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
let customQualifyingCombosTemakiCache = new Set();
let customAddonsByIdCache = {};
let customProductsCacheAt = 0;
const CUSTOM_PRODUCTS_CACHE_MS = 60 * 1000; // 60s

async function getFullProductList(db) {
  const now = Date.now();
  if (customProductsCache && (now - customProductsCacheAt < CUSTOM_PRODUCTS_CACHE_MS)) {
    return {
      products: { ...PRODUCTS, ...customProductsCache },
      qualifyingCombos: new Set([...QUALIFYING_COMBOS_FIXOS, ...customQualifyingCombosCache]),
      qualifyingCombosTemaki: new Set([...QUALIFYING_COMBOS_TEMAKI_FIXOS, ...customQualifyingCombosTemakiCache]),
      customAddonsById: customAddonsByIdCache,
    };
  }

  try {
    const snap = await db.collection("custom_products").get();
    const custom = {};
    const qualifying = new Set();
    const qualifyingTemaki = new Set();
    const addonsById = {};
    snap.forEach(doc => {
      const data = doc.data();
      if (data && data.name && Number.isFinite(data.price)) {
        custom[data.name] = data.price;
        if (data.type === "combo" && data.hotHossoMin8 === true) {
          qualifying.add(data.name);
        }
        if (data.type === "combo" && data.temakiFrito === true) {
          qualifyingTemaki.add(data.name);
        }
        if (data.type === "adicional") {
          addonsById[doc.id] = { name: data.name, price: data.price };
        }
      }
    });
    customProductsCache = custom;
    customQualifyingCombosCache = qualifying;
    customQualifyingCombosTemakiCache = qualifyingTemaki;
    customAddonsByIdCache = addonsById;
    customProductsCacheAt = now;
    return {
      products: { ...PRODUCTS, ...custom },
      qualifyingCombos: new Set([...QUALIFYING_COMBOS_FIXOS, ...qualifying]),
      qualifyingCombosTemaki: new Set([...QUALIFYING_COMBOS_TEMAKI_FIXOS, ...qualifyingTemaki]),
      customAddonsById: addonsById,
    };
  } catch (e) {
    console.warn("Erro ao buscar produtos customizados, usando apenas os fixos:", e.message);
    return {
      products: { ...PRODUCTS },
      qualifyingCombos: new Set(QUALIFYING_COMBOS_FIXOS),
      qualifyingCombosTemaki: new Set(QUALIFYING_COMBOS_TEMAKI_FIXOS),
      customAddonsById: {},
    };
  }
}

// ========================
// CONFIGURAÇÃO DO POKE PERSONALIZADO (cadastrada pelo admin em admin.html)
// Cache em memória para não estourar o limite de leitura do Firestore
// ========================

// Mesmo fallback usado em api/poke.js — garante que o Poke funcione com os
// ingredientes padrão mesmo antes do admin salvar qualquer configuração.
const DEFAULT_POKE_CONFIG = {
  basePrice: 32.9,
  saladaQtd: 2,
  avisos: [],
  groups: {
    arroz: [
      { id: "arroz-japones", name: "Arroz Japonês", description: "", price: 0, available: true },
      { id: "arroz-brasileiro", name: "Arroz Brasileiro", description: "", price: 0, available: true },
    ],
    proteina: [
      { id: "salmao-cru", name: "Salmão Cru", description: "", price: 0, available: true },
      { id: "salmao-grelhado", name: "Salmão Grelhado", description: "", price: 0, available: true },
      { id: "salmao-cru-cream-cheese", name: "Salmão Cru com Cream Cheese", description: "", price: 0, available: true },
      { id: "salmao-grelhado-cream-cheese", name: "Salmão Grelhado com Cream Cheese", description: "", price: 0, available: true },
    ],
    salada: [
      { id: "cenoura", name: "Cenoura", description: "", price: 0, available: true },
      { id: "repolho", name: "Repolho", description: "", price: 0, available: true },
      { id: "couve-crispy", name: "Couve Crispy", description: "", price: 0, available: true },
    ],
    crocante: [
      { id: "tempura", name: "Tempurá", description: "", price: 0, available: true },
      { id: "chips-batata", name: "Chips de Batata", description: "", price: 0, available: true },
      { id: "chips-batata-doce", name: "Chips de Batata Doce", description: "", price: 0, available: true },
      { id: "couve-frita", name: "Couve Frita", description: "", price: 0, available: true },
      { id: "brocoli-frito", name: "Brócoli Frito", description: "", price: 0, available: true },
    ],
  },
};

let pokeConfigCache = null;
let pokeConfigCacheAt = 0;
const POKE_CONFIG_CACHE_MS = 60 * 1000; // 60s

async function getPokeConfig(db) {
  const now = Date.now();
  if (pokeConfigCache && (now - pokeConfigCacheAt < POKE_CONFIG_CACHE_MS)) {
    return pokeConfigCache;
  }
  try {
    const snap = await db.collection("poke_config").doc("settings").get();
    // Documento ainda não existe (admin nunca salvou) → usa o padrão em vez
    // de bloquear o pedido.
    const config = snap.exists ? snap.data() : DEFAULT_POKE_CONFIG;
    pokeConfigCache = config;
    pokeConfigCacheAt = now;
    return config;
  } catch (e) {
    console.warn("Erro ao buscar configuração do Poke:", e.message);
    return pokeConfigCache || DEFAULT_POKE_CONFIG; // usa o último valor conhecido, ou o padrão
  }
}

// Valida e resolve um item de Poke enviado pelo cliente, usando SEMPRE os
// nomes/preços/disponibilidade cadastrados no Firestore (nunca os do cliente).
function resolvePokeItem(item, pokeConfig) {
  if (!pokeConfig) {
    throw new Error("Poke Personalizado indisponível no momento.");
  }

  const quantity = Number(item.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw new Error("Quantidade inválida para o Poke.");
  }

  const choices = item.pokeChoices || {};
  const saladaQtd = Number(pokeConfig.saladaQtd) || 2;

  function resolveOne(groupKey, id) {
    const group = (pokeConfig.groups && pokeConfig.groups[groupKey]) || [];
    const found = group.find(opt => opt.id === id);
    if (!found) throw new Error(`Ingrediente inválido no grupo "${groupKey}".`);
    if (found.available === false) throw new Error(`"${found.name}" está indisponível no momento.`);
    return { id: found.id, name: found.name, price: Number(found.price) || 0 };
  }

  const arroz = resolveOne("arroz", clean(choices.arroz));
  const proteina = resolveOne("proteina", clean(choices.proteina));
  const crocante = resolveOne("crocante", clean(choices.crocante));

  const saladaIds = Array.isArray(choices.salada) ? choices.salada.map(clean).filter(Boolean) : [];
  if (saladaIds.length !== saladaQtd) {
    throw new Error(`Escolha exatamente ${saladaQtd} opções de salada.`);
  }
  if (new Set(saladaIds).size !== saladaIds.length) {
    throw new Error("Opções de salada repetidas.");
  }
  const salada = saladaIds.map(id => resolveOne("salada", id));

  const basePrice = Number(pokeConfig.basePrice) || 0;
  const unitPrice = Number((
    basePrice + arroz.price + proteina.price + crocante.price +
    salada.reduce((s, o) => s + o.price, 0)
  ).toFixed(2));

  const subtotal = Number((unitPrice * quantity).toFixed(2));

  return {
    name: "Poke Personalizado",
    quantity,
    unitPrice,
    subtotal,
    isPoke: true,
    pokeDetails: { arroz, proteina, salada, crocante },
  };
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

      // ========================
      // DESCONTO DE PRIMEIRO PEDIDO (10%)
      // Cliente é considerado "novo" se não existir NENHUM pedido
      // anterior salvo com esse telefone.
      // ========================
      let isNovoCliente = false;
      try {
        const pedidosAnteriores = await db
          .collection("orders")
          .where("phone", "==", order.phone)
          .limit(1)
          .get();
        isNovoCliente = pedidosAnteriores.empty;
      } catch (e) {
        console.warn("Erro ao verificar histórico de pedidos do telefone:", e.message);
        isNovoCliente = false; // em caso de falha, não concede o desconto por segurança
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
      const { products: ALL_PRODUCTS, qualifyingCombos, qualifyingCombosTemaki, customAddonsById } = await getFullProductList(db);
      let total = 0;
      const validatedItems = [];
      let pokeConfigLoaded = null;

      for (const item of order.items) {
        // ── Poke Personalizado: item montado pelo cliente (arroz, proteína,
        // salada e crocante). Preço e disponibilidade são sempre resolvidos
        // no servidor a partir do Firestore, nunca confiando no cliente.
        if (item && item.isPoke === true) {
          if (pokeConfigLoaded === null) {
            pokeConfigLoaded = await getPokeConfig(db);
          }
          try {
            const resolved = resolvePokeItem(item, pokeConfigLoaded);
            total += resolved.subtotal;
            validatedItems.push(resolved);
          } catch (pokeErr) {
            return res.status(400).json({ error: pokeErr.message });
          }
          continue;
        }

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

      // Verifica se há Temaki Frito avulso ou combo elegível (contém Temaki Frito) no pedido
      const temTemakiFritoNoPedido = validatedItems.some(item =>
        item.name.includes("Temaki Frito") ||
        qualifyingCombosTemaki.has(item.name)
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
      const creamCheeseTemaki = Math.max(0, parseInt(addons.creamCheeseTemaki || 0));

      if (
        hashi > 20 || geleia > 20 || amendoim > 20 || talheres > 20 ||
        creamCheeseExtra > 20 || creamCheeseCrocante > 20 ||
        creamCheeseCouve > 20 || creamCheeseGeleiaPimenta > 20 ||
        creamCheeseTemaki > 20
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

      if (creamCheeseTemaki > 0 && !temTemakiFritoNoPedido) {
        return res.status(400).json({ error: "O cream cheese extra no temaki é exclusivo para pedidos com Temaki Frito ou combos que o contenham." });
      }

      // ========================
      // ADICIONAIS CUSTOMIZADOS (cadastrados pelo admin, type "adicional")
      // Chegam dentro de order.addons com a chave "custom_<id do Firestore>".
      // Nome e preço nunca são confiados do cliente — sempre lidos do banco.
      // ========================
      const customAddonsResolved = [];
      for (const [key, rawQty] of Object.entries(addons)) {
        if (!key.startsWith("custom_")) continue;

        const qty = Math.max(0, parseInt(rawQty || 0));
        if (qty <= 0) continue;
        if (qty > 20) {
          return res.status(400).json({ error: "Quantidade de adicionais inválida." });
        }

        const id = key.slice("custom_".length);
        const info = customAddonsById[id];
        if (!info) {
          return res.status(400).json({ error: "Um dos adicionais selecionados não está mais disponível." });
        }

        const unitPrice = Number(info.price) || 0;
        const subtotal = Number((unitPrice * qty).toFixed(2));
        total += subtotal;
        customAddonsResolved.push({ id, name: info.name, unitPrice, quantity: qty, subtotal });
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
      total += creamCheeseTemaki * CREAM_CHEESE_TEMAKI_PRICE;
      total += taxaEntrega;

      if (isNovoCliente) total *= 0.90;
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
          creamCheeseExtra, creamCheeseCrocante, creamCheeseCouve, creamCheeseGeleiaPimenta,
          creamCheeseTemaki,
        },
        customAddons: customAddonsResolved,
        items:       validatedItems,
        taxaEntrega,
        distanciaKm,
        total,
        descontoPrimeiroPedido: isNovoCliente,
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

      return res.status(200).json({ success: true, orderId: nextId, descontoPrimeiroPedido: isNovoCliente });

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