const express = require('express');
const { pool } = require('../db');
const { startSearch } = require('../services/scraper');
const { draftOutreachMessage } = require('../services/gemini');
const { notifyNewLeads } = require('../services/telegram');
const auth = require('../middleware/auth');

const router = express.Router();

// Get all leads with filters
router.get('/', auth, async (req, res) => {
  const { status, category, city, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  let query = 'SELECT * FROM leads WHERE 1=1';
  const params = [];

  if (status) { params.push(status); query += ` AND status = $${params.length}`; }
  if (category) { params.push(`%${category}%`); query += ` AND category ILIKE $${params.length}`; }
  if (city) { params.push(`%${city}%`); query += ` AND city ILIKE $${params.length}`; }

  query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  try {
    const result = await pool.query(query, params);
    const countResult = await pool.query('SELECT COUNT(*) FROM leads');
    res.json({ leads: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get lead stats for dashboard
router.get('/stats', auth, async (req, res) => {
  try {
    const stats = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'found') as new_leads,
        COUNT(*) FILTER (WHERE status = 'pending_review') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'replied') as replied
      FROM leads
    `);
    const searches = await pool.query('SELECT COUNT(*) FROM searches WHERE status = $1', ['completed']);
    res.json({ ...stats.rows[0], searches: searches.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start a new search
router.post('/search', auth, async (req, res) => {
  const { category, city = 'Abuja' } = req.body;
  if (!category) return res.status(400).json({ error: 'Category is required' });

  try {
    const searchId = await startSearch(category, city);
    res.json({ searchId, message: `Searching for ${category} in ${city}...` });

    setTimeout(async () => {
      const result = await pool.query('SELECT leads_found FROM searches WHERE id = $1', [searchId]);
      if (result.rows[0]?.leads_found > 0) {
        await notifyNewLeads(result.rows[0].leads_found, category, city);
      }
    }, 30000);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get search status
router.get('/search/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM searches WHERE id = $1', [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Search not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Draft AI messages for all leads in 'found' status
router.post('/draft-all', auth, async (req, res) => {
  const { portfolioId, channel = 'email' } = req.body;

  try {
    const leads = await pool.query("SELECT * FROM leads WHERE status = 'found' LIMIT 20");

    let portfolio = null;
    if (portfolioId) {
      const p = await pool.query('SELECT * FROM portfolios WHERE id = $1', [portfolioId]);
      portfolio = p.rows[0];
    }

    let drafted = 0;
    for (const lead of leads.rows) {
      try {
        const message = await draftOutreachMessage(lead, portfolio, channel);
        await pool.query(
          `INSERT INTO messages (lead_id, channel, content, status, portfolio_id)
           VALUES ($1, $2, $3, 'pending_review', $4)`,
          [lead.id, channel, message, portfolioId || null]
        );
        await pool.query("UPDATE leads SET status = 'pending_review' WHERE id = $1", [lead.id]);
        drafted++;
      } catch (err) {
        console.error(`Draft failed for lead ${lead.id}:`, err.message);
      }
    }

    res.json({ drafted, message: `${drafted} messages drafted and ready for review` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update lead status
router.patch('/:id', auth, async (req, res) => {
  const { status } = req.body;
  try {
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a lead
router.delete('/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM leads WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
