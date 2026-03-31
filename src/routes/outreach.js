const express = require('express');
const { pool } = require('../db');
const { sendEmail } = require('../services/gmail');
const { sendMessage: sendWhatsApp, getStatus: getWhatsAppStatus } = require('../services/whatsapp');
const { draftReply } = require('../services/gemini');
const { notifyReply } = require('../services/telegram');
const auth = require('../middleware/auth');
const path = require('path');

const router = express.Router();

// Get all messages pending review
router.get('/pending', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, l.business_name, l.phone, l.email, l.category, l.city, l.address
      FROM messages m
      JOIN leads l ON m.lead_id = l.id
      WHERE m.status = 'pending_review' AND m.direction = 'outbound'
      ORDER BY m.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all sent messages
router.get('/sent', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, l.business_name, l.phone, l.email
      FROM messages m
      JOIN leads l ON m.lead_id = l.id
      WHERE m.status = 'sent'
      ORDER BY m.sent_at DESC
      LIMIT 100
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get replies pending approval
router.get('/replies', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, l.business_name, l.phone, l.email
      FROM messages m
      JOIN leads l ON m.lead_id = l.id
      WHERE m.direction = 'inbound' OR (m.direction = 'outbound' AND m.status = 'pending_review' AND m.ai_draft = true AND m.lead_id IN (
        SELECT DISTINCT lead_id FROM messages WHERE direction = 'inbound'
      ))
      ORDER BY m.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit message content before sending
router.patch('/:id/edit', auth, async (req, res) => {
  const { content } = req.body;
  try {
    await pool.query('UPDATE messages SET content = $1 WHERE id = $2', [content, req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve a single message
router.patch('/:id/approve', auth, async (req, res) => {
  try {
    await pool.query('UPDATE messages SET status = $1 WHERE id = $2', ['approved', req.params.id]);
    res.json({ message: 'Approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Skip/reject a message
router.patch('/:id/skip', auth, async (req, res) => {
  try {
    await pool.query('UPDATE messages SET status = $1 WHERE id = $2', ['skipped', req.params.id]);
    await pool.query(
      "UPDATE leads SET status = 'found' WHERE id = (SELECT lead_id FROM messages WHERE id = $1)",
      [req.params.id]
    );
    res.json({ message: 'Skipped' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve all pending messages
router.post('/approve-all', auth, async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE messages SET status = 'approved' WHERE status = 'pending_review' RETURNING id"
    );
    res.json({ approved: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send all approved messages
router.post('/send-approved', auth, async (req, res) => {
  try {
    const messages = await pool.query(`
      SELECT m.*, l.business_name, l.phone, l.email, p.file_path, p.canva_link, p.name as portfolio_name
      FROM messages m
      JOIN leads l ON m.lead_id = l.id
      LEFT JOIN portfolios p ON m.portfolio_id = p.id
      WHERE m.status = 'approved'
      LIMIT 50
    `);

    let sent = 0, failed = 0;

    for (const msg of messages.rows) {
      try {
        if (msg.channel === 'email' && msg.email) {
          await sendEmail({
            to: msg.email,
            content: msg.content,
            portfolioPath: msg.file_path ? path.join('./uploads', msg.file_path) : null,
            portfolioName: msg.portfolio_name,
            canvaLink: msg.canva_link
          });
        } else if (msg.channel === 'whatsapp' && msg.phone) {
          let waMessage = msg.content;
          if (msg.canva_link) waMessage += `\n\n📁 Portfolio: ${msg.canva_link}`;
          await sendWhatsApp(msg.phone, waMessage);
        }

        await pool.query(
          "UPDATE messages SET status = 'sent', sent_at = NOW() WHERE id = $1",
          [msg.id]
        );
        await pool.query("UPDATE leads SET status = 'sent' WHERE id = $1", [msg.lead_id]);
        sent++;

        await new Promise(r => setTimeout(r, Math.random() * 2000 + 1000));
      } catch (err) {
        console.error(`Send failed for message ${msg.id}:`, err.message);
        await pool.query("UPDATE messages SET status = 'failed' WHERE id = $1", [msg.id]);
        failed++;
      }
    }

    res.json({ sent, failed, message: `${sent} messages sent, ${failed} failed` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record an incoming reply and draft AI response
router.post('/incoming', auth, async (req, res) => {
  const { leadId, content, channel } = req.body;

  try {
    await pool.query(
      "INSERT INTO messages (lead_id, channel, direction, content, ai_draft, status) VALUES ($1, $2, 'inbound', $3, false, 'received')",
      [leadId, channel, content]
    );
    await pool.query("UPDATE leads SET status = 'replied' WHERE id = $1", [leadId]);

    const lead = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId]);
    const history = await pool.query(
      "SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at ASC",
      [leadId]
    );

    const aiReply = await draftReply(lead.rows[0], content, history.rows);

    await pool.query(
      "INSERT INTO messages (lead_id, channel, direction, content, ai_draft, status) VALUES ($1, $2, 'outbound', $3, true, 'pending_review')",
      [leadId, channel, aiReply]
    );

    await notifyReply(lead.rows[0].business_name, channel);

    res.json({ message: 'Reply received and AI draft created for review' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// WhatsApp status
router.get('/whatsapp-status', auth, (req, res) => {
  res.json(getWhatsAppStatus());
});

module.exports = router;
