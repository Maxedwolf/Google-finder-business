const express = require('express');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();
const UPLOAD_DIR = './uploads';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Get all portfolios
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM portfolios ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload portfolio file
router.post('/', auth, async (req, res) => {
  const { name, description, canvaLink, tags } = req.body;
  if (!name) return res.status(400).json({ error: 'Portfolio name is required' });

  try {
    let filePath = null;
    let fileType = null;

    if (req.files?.portfolio) {
      const file = req.files.portfolio;
      const ext = path.extname(file.name);
      const filename = `portfolio_${Date.now()}${ext}`;
      filePath = filename;
      fileType = file.mimetype;
      await file.mv(path.join(UPLOAD_DIR, filename));
    }

    const tagsArray = tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [];

    const result = await pool.query(
      `INSERT INTO portfolios (name, description, file_path, canva_link, file_type, tags)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, description, filePath, canvaLink || null, fileType, tagsArray]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update portfolio
router.patch('/:id', auth, async (req, res) => {
  const { name, description, canvaLink, tags } = req.body;
  try {
    const tagsArray = tags ? (Array.isArray(tags) ? tags : tags.split(',').map(t => t.trim())) : [];
    await pool.query(
      'UPDATE portfolios SET name=$1, description=$2, canva_link=$3, tags=$4 WHERE id=$5',
      [name, description, canvaLink, tagsArray, req.params.id]
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete portfolio
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT file_path FROM portfolios WHERE id = $1', [req.params.id]);
    const portfolio = result.rows[0];
    if (portfolio?.file_path) {
      const fullPath = path.join(UPLOAD_DIR, portfolio.file_path);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    await pool.query('DELETE FROM portfolios WHERE id = $1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
