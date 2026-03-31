const { GoogleGenerativeAI } = require('@google/generative-ai');

const loadKeys = () => {
  const keys = [];
  let i = 1;
  while (process.env[`GEMINI_KEY_${i}`]) {
    keys.push(process.env[`GEMINI_KEY_${i}`]);
    i++;
  }
  if (keys.length === 0) throw new Error('No Gemini API keys found in environment');
  return keys;
};

const keyState = {
  keys: [],
  currentIndex: 0,
  exhausted: new Set(),
  lastReset: new Date().toDateString()
};

const resetDailyIfNeeded = () => {
  const today = new Date().toDateString();
  if (keyState.lastReset !== today) {
    keyState.exhausted.clear();
    keyState.currentIndex = 0;
    keyState.lastReset = today;
    console.log('🔄 Gemini key rotation reset for new day');
  }
};

const getNextKey = () => {
  resetDailyIfNeeded();
  keyState.keys = loadKeys();

  const available = keyState.keys.filter((_, i) => !keyState.exhausted.has(i));
  if (available.length === 0) throw new Error('All Gemini API keys exhausted for today');

  while (keyState.exhausted.has(keyState.currentIndex)) {
    keyState.currentIndex = (keyState.currentIndex + 1) % keyState.keys.length;
  }

  const key = keyState.keys[keyState.currentIndex];
  keyState.currentIndex = (keyState.currentIndex + 1) % keyState.keys.length;
  return { key, index: keyState.currentIndex };
};

const markKeyExhausted = (index) => {
  keyState.exhausted.add(index);
  console.log(`⚠️ Gemini key ${index + 1} exhausted, switching to next`);
};

const callGemini = async (prompt, modelType = 'flash-lite', retries = 0) => {
  if (retries >= loadKeys().length) {
    throw new Error('All Gemini keys failed or exhausted');
  }

  const modelMap = {
    'flash-lite': 'gemini-2.0-flash-lite',
    'flash': 'gemini-2.0-flash',
    'pro': 'gemini-1.5-pro'
  };

  const { key, index } = getNextKey();

  try {
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({ model: modelMap[modelType] || modelMap['flash-lite'] });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    if (err.message?.includes('quota') || err.message?.includes('429') || err.status === 429) {
      markKeyExhausted(index);
      return callGemini(prompt, modelType, retries + 1);
    }
    throw err;
  }
};

const draftOutreachMessage = async (lead, portfolio, channel = 'email') => {
  const portfolioInfo = portfolio
    ? `The sender has a portfolio: "${portfolio.name}". ${portfolio.canva_link ? `Portfolio link: ${portfolio.canva_link}` : ''}`
    : 'No portfolio attached.';

  const prompt = `
You are drafting a professional outreach message for a web design freelancer based in Abuja, Nigeria.

Business to contact:
- Name: ${lead.business_name}
- Category: ${lead.category}
- Location: ${lead.address || lead.city}
- Rating: ${lead.rating || 'N/A'} stars, ${lead.review_count || 0} reviews
- Has website: No

Channel: ${channel === 'email' ? 'Email (formal but friendly)' : 'WhatsApp (conversational, shorter)'}
${portfolioInfo}

Write a ${channel === 'email' ? 'professional email' : 'WhatsApp message'} that:
1. Greets them by business name
2. Points out they don't have a website
3. Explains the benefit briefly (more customers, credibility)
4. Mentions the portfolio ${portfolio?.canva_link ? 'with the link' : ''}
5. Ends with a clear call to action

${channel === 'email' ? 'Include a subject line at the top formatted as "Subject: ..."' : 'Keep it under 200 words, conversational tone'}

Write ONLY the message, nothing else.
`;

  return callGemini(prompt, 'flash');
};

const draftReply = async (lead, incomingMessage, conversationHistory = []) => {
  const history = conversationHistory.map(m =>
    `${m.direction === 'inbound' ? 'Them' : 'You'}: ${m.content}`
  ).join('\n');

  const prompt = `
You are a web design freelancer in Abuja, Nigeria responding to a potential client.

Business: ${lead.business_name} (${lead.category})

Conversation so far:
${history}

Their latest message: "${incomingMessage}"

Write a professional, friendly reply that moves toward closing the deal or answers their question naturally.
Write ONLY the reply message, nothing else. Keep it concise.
`;

  return callGemini(prompt, 'flash');
};

const researchBusinessType = async (category, city) => {
  const prompt = `
Give me a brief strategy for finding ${category} businesses in ${city}, Nigeria that likely don't have websites.
Include: best search terms to use, typical characteristics, and a personalized pitch angle.
Keep it under 150 words. Be specific and practical.
`;
  return callGemini(prompt, 'flash-lite');
};

module.exports = { callGemini, draftOutreachMessage, draftReply, researchBusinessType };
