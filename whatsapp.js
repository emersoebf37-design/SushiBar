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

/* ENVIAR MENSAGEM (CORRIGIDO COM VALIDAÇÃO DE JID) */
async function enviarMensagem(telefone, mensagem){
  if(!sock){
    console.log('❌ Erro: WhatsApp não está conectado.');
    return;
  }

  try {
    let numero = telefone.replace(/\D/g, '');
    
    // Garante o código do país (Brasil = 55)
    if(!numero.startsWith('55')){
      numero = `55${numero}`;
    }

    // Procura o JID real no servidor do WhatsApp (resolve o problema do 9º dígito no Brasil)
    const [result] = await sock.onWhatsApp(numero);
    
    if (!result || !result.exists) {
      console.log(`❌ O número ${telefone} não possui WhatsApp válido.`);
      return;
    }

    // Envia para o JID correto retornado pelo servidor
    await sock.sendMessage(result.jid, { text: mensagem });
    console.log(`✅ WhatsApp enviado com sucesso para: ${result.jid}`);

  } catch(err) {
    console.error('Erro ao despachar mensagem no WhatsApp:', err.message);
  }
}

/* FUNÇÕES DE MENSAGENS (Mantidas iguais) */
function mensagemNovoPedido(order){
  return `🍣 *Kaizora — Confirmação de Pedido*

Olá, *${order.customer}*! Seu pedido foi recebido com sucesso.

📋 *Itens:*
${order.items.map(i => `• ${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.name}`).join('\n')}

🧾 *Adicionais:*
🥢 Adaptador de Hashi: ${order.addons?.hashi || 0}

💰 *Total:* R$${order.total.toFixed(2)}
💳 *Pagamento:* ${order.payment}

📍 *Entrega em:*
${order.address}, ${order.number}
${order.complement || ''}

⏳ *Status:* ${order.status}

Acompanhe seu pedido por aqui. Obrigado! 🙏`;
}


function gerarPixCopiaECola(valor) {
  const chave = "e5da076d-f585-4274-83bd-acb0e26904fb";
  const nome = "Emily da Silva de Araújo"; // Max 25 letras, sem acentos
  const cidade = "São João De Meriti"; // Max 15 letras, sem acentos
  
  const valStr = valor.toFixed(2);
  
  // Montagem dos blocos do padrão EMV (Banco Central)
  const b00 = "000201";
  const b26 = `26580014br.gov.bcb.pix0136${chave}`;
  const b52 = "52040000";
  const b53 = "5303986";
  const b54 = `54${String(valStr.length).padStart(2, '0')}${valStr}`;
  const b58 = "5802BR";
  const b59 = `59${String(nome.length).padStart(2, '0')}${nome}`;
  const b60 = `60${String(cidade.length).padStart(2, '0')}${cidade}`;
  const b62 = "62070503***";
  const b63 = "6304";
  
  const payloadCompleto = b00 + b26 + b52 + b53 + b54 + b58 + b59 + b60 + b62 + b63;
  
  // Cálculo do Checksum (CRC16 CCITT) obrigatório do Pix
  let crc = 0xFFFF;
  for (let c = 0; c < payloadCompleto.length; c++) {
    crc ^= payloadCompleto.charCodeAt(c) << 8;
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc = crc << 1;
    }
  }
  const crcResultado = (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
  
  return payloadCompleto + crcResultado;
}

function mensagemPix(order) {
  const codigoCopiaCola = gerarPixCopiaECola(order.total);

  return `💸 *Kaizora — Pagamento via Pix*

Olá, *${order.customer}*! Para confirmar seu pedido, use o Pix Copia e Cola abaixo:

💰 *Valor:* R$ ${order.total.toFixed(2)}

👇 *Toque duas vezes no código abaixo para copiar:*
\`\`\`${codigoCopiaCola}\`\`\`

Após o pagamento, envie o *comprovante aqui nessa conversa* para confirmarmos seu pedido. 🙏

⚠️ O pedido só será preparado após a confirmação do pagamento.`;
}

function mensagemStatus(order, status, senha) {
  if (status === 'Saiu para entrega') {
    return `🍣 *Seu pedido mudou de status!*\n\n` +
           `Status atual: *${status}* 🛵💨\n\n` +
           `🔑 Para sua segurança, informe esta senha de confirmação ao entregador: *${senha || 'Não gerada'}*`;
  }
  
  // Mensagem padrão para outros status (Ex: Em preparo, Entregue)
  return `🍣 *Seu pedido mudou de status!*\n\n` +
         `Status atual: *${status}*`;
}

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
  mensagemMotoboy
};