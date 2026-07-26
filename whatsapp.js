const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

let sock = null;

/* CONECTAR WHATSAPP */
async function conectarWhatsApp(){
  const { state, saveCreds } = await useMultiFileAuthState('auth_whatsapp');

  sock = makeWASocket({
    auth: state,
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
  
  const adicionaisLinhas = [];
  if(addons.hashi > 0) adicionaisLinhas.push(`🥢 Hashi: ${addons.hashi} (Grátis)`);
  if(addons.geleia > 0) adicionaisLinhas.push(`🌶️ Geleia de Pimenta: ${addons.geleia} (+R$${(addons.geleia * 1.00).toFixed(2).replace('.', ',')})`);
  if(addons.pimenta > 0) adicionaisLinhas.push(`🌶️ Pimenta de Sichuan: ${addons.pimenta} (Grátis)`);

  const adicionaisTexto = adicionaisLinhas.length > 0
    ? adicionaisLinhas.join('\n')
    : 'Nenhum';

  return `🍣 *Kaizora — Confirmação de Pedido*

Olá, *${order.customer}*! Seu pedido foi recebido com sucesso.

📋 *Itens:*
${order.items.map(i => `• ${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.name}`).join('\n')}

🧾 *Adicionais:*
${adicionaisTexto}

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