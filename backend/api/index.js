const express = require('express');
const cors = require('cors');
const supabase = require('../src/supabaseClient');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.get('/api', (req, res) => {
  res.json({ 
    status: 'success', 
    message: 'PromptTU Backend is running successfully on Vercel!',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', async (req, res) => {
  try {
    // Check if Supabase client is configured
    res.json({ 
      supabase_configured: !!supabase,
      message: 'Supabase integration ready.' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analytics', async (req, res) => {
  try {
    const { event_type, path, device, referrer, watchtower, metadata, user_id } = req.body;

    if (!event_type) {
      return res.status(400).json({ status: 'error', message: 'event_type is required' });
    }

    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client is not initialized' });
    }

    const { data, error } = await supabase
      .from('analytics_events')
      .insert([{
        event_type,
        path: path || null,
        device: device || null,
        referrer: referrer || null,
        watchtower: watchtower || null,
        metadata: metadata || null,
        user_id: user_id || null
      }])
      .select();

    if (error) {
      console.error('Supabase Error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    return res.status(201).json({ status: 'success', data });

  } catch (error) {
    console.error('Analytics Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Export app for Vercel Serverless
module.exports = app;
