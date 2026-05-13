const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  StringSelectMenuBuilder
} = require('discord.js');

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

`🍣 NOVO PEDIDO

Cliente: ${order.customer}

Telefone: ${order.phone}

Endereço:
${order.address}, ${order.number}

${order.complement}

Pagamento:
${order.payment}

Itens:
${order.items.map(i=>i.name).join(', ')}

Total:
R$${order.total.toFixed(2)}

Status:
${order.status}`,

        components:[row]

      });

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

  await interaction.reply({

    content:`✅ Status atualizado para: ${value}`,

    ephemeral:true

  });

});

/* LOGIN */

require('dotenv').config();

client.login(process.env.DISCORD_TOKEN);