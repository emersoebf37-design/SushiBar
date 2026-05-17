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
  mensagemStatus
} = require('./whatsapp');

const admin = require('firebase-admin');

const serviceAccount = require('./firebase-key.json');

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

/* PEDIDOS JÁ ENVIADOS */

const sentOrders = new Set();

/* BOT ONLINE */

client.once('ready', () => {

  console.log(`Bot online: ${client.user.tag}`);

  conectarWhatsApp();
  listenOrders();

});

/* ESCUTAR PEDIDOS */

async function listenOrders(){

  db.collection('orders')
  .onSnapshot(async(snapshot)=>{

    for(const change of snapshot.docChanges()){

      if(change.type !== 'added') continue;

      const orderId = change.doc.id;

      if(sentOrders.has(orderId)) continue;

      sentOrders.add(orderId);

      const order = change.doc.data();

      const channel =
      await client.channels.fetch(CHANNEL_ID);

      const menu =
      new StringSelectMenuBuilder()
      .setCustomId(`status_${orderId}`)
      .setPlaceholder('Atualizar status')
      .addOptions([
        {
          label:'Em preparo',
          value:'Em preparo'
        },
        {
          label:'Saiu para entrega',
          value:'Saiu para entrega'
        },
        {
          label:'Entregue',
          value:'Entregue'
        }
      ]);

      const row =
      new ActionRowBuilder().addComponents(menu);

      await channel.send({

    content:
    `\`\`\`ansi
    \u001b[1;33m🍣 NOVO PEDIDO\u001b[0m

    \u001b[1;37mCliente:\u001b[0m ${order.customer}
    \u001b[1;37mTelefone:\u001b[0m ${order.phone}

    \u001b[1;37mEndereço:\u001b[0m
    ${order.address}, ${order.number}
    ${order.complement}

    \u001b[1;37mPagamento:\u001b[0m ${order.payment}

    \u001b[1;36mItens:\u001b[0m
    ${order.items.map(i => i.name).join('\n')}

    \u001b[1;36mAdicionais:\u001b[0m
    🥢 Hashi: ${order.addons?.hashi || 0}
    🍯 Tarê: ${order.addons?.tare || 0}
    🍶 Teriyaki: ${order.addons?.teriyaki || 0}

    \u001b[1;32mTotal: R$${order.total.toFixed(2)}\u001b[0m

    \u001b[1;31mStatus: ${order.status}\u001b[0m
    \`\`\``,

        components:[row]

      });
    
      await enviarMensagem(
      order.phone,
      mensagemNovoPedido(order)
      );

    }

  });

}

/* ALTERAR STATUS */

client.on('interactionCreate', async(interaction)=>{

  if(!interaction.isStringSelectMenu()) return;

  const value =
  interaction.values[0];

  const orderId =
  interaction.customId.replace('status_','');

  await db
  .collection('orders')
  .doc(orderId)
  .update({

    status:value

  });

  // Busca os dados do pedido para pegar o telefone
  const orderDoc = await db
    .collection('orders')
    .doc(orderId)
    .get();

  const orderData = orderDoc.data();

  // Manda atualização no WhatsApp
  await enviarMensagem(
    orderData.phone,
    mensagemStatus(orderData, value)
  );

  await interaction.reply({

    content:`✅ Status atualizado para: ${value}`,

    ephemeral:true

  });

});

/* LOGIN */

require('dotenv').config();

client.login(process.env.DISCORD_TOKEN);