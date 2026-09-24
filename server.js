require("dotenv").config();
const admin = require("firebase-admin");
const { execSync } = require("child_process");
const { writeFileSync, unlinkSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");

// ========================
// FIREBASE
// ========================

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

const db = admin.firestore();

// ========================
// CONFIGURAÇÃO DA IMPRESSORA (Kapbom KA-1445)
// ========================
// Bluetooth-first, USB-fallback:
// 1) Tenta imprimir via porta COM virtual criada pelo pareamento Bluetooth
// 2) Se falhar (porta instável, impressora desligada, não pareada, etc.),
//    cai para a fila de compartilhamento USB local (\\localhost\POS58)
//
// Ajuste essas variáveis de ambiente conforme a máquina onde o bot roda:
//   PRINTER_BT_COM     -> ex: "COM5"  (porta COM do Bluetooth pareado)
//   PRINTER_BT_BAUD    -> ex: "9600"  (baud rate da impressora)
//   PRINTER_USB_SHARE  -> ex: "\\localhost\\POS58 10.0.0.6" (share USB, fallback)
//   PRINTER_BT_RETRIES -> nº de tentativas na porta COM antes do fallback (default 2)
//   DEBUG_PRINT        -> "true" para só logar no console sem imprimir de fato

const PRINTER_BT_COM     = process.env.PRINTER_BT_COM || "";
const PRINTER_BT_BAUD    = process.env.PRINTER_BT_BAUD || "9600";
const PRINTER_USB_SHARE  = process.env.PRINTER_USB_SHARE || "\\\\localhost\\POS58";
const PRINTER_BT_RETRIES = parseInt(process.env.PRINTER_BT_RETRIES || "2", 10);

// ========================
// LOGO (GS v 0 — raster inline)
// ========================

const LOGO_BASE64 = "HXYwABkANwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gAAD+AAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAB/wAAAAAAAAAAAAAAAAAAAAAAAAAAP/wAA/+AAAAAAAAAAAAAAAAAAAAAAAAAAH/8//f/wAAAAAAAAAAAAAAAAAAAAAAAAAB//////8AAAAAAAAAAAAAAAAAAAAAAAAAAf/8AD//AAAAAAAAAAAAAAAAAAAAAAAAAAH+4AAP/wAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAA/8AAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAH/AAAAeAAAAAAAAABAAAeAAAAAAAD+AAAA/z4PgHwB8P/8A/wD/+APgAAAAAAA/AAAAH4eH4D8AfD+eA/+A//wD8AAAAAAAHgAAAA8Ph4A/gHw4PgcHwPg8A/AAAAAAAAwAAAAHB48Af4A8AHwPA+D4Hgf4AAAAAAAYBwAeAweeAH+APAB4DgHg+D4H+AAAAAAAGB+APwGHnABzwDwA8B4B8PA8B3gAAAAAADA/wD+Bh7gAc8A8AfAeAPDwPA48AAAAAAAwf8A/wMf8AOHgPAHgHgD48HgOPAAAAAAAMH/AO+DH/ADh4DwDwB4A+PHwDB4AAAAAAGD5wDvgx/4BweA8A8AeAPh7wBweAAAAAABg/4A/4MeeAcDwPAeAHgD4f8AYDwAAAAAAYP+AH+BHjwH+8DwPAB4A8HPgP88AAAAAAGD/Dh/gR4cD//A8DgAfAPBx4D//AAAAAABgfh8P4EcDg/B4PB4ADwDgcHA/B4AAAAAAYDwfg4DHAcMAODw8AA+A4HAwYAeAAAAAAGAADwAAxwDGADw8PAAHwcBwGGADwAAAAAAwAAYAAMcAZAAcPD//A/uAcAxAA8AAAAAAMABGQAGHACAAHjw//AH/AHAEgAHAAAAAABgAf8ADhwAQAA44PwAAPABwAAABwAAAAAAMABAABwAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8/+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB///";

// ========================
// COMANDOS ESC/POS
// ========================

const ESC = "\x1B";
const GS  = "\x1D";

const INIT      = ESC + "@";
const BOLD_ON   = ESC + "E\x01";
const BOLD_OFF  = ESC + "E\x00";
const ALIGN_CTR = ESC + "a\x01";
const ALIGN_LEFT= ESC + "a\x00";
const FONT_A    = ESC + "M\x00";
const LF        = "\n";
const CUT       = GS  + "V\x41\x03";

const COLS = 32;
const DIV  = "-".repeat(COLS);

const ADDON_INFO_FIXOS = {
  hashi:                    { name: "Hashi (adaptador)", price: 0 },
  talheres:                 { name: "Talheres",           price: 0 },
  amendoim:                 { name: "Amendoim",           price: 0 },
  pimenta:                  { name: "Pimenta Sichuan",    price: 0 },
  geleia:                   { name: "Geleia de Pimenta",  price: 1.00 },
  creamCheeseExtra:         { name: "CC extra x8",        price: 1.00 },
  creamCheeseCrocante:      { name: "CC crocante x8",     price: 1.50 },
  creamCheeseCouve:         { name: "CC couve frita x8",  price: 1.50 },
  creamCheeseGeleiaPimenta: { name: "CC geleia pimenta",  price: 1.50 },
  creamCheeseTemaki:        { name: "CC extra temaki",    price: 2.00 },
};

const NOME_CURTO = {
  "Hot Roll Philadelphia Salmão (8 unidades)": "Hot Phil. Salmão x8",
  "Hot Roll de Camarão (8 unidades)"         : "Hot Camarao x8",
  "Hot Roll Camarão (8 unidades)"            : "Hot Camarao x8",
  "Haru hot Philadelphia Salmão (8 unidades)": "Haru Phil. Salmão x8",
  "Hot Roll Skin (8 unidades)"               : "Hot Roll Skin x8",
  "Hossomaki Skin (8 unidades)"              : "Hossomaki Skin x8",
  "Hot Roll Kani (8 unidades)"               : "Hot Roll Kani x8",
  "Hossomaki Kani (8 unidades)"              : "Hossomaki Kani x8",
  "Bolinho de bacalhau (8 unidades)"         : "Bolinho Bacalhau x8",
  "Harumaki de Legumes (3 unidades)"         : "Harumaki Legumes x3",
  "Harumaki de Salmão (3 unidades)"          : "Harumaki Salmão x3",
  "Harumaki de queijo (3 unidades)"          : "Harumaki Queijo x3",
  "Harumaki de Frango com Cream Cheese (3 unidades)": "Harumaki Frango x3",
  "Harumaki de Doce de leite (3 unidades)"   : "Harumaki Doce x3",
  "Sashimi de Salmão (4 unidades)"           : "Sashimi Salmão x4",
  "Croquete de Camarão (4 unidades)"         : "Croquete Camarão x4",
  "Yakisoba de Calabresa"                    : "Yaki Calabresa",
  "Yakisoba de Camarão"                      : "Yaki Camarao",
  "Yakisoba Camarão"                         : "Yaki Camarao",
  "Adaptador de hashi"                       : "Hashi (adaptador)",
  "Cream cheese extra (8 unidades)"          : "CC extra x8",
  "Cream cheese extra com crocante (8 unidades)": "CC crocante x8",
  "Cream cheese extra com couve frita (8 unidades)": "CC couve frita x8",
  "Cream cheese extra com geleia de pimenta (8 unidades)": "CC geleia pimenta",
  "Cream cheese extra no temaki"             : "CC extra temaki",
};

const COMBO_COMPOSICAO = {
  "Combo Osaka"     : "1 Temaki Frito Salmao\n16 Hot Roll Phil.\n8 Hot Skin\n1 Refrig. Lata",
  "Combo Shanghai"  : "1 Yakisoba M\n8 Hot Kani\n1 Guaravita",
  "Combo Kawaguchi" : "8 Hot Salmao\n8 Hot Kani\n16 Bolinho Bacalhau\n2 Refrig. Lata",
};

function nomeCurto(nome) {
  return NOME_CURTO[nome] || nome;
}

function trunc(str, maxLen) {
  return String(str || "").slice(0, maxLen);
}

function rowLR(left, right) {
  const r = String(right);
  const l = trunc(String(left), COLS - r.length - 1);
  const pad = COLS - l.length - r.length;
  return l + " ".repeat(Math.max(pad, 1)) + r + LF;
}

function center(str) {
  const s = trunc(String(str), COLS);
  const pad = Math.max(0, Math.floor((COLS - s.length) / 2));
  return " ".repeat(pad) + s + LF;
}

function moeda(valor) {
  return "R$" + Number(valor).toFixed(2).replace(".", ",");
}

function formatarPedido(order) {
  // Parte de texto antes do logo
  let header = INIT + FONT_A + ALIGN_CTR;

  let body = "";
  body += BOLD_ON + center("KAIZORA SUSHI") + BOLD_OFF;
  body += center("Pedido #" + order.orderId);
  body += center(new Date(order.createdAt).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  }));
  body += ALIGN_LEFT + DIV + LF;

  body += BOLD_ON + "CLIENTE" + LF + BOLD_OFF;
  body += trunc(order.customer, COLS) + LF;
  body += trunc("Tel: " + order.phone, COLS) + LF;
  body += trunc(order.address + ", " + order.number, COLS) + LF;
  if (order.complement) body += trunc(order.complement, COLS) + LF;
  body += DIV + LF;

  body += BOLD_ON + "ITENS" + LF + BOLD_OFF;
  for (const item of order.items) {
    const subtotal = moeda(item.unitPrice * item.quantity);
    const prefixo  = item.quantity + "x ";
    const nome     = nomeCurto(item.name);
    const nomeMax  = COLS - prefixo.length - subtotal.length - 1;
    body += rowLR(prefixo + trunc(nome, nomeMax), subtotal);
    const comp = COMBO_COMPOSICAO[item.name];
    if (comp) {
      body += `  Total p/ ${item.quantity}x:` + LF;
      comp.split("\n").forEach(l => {
        const match = l.match(/^(\d+)\s+(.+)/);
        if (match) {
          body += `   ${parseInt(match[1]) * item.quantity}x ${match[2]}` + LF;
        } else {
          body += `   ${item.quantity}x ${l}` + LF;
        }
      });
    }
  }
  body += DIV + LF;

  const addonsList = [];

  // 1. Adicionais fixos / legados (salvos em order.addons como camelCase pelo orders.js)
  for (const [key, qty] of Object.entries(order.addons || {})) {
    if (qty > 0) {
      const info = ADDON_INFO_FIXOS[key] || { name: key, price: 0 };
      addonsList.push({
        name: nomeCurto(info.name),
        qty,
        price: info.price,
      });
    }
  }

  // 2. Adicionais customizados criados pelo admin (salvos em order.customAddons pelo orders.js)
  if (Array.isArray(order.customAddons)) {
    for (const ca of order.customAddons) {
      if (ca.quantity > 0) {
        addonsList.push({
          name: nomeCurto(ca.name),
          qty: ca.quantity,
          price: Number(ca.unitPrice) || 0,
        });
      }
    }
  }

  if (addonsList.length > 0) {
    body += BOLD_ON + "ADICIONAIS" + LF + BOLD_OFF;
    for (const adic of addonsList) {
      const subtotal = adic.price > 0 ? moeda(adic.price * adic.qty) : "Gratis";
      const prefixo  = adic.qty + "x ";
      const nomeMax  = COLS - prefixo.length - subtotal.length - 1;
      body += rowLR(prefixo + trunc(adic.name, nomeMax), subtotal);
    }
    body += DIV + LF;
  }

  body += rowLR("Taxa de entrega:", moeda(order.taxaEntrega));
  body += BOLD_ON + rowLR("TOTAL:", moeda(order.total)) + BOLD_OFF;
  body += rowLR("Pagamento:", order.payment);
  body += DIV + LF;

  body += ALIGN_CTR + center("Obrigado pela preferencia!");
  body += LF + CUT;

  // Monta Buffer completo: header + logo + body
  const logoBuf  = Buffer.from(LOGO_BASE64, "base64");
  const headerBuf = Buffer.from(header, "binary");
  const bodyBuf   = Buffer.from(body, "binary");

  return Buffer.concat([headerBuf, logoBuf, bodyBuf]);
}

// ========================
// IMPRESSÃO — Bluetooth-first, USB-fallback
// ========================

function escreverArquivoTemp(conteudo, orderId) {
  const tmpFile = join(tmpdir(), `pedido_${orderId}.bin`);
  writeFileSync(tmpFile, conteudo);
  return tmpFile;
}

function tentarImprimirBluetooth(tmpFile) {
  if (!PRINTER_BT_COM) {
    throw new Error("PRINTER_BT_COM não configurada — pulando tentativa Bluetooth");
  }

  let ultimoErro;
  for (let tentativa = 1; tentativa <= PRINTER_BT_RETRIES; tentativa++) {
    try {
      // Configura a porta COM virtual (Bluetooth SPP) antes de escrever nela.
      // Portas Bluetooth costumam "cair" após ociosidade — reconfigurar a
      // cada tentativa ajuda a recuperar de instabilidade da porta.
      execSync(
        `mode ${PRINTER_BT_COM}: baud=${PRINTER_BT_BAUD} parity=n data=8 stop=1`,
        { shell: "cmd.exe" }
      );
      execSync(`copy /b "${tmpFile}" "${PRINTER_BT_COM}"`, { shell: "cmd.exe" });
      return; // sucesso
    } catch (err) {
      ultimoErro = err;
      console.warn(
        `⚠️  Tentativa ${tentativa}/${PRINTER_BT_RETRIES} via Bluetooth (${PRINTER_BT_COM}) falhou: ${err.message}`
      );
    }
  }
  throw ultimoErro || new Error("Falha desconhecida na impressão via Bluetooth");
}

function imprimirViaUSB(tmpFile) {
  execSync(`copy /b "${tmpFile}" "${PRINTER_USB_SHARE}"`, { shell: "cmd.exe" });
}

function tocarBeeps() {
  // 3 beeps nativos do Windows (assíncrono, não trava a impressão do próximo pedido)
  execSync(
    'powershell -WindowStyle Hidden -c "[console]::beep(1000, 200); Start-Sleep -Milliseconds 100; [console]::beep(1000, 200); Start-Sleep -Milliseconds 100; [console]::beep(1000, 200)"',
    { shell: "cmd.exe" }
  );
}

async function imprimir(order) {
  const conteudo = formatarPedido(order);
  const debug    = process.env.DEBUG_PRINT === "true";

  if (debug) {
    console.log("\n─────────── CUPOM ───────────");
    console.log(`Pedido #${order.orderId} — ${order.customer}`);
    console.log("─────────── CORTE ───────────\n");
    return;
  }

  const tmpFile = escreverArquivoTemp(conteudo, order.orderId);

  try {
    try {
      tentarImprimirBluetooth(tmpFile);
      console.log(`✅ Pedido #${order.orderId} impresso via Bluetooth (${PRINTER_BT_COM})`);
    } catch (btErr) {
      console.warn(
        `↪️  Bluetooth indisponível para o pedido #${order.orderId} (${btErr.message}). Tentando fallback USB...`
      );
      imprimirViaUSB(tmpFile);
      console.log(`✅ Pedido #${order.orderId} impresso via USB (fallback)`);
    }

    try {
      tocarBeeps();
    } catch (beepErr) {
      console.warn(`⚠️  Não foi possível tocar o beep de confirmação: ${beepErr.message}`);
    }
  } finally {
    unlinkSync(tmpFile);
  }
}


// ========================
// LISTENER FIRESTORE
// ========================

const jaImpressos = new Set();
const iniciadoEm  = Date.now();

console.log("🖨️  Servidor de impressão iniciado");
console.log(`   Bluetooth: ${PRINTER_BT_COM || "(não configurado)"} | USB fallback: ${PRINTER_USB_SHARE}`);
console.log("👂 Escutando novos pedidos no Firestore...\n");

db.collection("orders")
  .where("status", "==", "Recebido")
  .where("createdAt", ">", iniciadoEm)
  .onSnapshot(
    (snapshot) => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type !== "added") return;

        const doc   = change.doc;
        const order = doc.data();

        if (jaImpressos.has(doc.id)) return;
        jaImpressos.add(doc.id);

        console.log(`📦 Novo pedido #${order.orderId} — ${order.customer}`);

        try {
          await imprimir(order);
        } catch (err) {
          console.error(`❌ Erro ao imprimir pedido #${order.orderId}:`, err.message);
        }
      });
    },
    (err) => {
      console.error("❌ Erro no listener Firestore:", err.message);
      setTimeout(() => process.exit(1), 5000);
    }
  );
