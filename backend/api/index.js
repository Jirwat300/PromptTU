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
      supabase_configured: !!supabaseUrl && !!supabaseKey,
      message: 'Supabase integration ready.' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export app for Vercel Serverless
module.exports = app;
