const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const { fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

let sock = null;

/* CONECTAR WHATSAPP */
async function conectarWhatsApp(){
  const { state, saveCreds } = await useMultiFileAuthState('auth_whatsapp');
    const { version } = await fetchLatestBaileysVersion();
    
  sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  const notifier = require('node-notifier');

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    
    for (const msg of messages) {

      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      if (!msg.message) continue;

      const de = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        '(mídia ou sticker)';

      console.log(`\n📩 MENSAGEM RECEBIDA DE: ${de}`);
      console.log(`💬 "${texto}"\n`);

      // Beep nativo do Windows (assíncrono para não travar)
      const { exec } = require('child_process');
      exec('powershell -WindowStyle Hidden -c "[console]::beep(1000, 200); Start-Sleep -Milliseconds 100; [console]::beep(1000, 200); Start-Sleep -Milliseconds 100; [console]::beep(1000, 200)"');

      // Notificação visual
      const { exec: execNotif } = require('child_process');
      execNotif(`powershell -c "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('De: ${de}\\n${texto.replace(/'/g, '')}', 'Kaizora — WhatsApp')"`);

    }
  });

  sock.ev.on('connection.update', async(update) => {
    const { connection, lastDisconnect, qr } = update;

    if(qr){
      console.log('\n📱 Escaneie o QR code abaixo com o WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if(connection === 'close'){
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('Conexão do WhatsApp encerrada. Reconectando:', shouldReconnect);
      if(shouldReconnect){
        await conectarWhatsApp();
      }
    } else if(connection === 'open'){
      console.log('✅ WhatsApp conectado com sucesso e pronto para envios!');
    }
  });
}

/* ENVIAR MENSAGEM */
async function enviarMensagem(telefone, mensagem){
  if(!sock){
    console.log('❌ Erro: WhatsApp não está conectado.');
    return;
  }

  try {
    let numero = telefone.replace(/\D/g, '');

    if(!numero.startsWith('55')){
      numero = `55${numero}`;
    }

    const [result] = await sock.onWhatsApp(numero);

    if (!result || !result.exists) {
      console.log(`❌ O número ${telefone} não possui WhatsApp válido.`);
      return;
    }

    await sock.sendMessage(result.jid, { text: mensagem });
    console.log(`✅ WhatsApp enviado com sucesso para: ${result.jid}`);

  } catch(err) {
    console.error('Erro ao despachar mensagem no WhatsApp:', err.message);
  }
}

/* MENSAGEM DE NOVO PEDIDO */
function mensagemNovoPedido(order){
  const addons = order.addons || {};

  // Nomes e preços dos adicionais fixos (mesma tabela usada no cupom da impressora).
  // Chave não listada aqui cai no fallback genérico "➕ <chave>".
  const ADDON_INFO = {
    hashi:                    { label: '🥢 Hashi',                            price: 0 },
    pimenta:                  { label: '🌶️ Pimenta de Sichuan',               price: 0 },
    geleia:                   { label: '🌶️ Geleia de Pimenta',                price: 1.00 },
    amendoim:                 { label: '🥜 Amendoim',                         price: 0 },
    talheres:                 { label: '🍴 Talheres',                         price: 0 },
    creamCheeseExtra:         { label: '🧀 Cream Cheese Extra',               price: 1.00 },
    creamCheeseCrocante:      { label: '🧀 Cream Cheese c/ Crocante',         price: 1.50 },
    creamCheeseCouve:         { label: '🧀 Cream Cheese c/ Couve Frita',      price: 1.50 },
    creamCheeseGeleiaPimenta: { label: '🧀 Cream Cheese c/ Geleia de Pimenta', price: 1.50 },
    creamCheeseTemaki:        { label: '🧀 Cream Cheese no Temaki',           price: 1.50 },
  };

  const adicionaisLinhas = [];

  // Adicionais fixos (hashi, geleia, pimenta, amendoim, talheres, cream cheese...)
  for (const [key, qty] of Object.entries(addons)) {
    const quantidade = Number(qty) || 0;
    if (quantidade <= 0) continue;
    if (key.startsWith('custom_')) continue; // esses são tratados abaixo, com nome/preço reais

    const info = ADDON_INFO[key] || { label: `➕ ${key}`, price: 0 };
    const subtotal = info.price * quantidade;
    const precoTexto = subtotal > 0 ? `+R$${subtotal.toFixed(2).replace('.', ',')}` : 'Grátis';
    adicionaisLinhas.push(`${info.label}: ${quantidade} (${precoTexto})`);
  }

  // Adicionais customizados (cadastrados pelo admin). Nome e preço já vêm
  // resolvidos e validados desde a criação do pedido em orders.js.
  if (Array.isArray(order.customAddons)) {
    for (const ca of order.customAddons) {
      const quantidade = Number(ca.quantity) || 0;
      if (quantidade <= 0) continue;
      const subtotal = Number(ca.subtotal ?? (ca.unitPrice * quantidade)) || 0;
      const precoTexto = subtotal > 0 ? `+R$${subtotal.toFixed(2).replace('.', ',')}` : 'Grátis';
      adicionaisLinhas.push(`➕ ${ca.name}: ${quantidade} (${precoTexto})`);
    }
  }

  const adicionaisTexto = adicionaisLinhas.length > 0
    ? adicionaisLinhas.join('\n')
    : 'Nenhum';

  const linhaDesconto = order.descontoPrimeiroPedido
    ? '\n🎉 *Desconto de boas-vindas (1º pedido): -10%*\n'
    : '';

  return `🍣 *Kaizora — Confirmação de Pedido*

Olá, *${order.customer}*! Seu pedido foi recebido com sucesso.

📋 *Itens:*
${order.items.map(i => {
  let linha = `• ${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.name}`;
  if (i.isPoke && i.pokeDetails) {
    const pd = i.pokeDetails;
    const salada = Array.isArray(pd.salada) ? pd.salada.map(s => s.name).join(' + ') : '';
    linha += `\n   🍚 ${pd.arroz?.name || '-'}` +
             `\n   🐟 ${pd.proteina?.name || '-'}` +
             `\n   🥗 ${salada || '-'}` +
             `\n   🍤 ${pd.crocante?.name || '-'}`;
  }
  return linha;
}).join('\n')}

🧾 *Adicionais:*
${adicionaisTexto}
${linhaDesconto}
💰 *Total:* R$${order.total.toFixed(2).replace('.', ',')}
💳 *Pagamento:* ${order.payment}

📍 *Entrega em:*
${order.address}, ${order.number}
${order.complement || ''}

⏳ *Status:* ${order.status}

Acompanhe seu pedido por aqui. Obrigado! 🙏`;
}

/* MENSAGEM PIX */
function mensagemPix(order) {
  return `💸 *Kaizora — Pagamento via Pix*

Olá, *${order.customer}*! Para confirmar seu pedido, realize o pagamento.

💰 *Valor:* R$ ${order.total.toFixed(2).replace('.', ',')}

🔑 *Chave Pix (CNPJ):*
67.185.069/0001-08

Após o pagamento, envie o *comprovante aqui nessa conversa* para confirmarmos seu pedido. 🙏

⚠️ O pedido só será preparado após a confirmação do pagamento.`;
}

/* CÓDIGO PIX ISOLADO */
function mensagemCodigoPix(order) {
  return `67.185.069/0001-08`;
}

/* MENSAGEM DE STATUS */
function mensagemStatus(order, status, senha) {
  if (status === 'Saiu para entrega') {
    return `🍣 *Seu pedido mudou de status!*\n\n` +
           `Status atual: *${status}* 🛵💨\n\n` +
           `🔑 Para sua segurança, informe esta senha de confirmação ao entregador: *${senha || 'Não gerada'}*`;
  }
  return `🍣 *Seu pedido mudou de status!*\n\n` +
         `Status atual: *${status}*`;
}

/* MENSAGEM MOTOBOY */
function mensagemMotoboy(order, senha, mapsLink) {
  return `🛵 *NOTIFICAÇÃO DE ENTREGA (MOTOBOY)*\n\n` +
         `*Pedido:* #${order.orderId || '?'}\n` +
         `*Cliente:* ${order.customer}\n` +
         `*Endereço:* ${order.address}, ${order.number}\n` +
         `*Complemento:* ${order.complement || 'Não informado'}\n\n` +
         `📍 *Rota no Google Maps:* ${mapsLink}\n\n` +
         `🔑 *Senha para confirmação:* ${senha}`;
}

module.exports = {
  conectarWhatsApp,
  enviarMensagem,
  mensagemNovoPedido,
  mensagemStatus,
  mensagemPix,
  mensagemCodigoPix,
  mensagemMotoboy
};
