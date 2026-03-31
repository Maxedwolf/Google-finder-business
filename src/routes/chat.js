const express = require('express');
const { callGemini, researchBusinessType } = require('../services/gemini');
const { startSearch } = require('../services/scraper');
const { pool } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

const parseCommand = (message) => {
  const lower = message.toLowerCase();

  const searchMatch = message.match(/(?:search for|find|look for)\s+(.+?)\s+in\s+(.+)/i);
  if (searchMatch) {
    return { type: 'search', category: searchMatch[1].trim(), city: searchMatch[2].trim() };
  }

  if (lower.includes('draft') || lower.includes('write message') || lower.includes('create message')) {
    return { type: 'draft' };
  }

  if (lower.includes('stats') || lower.includes('how many') || lower.includes('summary')) {
    return { type: 'stats' };
  }

  return { type: 'chat' };
};

// Main chat endpoint
router.post('/', auth, async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  try {
    const command = parseCommand(message);

    if (command.type === 'search') {
      const searchId = await startSearch(command.category, command.city);
      return res.json({
        reply: `🔍 Starting search for **${command.category}** in **${command.city}**...\n\nSearch ID: ${searchId}\n\nI'll find businesses without websites and add them to your leads table. Check back in a minute!`,
        action: { type: 'search', searchId }
      });
    }

    if (command.type === 'stats') {
      const stats = await pool.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'found') as new_leads,
          COUNT(*) FILTER (WHERE status = 'pending_review') as pending,
          COUNT(*) FILTER (WHERE status = 'sent') as sent,
          COUNT(*) FILTER (WHERE status = 'replied') as replied
        FROM leads
      `);
      const s = stats.rows[0];
      return res.json({
        reply: `📊 **Your Stats**\n\n👥 Total leads: ${s.total}\n🆕 New (not drafted): ${s.new_leads}\n⏳ Pending review: ${s.pending}\n📨 Sent: ${s.sent}\n💬 Replies: ${s.replied}`
      });
    }

    const systemContext = `You are an AI assistant built into a lead generation dashboard for a web design freelancer in Abuja, Nigeria.

You help them:
- Find businesses without websites (using the search command: "search for [category] in [city]")
- Draft outreach messages
- Manage their leads pipeline
- Give business advice

Keep responses concise and action-oriented. Be encouraging and practical.`;

    const conversationHistory = history.slice(-6).map(h =>
      `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
    ).join('\n');

    const fullPrompt = `${systemContext}\n\nConversation:\n${conversationHistory}\n\nUser: ${message}\n\nAssistant:`;

    const reply = await callGemini(fullPrompt, 'flash');
    res.json({ reply });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Research a business type
router.post('/research', auth, async (req, res) => {
  const { category, city = 'Abuja' } = req.body;
  try {
    const research = await researchBusinessType(category, city);
    res.json({ research });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
