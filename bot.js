const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

const {
  conectarWhatsApp,
  enviarMensagem,
  mensagemNovoPedido,
  mensagemStatus,
  mensagemPix
} = require('./whatsapp');

const admin = require('firebase-admin');
const serviceAccount = require('./firebase-key.json');
const fs = require('fs');

/* FIREBASE */

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

/* DISCORD */

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

/* CANAL */

const CHANNEL_ID = '1503577826207600823';

/* ARQUIVO DE IDs JÁ PROCESSADOS */

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
  console.log(`Bot online: ${client.user.tag}`);
  conectarWhatsApp();
  listenOrders();
});

/* ESCUTAR PEDIDOS */

async function listenOrders() {

  db.collection('orders')
    .orderBy('createdAt', 'desc')
    .onSnapshot(async (snapshot) => {

      for (const change of snapshot.docChanges()) {

        if (change.type !== 'added') continue;

        const orderId = change.doc.id;

        if (sentOrders.has(orderId)) {
          console.log(`⏭️ Pedido ${orderId} já enviado, ignorando.`);
          continue;
        }

        // Só processa pedidos dos últimos 5 minutos
        const order = change.doc.data();
        const agora = Date.now();
        const criado = order.createdAt || 0;

        if (agora - criado > 5 * 60 * 1000) {
          console.log(`⏭️ Pedido ${orderId} é antigo, ignorando.`);
          sentOrders.add(orderId);
          salvarEnviados(sentOrders);
          continue;
        }

        sentOrders.add(orderId);
        salvarEnviados(sentOrders);

        console.log(`🛒 Novo pedido: ${orderId} — ${order.customer}`);

        /* DISCORD */

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
        ${order.complement}

        \u001b[1;37mPagamento:\u001b[0m ${order.payment}

        \u001b[1;36mItens:\u001b[0m
        ${order.items.map(i => `${i.quantity > 1 ? `${i.quantity}x ` : ''}${i.name}`).join('\n')}

        \u001b[1;36mAdicionais:\u001b[0m
        🥢 Hashi: ${order.addons?.hashi || 0}

        \u001b[1;32mTotal: R$${order.total.toFixed(2)}\u001b[0m

        \u001b[1;31mStatus: ${order.status}\u001b[0m
        \`\`\``,
          components: [row]
        });

        /* APAGAR APÓS 30 SEGUNDOS */

        setTimeout(async () => {
          try {
            await msg.delete();
            console.log(`🗑️ Mensagem do pedido ${orderId} apagada.`);
          } catch (err) {
            console.error('Erro ao apagar mensagem:', err.message);
          }
        }, 10 * 60 * 60 * 1000); /* 10 horas */

        /* WHATSAPP */

        await enviarMensagem(order.phone, mensagemNovoPedido(order));

        if (order.payment?.toLowerCase().includes('pix')) {
          await enviarMensagem(order.phone, mensagemPix(order));
        }

      }

    });

}

/* ALTERAR STATUS */

client.on('interactionCreate', async (interaction) => {

  if (!interaction.isStringSelectMenu()) return;

  const value   = interaction.values[0];
  const orderId = interaction.customId.replace('status_', '');

  await db.collection('orders').doc(orderId).update({ status: value });

  const orderDoc  = await db.collection('orders').doc(orderId).get();
  const orderData = orderDoc.data();

  await enviarMensagem(orderData.phone, mensagemStatus(orderData, value));

  await interaction.reply({
    content: `✅ Status atualizado para: ${value}`,
    ephemeral: true
  });

});

/* MOTObOY */

const MOTOBOY_PHONE = "5521997921690";

try {

  await enviarMensagem(
    MOTOBOY_PHONE,
    `🛵 *Novo pedido para entrega*

👤 Cliente: ${order.customer}

📍 Endereço:
${order.address}, ${order.number}
${order.complement || ""}

💰 Total: R$${order.total.toFixed(2)}

📞 Cliente:
${order.phone}

https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  `${order.address}, ${order.number}`
)}`
  );

  console.log("🛵 Motoboy notificado.");

} catch(err) {

  console.error(
    "Erro ao notificar motoboy:",
    err
  );

}

console.log(
  "Enviando mensagem para motoboy:",
  MOTOBOY_PHONE
);

/* LOGIN */

require('dotenv').config();
client.login(process.env.DISCORD_TOKEN);