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
  const { token, data } = req.body;

  if (!token || !data) {
    return res.status(400).send({ error: 'Token ve data zorunludur' });
  }

  try {
    let notificationTitle = "Yeni Bildirim";
    let notificationBody = "Etkileşim aldınız";

    if (data.type === 'chat') {
      notificationTitle = data.senderName || "Yeni Mesaj";
      notificationBody = data.content || "Mesajınız var";
    } else if (data.type === 'forum_comment') {
      notificationTitle = "Yeni Yorum";
      notificationBody = `${data.senderName} gönderinize yorum yaptı`;
    } else if (data.type === 'comment') {
      notificationTitle = "Yeni Yorum";
      notificationBody = `${data.senderName} yorum yaptı`;
    }

    const message = {
      token: token,
      notification: {
        title: notificationTitle,
        body: notificationBody
      },
      data: data
    };

    const response = await messaging.send(message);
    res.send({ success: true, response });
  } catch (error) {
    console.error('Bildirim gönderme hatası:', error);
    res.status(500).send({ success: false, error: error.message });
  }
});

// --- 1 gün öncesi ve gününde hatırlatma göndermek için cron job ---

// Her gün saat 09:00'da çalışsın
cron.schedule('*/5 * * * *', async () => {
  console.log('Hatırlatıcı kontrolü başladı:', new Date());

  try {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0); // Bugünün başlangıcı (lokal saat)

    // Tarih aralıkları için Timestamp oluştur
    const oneDay = 24 * 60 * 60 * 1000;
    const tomorrow = new Date(today.getTime() + oneDay);
    const dayAfterTomorrow = new Date(today.getTime() + 2 * oneDay);

    // Firestore Timestamp nesneleri oluştur
    const todayStart = admin.firestore.Timestamp.fromDate(today);
    const todayEnd = admin.firestore.Timestamp.fromDate(new Date(today.getTime() + oneDay));
    const tomorrowStart = admin.firestore.Timestamp.fromDate(tomorrow);
    const tomorrowEnd = admin.firestore.Timestamp.fromDate(dayAfterTomorrow);

    // Bugünkü randevular
    const todaySnapshot = await firestore.collection('appointments')
      .where('appointmentDate', '>=', todayStart)
      .where('appointmentDate', '<', todayEnd)
      .get();

    // Yarınki randevular
    const tomorrowSnapshot = await firestore.collection('appointments')
      .where('appointmentDate', '>=', tomorrowStart)
      .where('appointmentDate', '<', tomorrowEnd)
      .get();

    const docs = [...todaySnapshot.docs, ...tomorrowSnapshot.docs];

    for (const doc of docs) {
      const appointment = doc.data();
      const userId = appointment.userId;

      // Kullanıcıyı ve FCM token'ını al
      const userDoc = await firestore.collection('users').doc(userId).get();
      if (!userDoc.exists) continue;

      const userData = userDoc.data();
      const fcmToken = userData?.fcmToken;
      
      if (!fcmToken) {
        console.log(`FCM token bulunamadı: ${userId}`);
        continue;
      }

      // Bildirim içeriği
      const apptDate = appointment.appointmentDate.toDate();
      const diffDays = Math.floor((apptDate - today) / oneDay);
      
      let title, body;
      if (diffDays === 0) {
        title = "Randevu Bugün!";
        body = `"${appointment.note}" randevunuz bugün.`;
      } else if (diffDays === 1) {
        title = "Randevu Yarın!";
        body = `"${appointment.note}" randevunuz yarın.`;
      } else {
        continue;
      }

      // FCM gönderimi
      await messaging.send({
        token: fcmToken,
        notification: { title, body },
        data: {
          appointmentId: doc.id,
          type: 'appointment_reminder'
        }
      });
      console.log(`Bildirim gönderildi: ${userId} - ${body}`);
    }
  } catch (error) {
    console.error('Cron job hatası:', error);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Sunucu ${PORT} portunda çalışıyor...`);
});
