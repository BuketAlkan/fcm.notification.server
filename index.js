const express = require('express');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const cors = require('cors');
const cron = require('node-cron');  // node-cron eklendi
require('dotenv').config();

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_SDK_JSON);
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
} catch (e) {
  console.error('JSON parse hatası:', e);
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(bodyParser.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const messaging = admin.messaging();
const firestore = admin.firestore();

// Test endpoint
app.get('/', (req, res) => {
  res.send('FCM Notification Server çalışıyor!');
});

// Bildirim gönderme endpointi
app.post('/sendNotification', async (req, res) => {
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

// --- 1 gün öncesi ve gününde hatırlatma göndermek için cron job ---

// Her gün saat 09:00'da çalışsın
cron.schedule('0 9 * * *', async () => {
  console.log('Hatırlatıcı kontrolü başladı:', new Date());

  try {
    const now = new Date();
    const oneDayLater = new Date(now);
    oneDayLater.setDate(oneDayLater.getDate() + 1);

    // Timestamp olarak kullanmak için
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const tomorrowStart = new Date(oneDayLater.getFullYear(), oneDayLater.getMonth(), oneDayLater.getDate());
    const tomorrowEnd = new Date(tomorrowStart);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    // 1 gün öncesi hatırlatma alacaklar
    const snapshot1 = await firestore.collection('appointments')
      .where('appointmentDate', '>=', tomorrowStart)
      .where('appointmentDate', '<', tomorrowEnd)
      .get();

    // O gün hatırlatma alacaklar
    const snapshot2 = await firestore.collection('appointments')
      .where('appointmentDate', '>=', todayStart)
      .where('appointmentDate', '<', todayEnd)
      .get();

    // İki listeyi birleştir
    const docs = [...snapshot1.docs, ...snapshot2.docs];

    for (const doc of docs) {
      const appointment = doc.data();

      // Kullanıcının FCM token'ını al
      const userId = appointment.userId;
      const userDoc = await firestore.collection('users').doc(userId).get();
      if (!userDoc.exists) continue;

      const user = userDoc.data();
      const fcmToken = user?.fcmToken;
      if (!fcmToken) continue;

      // Hangi gün hatırlatma olduğunu belirle
      const apptDate = appointment.appointmentDate.toDate();
      let daysLeft = Math.floor((apptDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let title = 'Veteriner Randevusu Hatırlatması';
      let body = '';

      if (daysLeft === 1) {
        body = `Yarın "${appointment.note}" randevunuz var.`;
      } else if (daysLeft === 0) {
        body = `Bugün "${appointment.note}" randevunuz var.`;
      } else {
        continue; // sadece bugün ve yarına ait bildirim gönder
      }

      const message = {
        token: fcmToken,
        notification: {
          title: title,
          body: body,
        },
        data: {
          appointmentId: doc.id,
          type: 'appointment_reminder',
        },
      };

      await messaging.send(message);
      console.log(`Bildirim gönderildi: ${userId} - ${body}`);
    }

  } catch (error) {
    console.error('Cron job hata:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
