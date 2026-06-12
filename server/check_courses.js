const Course = require('./models/course');
const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

const CLAUDE_API_URL = process.env.CLAUDE_API_URL || 'https://api.anthropic.com/v1/complete';
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

async function getClaudeResponse(prompt, model = process.env.CLAUDE_MODEL || 'claude-2') {
  if (!CLAUDE_API_KEY) return null;
  try {
    const resp = await axios.post(
      CLAUDE_API_URL,
      {
        model,
        prompt,
        max_tokens_to_sample: 300
      },
      {
        headers: {
          'Authorization': `Bearer ${CLAUDE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    return resp.data?.completion || null;
  } catch (err) {
    console.error('Claude API error:', err.response?.data || err.message);
    return null;
  }
}

mongoose.connect(process.env.MONGO_URI).then(async () => {
  const courses = await Course.find().populate('department');
  console.log('\n📚 Total courses:', courses.length);

  const byDept = {};
  courses.forEach(c => {
    const dept = c.department?.name || 'Unknown';
    if (!byDept[dept]) byDept[dept] = [];
    byDept[dept].push(c);
  });

  for (const [dept, courses] of Object.entries(byDept)) {
    console.log(`\n🏢 ${dept}:`);
    const byLevel = {};
    courses.forEach(c => {
      if (!byLevel[c.level]) byLevel[c.level] = [];
      byLevel[c.level].push(c);
    });

    for (const [level, crs] of Object.entries(byLevel)) {
      console.log(`  ${level}:`);
      for (const c of crs) {
        console.log(`    - ${c.code}: ${c.title} ${c.isPremium ? '(⭐ Premium)' : ''}`);

        if (CLAUDE_API_KEY) {
          const courseInfo = `Code: ${c.code}, Title: ${c.title}, Premium: ${c.isPremium ? 'Yes' : 'No'}`;
          const prompt = `Summarize the following course information in one short sentence: ${courseInfo}`;
          const summary = await getClaudeResponse(prompt);
          if (summary) console.log(`      Claude Summary: ${summary.replace(/\n/g, ' ')}`);
        }
      }
    }
  }

  process.exit(0);
}).catch(err => {
  console.error('Mongo connect error:', err.message || err);
  process.exit(1);
});
