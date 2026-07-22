import admin from "firebase-admin";
import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

export const db = admin.firestore();

// ========================
// LOGO (GS v 0 — raster inline)
// ========================

const LOGO_BASE64 = "HXYwABkANwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/gAAD+AAAAAAAAAAAAAAAAAAAAAAAAAAAf+AAB/wAAAAAAAAAAAAAAAAAAAAAAAAAAP/wAA/+AAAAAAAAAAAAAAAAAAAAAAAAAAH/8//f/wAAAAAAAAAAAAAAAAAAAAAAAAAB//////8AAAAAAAAAAAAAAAAAAAAAAAAAAf/8AD//AAAAAAAAAAAAAAAAAAAAAAAAAAH+4AAP/wAAAAAAAAAAAAAAAAAAAAAAAAAB/4AAA/8AAAAAAAAAAAAAAAAAAAAAAAAAAf8AAAH/AAAAeAAAAAAAAABAAAeAAAAAAAD+AAAA/z4PgHwB8P/8A/wD/+APgAAAAAAA/AAAAH4eH4D8AfD+eA/+A//wD8AAAAAAAHgAAAA8Ph4A/gHw4PgcHwPg8A/AAAAAAAAwAAAAHB48Af4A8AHwPA+D4Hgf4AAAAAAAYBwAeAweeAH+APAB4DgHg+D4H+AAAAAAAGB+APwGHnABzwDwA8B4B8PA8B3gAAAAAADA/wD+Bh7gAc8A8AfAeAPDwPA48AAAAAAAwf8A/wMf8AOHgPAHgHgD48HgOPAAAAAAAMH/AO+DH/ADh4DwDwB4A+PHwDB4AAAAAAGD5wDvgx/4BweA8A8AeAPh7wBweAAAAAABg/4A/4MeeAcDwPAeAHgD4f8AYDwAAAAAAYP+AH+BHjwH+8DwPAB4A8HPgP88AAAAAAGD/Dh/gR4cD//A8DgAfAPBx4D//AAAAAABgfh8P4EcDg/B4PB4ADwDgcHA/B4AAAAAAYDwfg4DHAcMAODw8AA+A4HAwYAeAAAAAAGAADwAAxwDGADw8PAAHwcBwGGADwAAAAAAwAAYAAMcAZAAcPD//A/uAcAxAA8AAAAAAMABGQAGHACAAHjw//AH/AHAEgAHAAAAAABgAf8ADhwAQAA44PwAAPABwAAABwAAAAAAMABAABwAAAAAAAAAAAAAAAAAAAAAAAAAADgAAAA4AAAAAAAAAAAAAAAAAAAAAAAAAAAeAAAAcAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AAAeAAAAAAAAAAAAAAAAAAAAAAAAAAAAHwAA+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAf8/+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH//wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAB///";

// ========================
// COMANDOS ESC/POS
// ========================

const ESC = "\x1B";
const GS  = "\x1D";

const INIT    = ESC + "@";
const BOLD_ON   = ESC + "E\x01";
const BOLD_OFF  = ESC + "E\x00";
const ALIGN_CTR = ESC + "a\x01";
const ALIGN_LEFT= ESC + "a\x00";
const FONT_A    = ESC + "M\x00";
const LF        = "\n";
const CUT       = GS  + "V\x41\x03";

const COLS = 32;
const DIV  = "-".repeat(COLS);

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

function abreviarNome(nome) {
  return nome
    .replace("Yakisoba de Frango", "Yaki Frango")
    .replace("Yakisoba de Calabresa", "Yaki Calabresa")
    .replace("Yakisoba de Carne", "Yaki Carne")
    .replace("Yakisoba de Legumes", "Yaki Legumes")
    .replace("Yakisoba Misto", "Yaki Misto")
    .replace("Hot Roll Philadelphia Salmão", "Hot Phila")
    .replace("Bolinho de Salmão", "Bolinho Salm")
    .replace("Hossomaki Philadelphia Salmão", "Hosso Phila")
    .replace("Harumaki de Legumes", "Haru Leg")
    .replace("Harumaki de Salmão", "Haru Salm")
    .replace("Harumaki de queijo", "Haru Qjo")
    .replace("Harumaki de Frango com Cream Cheese", "Haru Frang")
    .replace("Lula à Dorê", "Lula Dorê")
    .replace("Shimeji na Manteiga", "Shimeji")
    .replace("Salada Sunomono", "Sunomono")
    .replace("Sashimi de Salmão", "Sashimi Salm")
    .replace("Joe de Salmão com Cream Cheese", "Joe Salm Cream")
    .replace("Mega Combo Hot Roll", "Mega Hot Roll")
    .replace("Combo Crocantissimo", "Combo Croc")
    .replace("Combo Individual", "Combo Indiv")
    .replace("Combo de Frios", "Combo Frios")
    .replace("Combo Premium", "Combo Premium")
    .replace("Combo Primavera", "Combo Prima")
    .replace("Guaraná Antartica Lata", "Guarana Lata")
    .replace(" (P)", " P")
    .replace(" (M)", " M")
    .replace(" (G)", " G")
    .replace(" (8 unidades)", " 8 un")
    .replace(" (6 unidades)", " 6 un")
    .replace(" (4 unidades)", " 4 un") 
    .replace(" (3 unidades)", " 3 un")
    .replace(" (2 unidades)", " 2 un");
}

export function formatarPedido(order) {
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
  const endereco = [order.address, order.number]
    .filter(Boolean)
    .join(", ");

  body += trunc(endereco, COLS) + LF;
  if (order.complement)   body += trunc(order.complement, COLS) + LF;
  if (order.neighborhood) body += trunc(order.neighborhood, COLS) + LF;
  if (order.city)         body += trunc(order.city + " - RJ", COLS) + LF;
  body += DIV + LF;

  body += BOLD_ON + "ITENS" + LF + BOLD_OFF;
  for (const item of order.items) {
    const subtotal = moeda(item.unitPrice * item.quantity);
    const prefixo  = item.quantity + "x ";
    const nomeMax  = COLS - prefixo.length - subtotal.length - 1;
    body += rowLR(prefixo + trunc(abreviarNome(item.name), nomeMax), subtotal);
  }
  body += DIV + LF;

  // ==========================================
  // IMPRESSÃO DINÂMICA DE ADICIONAIS
  // ==========================================
  const addons = order.addons || {};
  const addonsValidos = Object.entries(addons)
    .filter(([_, qty]) => Number(qty) > 0);

  const ADDON_PRECOS = {
    hashi: 0,
    pimenta: 0,
    geleia: 1.00,
    creamCheeseExtra: 1.00,
    creamCheeseCrocante: 1.50,
    creamCheeseCouve: 1.50,
    creamCheeseGeleiaPimenta: 1.50,
  };

  if (addonsValidos.length > 0) {
    body += BOLD_ON + "ADICIONAIS" + LF + BOLD_OFF;

    for (const [key, qty] of addonsValidos) {
      const nomeFormatado = key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, s => s.toUpperCase())
        .trim();

      const precoUnit = ADDON_PRECOS[key] ?? 0;
      const subtotal = precoUnit * Number(qty);

      body += rowLR(
        `${nomeFormatado} x${qty}`,
        subtotal > 0 ? moeda(subtotal) : "Gratis"
      );
    }

    body += DIV + LF;
  }

  body += rowLR("Taxa de entrega:", moeda(order.taxaEntrega));
  body += BOLD_ON + rowLR("TOTAL:", moeda(order.total)) + BOLD_OFF;
  body += rowLR("Pagamento:", order.payment);
  body += DIV + LF;

  body += ALIGN_CTR + center("Obrigado pela preferencia!");
  body += LF + CUT;

  const logoBuf   = Buffer.from(LOGO_BASE64, "base64");
  const headerBuf = Buffer.from(header, "binary");
  const bodyBuf   = Buffer.from(body, "binary");

  return Buffer.concat([headerBuf, logoBuf, bodyBuf]);
}


// ========================
// SOM DE AVISO
// ========================

function tocarSomPedido() {
  execSync(
    'powershell -WindowStyle Hidden -c "' +
    '1..3 | ForEach-Object {' +
      '[console]::beep(988,80);' +
      '[console]::beep(1319,250);' +
      'Start-Sleep -Milliseconds 1500' +
    '}"',
    { windowsHide: true, stdio: "ignore" }
  );
}
// ========================
// CONFIGURAÇÃO DAS IMPRESSORAS
// ========================

// Nome exato como aparece em "Dispositivos e Impressoras" no Windows
// Nome exato como aparece em "Dispositivos e Impressoras" no Windows
const PRINTER_BT   = "KA 1445 Bluetooth Kaizora 1";
const SHARE_BT      = "\\\\localhost\\KA-1445-BT";

const PRINTER_USB  = "POS58 10.0.0.6";
const SHARE_USB     = "\\\\localhost\\POS58 10.0.0.6";

// ========================
// STATUS DA IMPRESSORA
// ========================

function impressoraDisponivel(nomeImpressora) {
  try {
    const status = execSync(
      `powershell -NoProfile -Command "(Get-Printer -Name '${nomeImpressora}' -ErrorAction Stop).PrinterStatus"`,
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    ).trim();

    // "Normal" = pronta pra imprimir. Qualquer outra coisa (Error, Offline, PaperOut etc) = pular
    return status === "0" || status === "Normal";
  } catch {
    // Impressora não existe / não instalada / comando falhou
    return false;
  }
}

// ========================
// IMPRESSÃO (com fallback BT -> USB)
// ========================

async function imprimir(order) {
  const conteudo = formatarPedido(order);
  const debug    = process.env.DEBUG_PRINT === "true";

  if (debug) {
    console.log("\n─────────── CUPOM ───────────");
    console.log(`Pedido #${order.orderId} — ${order.customer}`);
    console.log("─────────── CORTE ───────────\n");
    return;
  }

  const tmpFile = join(tmpdir(), `pedido_${order.orderId}.bin`);
  writeFileSync(tmpFile, conteudo);

  const destinos = [
    { nome: PRINTER_BT,  share: SHARE_BT,  label: "Bluetooth" },
    { nome: PRINTER_USB, share: SHARE_USB, label: "USB" },
  ];

  let impresso  = false;
  let ultimoErro = null;

  for (const destino of destinos) {
    if (!impressoraDisponivel(destino.nome)) {
      console.log(`⚠️  ${destino.label} (${destino.nome}) indisponível, tentando próxima...`);
      continue;
    }

    try {
      execSync(`copy /b "${tmpFile}" "${destino.share}"`, { shell: "cmd.exe" });
      console.log(`✅ Pedido #${order.orderId} impresso via ${destino.label}`);
      impresso = true;
      break;
    } catch (err) {
      console.error(`❌ Falha ao imprimir via ${destino.label}:`, err.message);
      ultimoErro = err;
    }
  }

  unlinkSync(tmpFile);

  if (!impresso) {
    throw ultimoErro || new Error("Nenhuma impressora disponível (Bluetooth ou USB)");
  }
}

// ========================
// LISTENER FIRESTORE
// ========================

const jaImpressos = new Set();
const iniciadoEm  = Date.now();

console.log("🖨️  Servidor de impressão iniciado");
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

        tocarSomPedido();

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
