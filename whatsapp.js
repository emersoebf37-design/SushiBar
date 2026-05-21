const makeWASocket =
  require('@whiskeysockets/baileys').default;

const {
  useMultiFileAuthState,
  DisconnectReason
} = require('@whiskeysockets/baileys');

const qrcode = require('qrcode-terminal');

let sock = null;

/* CONECTAR WHATSAPP */
async function conectarWhatsApp(){

  const { state, saveCreds } =
    await useMultiFileAuthState('auth_whatsapp');

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async(update) => {

    const { connection, lastDisconnect, qr } = update;

    if(qr){
      console.log('\n📱 Escaneie o QR code abaixo com o WhatsApp:\n');
      qrcode.generate(qr, { small: true });
    }

    if(connection === 'close'){

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode
        !== DisconnectReason.loggedOut;

      console.log('Conexão encerrada. Reconectando:', shouldReconnect);

      if(shouldReconnect){
        await conectarWhatsApp();
      }

    } else if(connection === 'open'){
      console.log('✅ WhatsApp conectado!');
    }

  });

}

/* ENVIAR MENSAGEM */
async function enviarMensagem(telefone, mensagem){

  if(!sock){
    console.log('WhatsApp não conectado.');
    return;
  }

  try {

    const numero = telefone.replace(/\D/g, '');

    const jid = numero.startsWith('55')
      ? `${numero}@s.whatsapp.net`
      : `55${numero}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: mensagem });

    console.log(`✅ WhatsApp enviado para ${telefone}`);

  } catch(err) {
    console.error('Erro ao enviar WhatsApp:', err.message);
  }

}

/* MENSAGEM DE NOVO PEDIDO */
function mensagemNovoPedido(order){
  return `🍣 *Kaizora — Confirmação de Pedido*

Olá, *${order.customer}*! Seu pedido foi recebido com sucesso.

📋 *Itens:*
${order.items.map(i => `• ${i.name}`).join('\n')}

🧾 *Adicionais:*
🥢 Hashi: ${order.addons?.hashi || 0}
🍯 Tarê: ${order.addons?.tare || 0}
🍶 Teriyaki: ${order.addons?.teriyaki || 0}

💰 *Total:* R$${order.total.toFixed(2)}
💳 *Pagamento:* ${order.payment}

📍 *Entrega em:*
${order.address}, ${order.number}
${order.complement}

⏳ *Status:* ${order.status}

Acompanhe seu pedido por aqui. Obrigado! 🙏`;
}

// 🆕 MENSAGEM DE COBRANÇA PIX
function mensagemPix(order){
  return `💸 *Kaizora — Pagamento via Pix*

Olá, *${order.customer}*! Para confirmar seu pedido, realize o pagamento:

💰 *Valor:* R$${order.total.toFixed(2)}

🔑 *Chave Pix:*
\`e5da076d-f585-4274-83bd-acb0e26904fb\`

Após o pagamento, envie o *comprovante aqui nessa conversa* para confirmarmos seu pedido. 🙏

⚠️ O pedido só será preparado após a confirmação do pagamento.`;
}

/* MENSAGEM DE STATUS */
function mensagemStatus(order, novoStatus){

  const emojis = {
    'Em preparo':        '👨‍🍳 Seu pedido está sendo preparado!',
    'Saiu para entrega': '🛵 Seu pedido saiu para entrega!',
    'Entregue':          '✅ Seu pedido foi entregue!'
  };

  const texto = emojis[novoStatus] || `Status atualizado: ${novoStatus}`;

  return `🍣 *Kaizora — Atualização do Pedido*

Olá, *${order.customer}*!

${texto}

💰 *Total:* R$${order.total.toFixed(2)}
📍 *Endereço:* ${order.address}, ${order.number}

Obrigado pela preferência! 🙏`;

}

module.exports = {
  conectarWhatsApp,
  enviarMensagem,
  mensagemNovoPedido,
  mensagemStatus,
  mensagemPix  // 🆕 exportando a nova função
};