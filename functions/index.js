const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

const OPENPIX_APP_ID = functions.config().openpix.app_id;

/* GERAR PIX */
exports.criarPix = functions.https.onRequest(async (req, res) => {

  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if(req.method === 'OPTIONS'){
    res.status(204).send('');
    return;
  }

  const { orderId, total, customer } = req.body;

  try {

    const response = await axios.post(
      'https://api.openpix.com.br/api/v1/charge',
      {
        correlationID: orderId,
        value: Math.round(total * 100),
        comment: 'Pedido Kaizora',
        customer: { name: customer }
      },
      {
        headers: {
          Authorization: OPENPIX_APP_ID,
          'Content-Type': 'application/json'
        }
      }
    );

    const charge = response.data.charge;

    res.json({
      qr_code_image: charge.qrCodeImage,
      qr_code: charge.brCode,
      charge_id: charge.correlationID
    });

  } catch(err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Erro ao gerar Pix' });
  }

});

/* WEBHOOK — OPENPIX AVISA AQUI */
exports.webhook = functions.https.onRequest(async (req, res) => {

  res.sendStatus(200);

  const { event, charge } = req.body;

  if(event !== 'OPENPIX:CHARGE_COMPLETED') return;

  const orderId = charge.correlationID;

  try {

    await db.collection('orders').doc(orderId).update({
      status: 'Pagamento confirmado'
    });

    console.log(`Pagamento confirmado: pedido ${orderId}`);

  } catch(err) {
    console.error(err);
  }

});