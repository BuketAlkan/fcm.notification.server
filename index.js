const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

console.log('FIREBASE_ADMIN_SDK_JSON:', process.env.FIREBASE_ADMIN_SDK_JSON ? 'Var' : 'Yok');

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK_JSON);
  console.log('JSON parse başarılı');
} catch (e) {
  console.error('JSON parse hatası:', e);
  process.exit(1); // JSON parse edilemezse serverı kapat
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Firebase Admin SDK başlatılıyor
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const messaging = admin.messaging();

// Basit test endpointi
app.get('/', (req, res) => {
  res.send('FCM Notification Server çalışıyor!');
});

// Bildirim gönderme endpointi
app.post('/sendNotification', async (req, res) => {
  /*
    Beklenen JSON gövdesi:
    {
      "token": "alıcı_fcm_token",
      "title": "Bildirim Başlığı",
      "body": "Bildirim içeriği",
      "data": { "key1": "value1", ... } // opsiyonel
    }
  */

  const { token, title, body, data } = req.body;

  if (!token || !title || !body) {
    return res.status(400).send({ error: 'token, title ve body zorunludur.' });
  }

  const message = {
    token: token,
    notification: {
      title: title,
      body: body,
    },
    data: data || {},
  };

  try {
    const response = await messaging.send(message);
    console.log('Bildirim gönderildi:', response);
    res.send({ success: true, response });
  } catch (error) {
    console.error('Bildirim gönderme hatası:', error);
    res.status(500).send({ success: false, error: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
