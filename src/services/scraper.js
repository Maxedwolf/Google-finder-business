const axios = require('axios');
const { pool } = require('../db');

const MAPS_API_KEY = () => process.env.GOOGLE_MAPS_API_KEY;

const searchBusinesses = async (category, city, searchId) => {
  const query = `${category} in ${city}`;
  let allPlaces = [];
  let nextPageToken = null;
  let page = 0;

  try {
    do {
      const params = {
        query,
        key: MAPS_API_KEY(),
        ...(nextPageToken && { pagetoken: nextPageToken })
      };

      if (nextPageToken) await new Promise(r => setTimeout(r, 2000));

      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/textsearch/json',
        { params }
      );

      const data = response.data;
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        throw new Error(`Google Places API error: ${data.status} - ${data.error_message || ''}`);
      }

      allPlaces = [...allPlaces, ...(data.results || [])];
      nextPageToken = data.next_page_token;
      page++;

    } while (nextPageToken && page < 3);

    const leadsWithoutWebsite = allPlaces.filter(place => !place.website);
    const leadsWithDetails = await enrichWithDetails(leadsWithoutWebsite.slice(0, 20));
    const saved = await saveLeads(leadsWithDetails, category, city);

    await pool.query(
      'UPDATE searches SET leads_found = $1, status = $2 WHERE id = $3',
      [saved, 'completed', searchId]
    );

    return { found: allPlaces.length, noWebsite: leadsWithoutWebsite.length, saved };

  } catch (err) {
    await pool.query('UPDATE searches SET status = $1 WHERE id = $2', ['failed', searchId]);
    throw err;
  }
};

const enrichWithDetails = async (places) => {
  const enriched = [];

  for (const place of places) {
    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/place/details/json',
        {
          params: {
            place_id: place.place_id,
            fields: 'name,formatted_phone_number,formatted_address,rating,user_ratings_total,website,types',
            key: MAPS_API_KEY()
          }
        }
      );

      const details = response.data.result || {};
      if (details.website) continue;

      enriched.push({
        business_name: details.name || place.name,
        address: details.formatted_address || place.formatted_address,
        phone: details.formatted_phone_number || null,
        email: null,
        rating: details.rating || place.rating || null,
        review_count: details.user_ratings_total || place.user_ratings_total || 0,
        has_website: false,
        place_id: place.place_id
      });

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`Failed to get details for ${place.name}:`, err.message);
    }
  }

  return enriched;
};

const saveLeads = async (leads, category, city) => {
  let saved = 0;

  for (const lead of leads) {
    try {
      await pool.query(
        `INSERT INTO leads (business_name, address, phone, email, category, city, has_website, rating, review_count, place_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'found')
         ON CONFLICT (place_id) DO NOTHING`,
        [lead.business_name, lead.address, lead.phone, lead.email,
         category, city, false, lead.rating, lead.review_count, lead.place_id]
      );
      saved++;
    } catch (err) {
      console.error(`Failed to save lead ${lead.business_name}:`, err.message);
    }
  }

  return saved;
};

const startSearch = async (category, city) => {
  const result = await pool.query(
    'INSERT INTO searches (query, city, category, status) VALUES ($1, $2, $3, $4) RETURNING id',
    [`${category} in ${city}`, city, category, 'running']
  );
  const searchId = result.rows[0].id;

  searchBusinesses(category, city, searchId).catch(err => {
    console.error('Search error:', err.message);
  });

  return searchId;
};

module.exports = { startSearch, searchBusinesses };
