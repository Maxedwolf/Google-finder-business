const express = require('express');
const { verifyConnection } = require('../services/gmail');
const { initialize, getStatus, disconnect } = require('../services/whatsapp');
const auth = require('../middleware/auth');

const router = express.Router();

// Test Gmail connection
router.post('/test-gmail', auth, async (req, res) => {
  try {
    await verifyConnection();
    res.json({ success: true, message: 'Gmail connected successfully!' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Initialize WhatsApp and get QR code
router.post('/whatsapp/connect', auth, (req, res) => {
  initialize();
  res.json({ message: 'WhatsApp initialization started. QR code will appear shortly.' });
});

// Get WhatsApp status and QR code
router.get('/whatsapp/status', auth, (req, res) => {
  res.json(getStatus());
});

// Disconnect WhatsApp
router.post('/whatsapp/disconnect', auth, (req, res) => {
  disconnect();
  res.json({ message: 'WhatsApp disconnected' });
});

// Check which Gemini keys are configured
router.get('/gemini-keys', auth, (req, res) => {
  const keys = [];
  let i = 1;
  while (process.env[`GEMINI_KEY_${i}`]) {
    keys.push({ index: i, configured: true, preview: `...${process.env[`GEMINI_KEY_${i}`].slice(-6)}` });
    i++;
  }
  res.json({ keys, total: keys.length });
});

module.exports = router;
