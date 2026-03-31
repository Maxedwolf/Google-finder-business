const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let client = null;
let qrCodeData = null;
let status = 'disconnected';

const getStatus = () => ({ status, qrCode: qrCodeData });

const initialize = () => {
  if (client) return;

  status = 'initializing';
  qrCodeData = null;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: './whatsapp-session' }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    }
  });

  client.on('qr', async (qr) => {
    console.log('📱 WhatsApp QR code generated');
    status = 'qr_ready';
    qrCodeData = await qrcode.toDataURL(qr);
  });

  client.on('ready', () => {
    console.log('✅ WhatsApp connected!');
    status = 'connected';
    qrCodeData = null;
  });

  client.on('authenticated', () => {
    console.log('🔐 WhatsApp authenticated');
    status = 'authenticated';
  });

  client.on('auth_failure', () => {
    console.log('❌ WhatsApp auth failed');
    status = 'failed';
    client = null;
  });

  client.on('disconnected', (reason) => {
    console.log('📵 WhatsApp disconnected:', reason);
    status = 'disconnected';
    client = null;
    qrCodeData = null;
  });

  client.initialize().catch(err => {
    console.error('WhatsApp init error:', err.message);
    status = 'failed';
    client = null;
  });
};

const formatPhoneNumber = (phone) => {
  let cleaned = phone.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.slice(1);
  } else if (!cleaned.startsWith('234') && cleaned.length === 10) {
    cleaned = '234' + cleaned;
  }

  return cleaned + '@c.us';
};

const sendMessage = async (phone, message) => {
  if (!client || status !== 'connected') {
    throw new Error('WhatsApp not connected. Please scan QR code first.');
  }

  const chatId = formatPhoneNumber(phone);

  const delay = Math.floor(Math.random() * 3000) + 1000;
  await new Promise(r => setTimeout(r, delay));

  await client.sendMessage(chatId, message);
  return true;
};

const disconnect = () => {
  if (client) {
    client.destroy();
    client = null;
    status = 'disconnected';
    qrCodeData = null;
  }
};

module.exports = { initialize, getStatus, sendMessage, disconnect };
