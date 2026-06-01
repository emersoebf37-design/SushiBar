require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json');
const fs = require('fs');

// 1. ADICIONADO "mensagemMotoboy" NO IMPORT
const { 
  conectarWhatsApp, 
  enviarMensagem, 
  mensagemNovoPedido, 
  mensagemPix, 
  mensagemStatus,
  mensagemMotoboy 
} = require('./whatsapp');

/* FIREBASE */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

/* DISCORD */
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = '1503577826207600823';
const SENT_FILE = './sent_orders.json';

function carregarEnviados() {
  try {
    if (fs.existsSync(SENT_FILE)) {
      const data = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'));
      return new Set(data);
    }
  } catch(err) {
    console.error('Erro ao carregar sent_orders.json:', err.message);
  }
  return new Set();
}

function salvarEnviados(set) {
  try {
    fs.writeFileSync(SENT_FILE, JSON.stringify([...set]), 'utf8');
  } catch(err) {
    console.error('Erro ao salvar sent_orders.json:', err.message);
  }
}

const sentOrders = carregarEnviados();

/* BOT ONLINE */
client.once('ready', () => {
  console.log(`Bot do Discord online: ${client.user.tag}`);
  conectarWhatsApp(); 
  listenOrders();
});

/* ESCUTAR PEDIDOS DO BANCO E EXIBIR NO DISCORD */
async function listenOrders() {
  db.collection('orders')
    .orderBy('createdAt', 'desc')
    .onSnapshot(async (snapshot) => {

      for (const change of snapshot.docChanges()) {
        if (change.type !== 'added') continue;

        const orderId = change.doc.id;

        if (sentOrders.has(orderId)) {
          continue;
        }

        // Filtro de segurança: ignora pedidos mais antigos que 5 minutos
        const order = change.doc.data();
        const agora = Date.now();
        const criado = order.createdAt || 0;

        if (agora - criado > 5 * 60 * 1000) {
          sentOrders.add(orderId);
          salvarEnviados(sentOrders);
          continue;
        }

        sentOrders.add(orderId);
        salvarEnviados(sentOrders);

        console.log(`📺 Exibindo painel no Discord para o pedido: #${order.orderId || '?'}`);

        // ==========================================
        // DISPAROS DO WHATSAPP PARA O CLIENTE
        // ==========================================
        if (order.phone) {
          const textoPedido = mensagemNovoPedido(order);
          await enviarMensagem(order.phone, textoPedido);

          if (order.payment === 'Pix') {
            const textoPix = mensagemPix(order);
            await enviarMensagem(order.phone, textoPix);
          }
        }

        // ==========================================
        // ROTINA EXCLUSIVA DO MOTOBOY (NOVO LOCAL!)
        // ==========================================
        let motoboyOn = false;
        try {
          // Busca o estado do botão no Firebase config/settings
          const configSnap = await db.collection('config').doc('settings').get();
          const raw = configSnap.exists ? configSnap.data().motoboy_on : false;
          motoboyOn = raw === true || raw === 'true';
        } catch (configErr) {
          console.warn('⚠️ Erro ao ler config do motoboy no Firebase:', configErr.message);
        }

        const distanciaKm = Number(order.distanciaKm) || 0;

        // Validação: Painel ativo E distância maior que 3km
        if (motoboyOn && distanciaKm > 3) {
          const motoboyPhone = process.env.MOTOBOY_PHONE;
          
          if (motoboyPhone) {
            const textoMotoboy = mensagemMotoboy(order);
            await enviarMensagem(motoboyPhone, textoMotoboy);
            console.log(`🛵 Motoboy avisado via WhatsApp (${distanciaKm.toFixed(1)} km)`);
          } else {
            console.warn('⚠️ MOTOBOY_PHONE não configurado no arquivo .env deste Bot!');
          }
        } else {
          console.log(`ℹ️ Motoboy NÃO notificado | Ativo: ${motoboyOn} | Distância: ${distanciaKm.toFixed(1)} km`);
        }
        // ==========================================

        /* ENVIAR EMBED/ANSI AO CANAL DO DISCORD */
        try {
          const channel = await client.channels.fetch(CHANNEL_ID);

          const menu = new StringSelectMenuBuilder()
            .setCustomId(`status_${orderId}`)
            .setPlaceholder('Atualizar status')
            .addOptions([
              { label: 'Em preparo',        value: 'Em preparo'        },
              { label: 'Saiu para entrega', value: 'Saiu para entrega' },
              { label: 'Entregue',          value: 'Entregue'          }
            ]);

          const row = new ActionRowBuilder().addComponents(menu);

          const msg = await channel.send({
            content:
`\`\`\`ansi
\u001b[1;33m🍣 NOVO PEDIDO — #${order.orderId || '?'}\u001b[0m

\u001b[1;37mCliente:\u001b[0m ${order.customer}
\u001b[1;37mTelefone:\u001b[0m ${order.phone}

\u001b[1;37mEndereço:\u001b[0m
${order.address}, ${order.number}
${order.complement || ''}

\u001b[1;37mPagamento:\u001b[0m ${order.payment}

\u001b[1;36mItens:\u001b[0m
${order.items ? order.items.map(i => `${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.name}`).join('\n') : 'Nenhum item'}

\u001b[1;36mAdicionais:\u001b[0m
🥢 Hashi: ${order.addons?.hashi || 0}

\u001b[1;32mTotal: R$${order.total ? order.total.toFixed(2) : '0.00'}\u001b[0m

\u001b[1;31mStatus: ${order.status || 'Pendente'}\u001b[0m
\`\`\``,
            components: [row]
          });

          /* AUTO-DESTRUIÇÃO (10 HORAS) */
          setTimeout(async () => {
            try {
              await msg.delete();
              console.log(`🗑️ Mensagem temporária do pedido ${orderId} removida do canal.`);
            } catch (err) {
              console.error('Erro ao deletar mensagem antiga:', err.message);
            }
          }, 10 * 60 * 60 * 1000);

        } catch (err) {
          console.error('Erro ao renderizar painel no Discord:', err.message);
        }
      }
    });
}

/* INTERAÇÃO: ALTERAR STATUS NO BANCO E NOTIFICAR CLIENTE */
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isStringSelectMenu()) return;
  if (!interaction.customId.startsWith('status_')) return;

  try {
    const value = interaction.values[0];
    const orderId = interaction.customId.replace('status_', '');

    await db.collection('orders').doc(orderId).update({ status: value });

    const orderDoc = await db.collection('orders').doc(orderId).get();
    
    if (orderDoc.exists) {
      const orderData = orderDoc.data();
      if (orderData.phone) {
        const textoStatus = mensagemStatus(orderData, value);
        await enviarMensagem(orderData.phone, textoStatus);
      }
    }

    await interaction.reply({
      content: `✅ Status sincronizado no banco e enviado ao WhatsApp: ${value}`,
      ephemeral: true
    });
    
  } catch (err) {
    console.error('Erro ao persistir novo status / enviar WhatsApp:', err.message);
    await interaction.reply({
      content: `❌ Falha ao atualizar dados ou notificar cliente.`,
      ephemeral: true
    }).catch(() => {});
  }
});

/* AUTENTICAÇÃO DO BOT */
client.login(process.env.DISCORD_TOKEN);