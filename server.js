const express = require('express');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to sanitize phone numbers into 07XXXXXXXX or 2547XXXXXXXX
function formatPhone(phone) {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('254')) return cleaned;
  if (cleaned.startsWith('0')) return cleaned;
  if (cleaned.length === 9) return '0' + cleaned;
  return cleaned;
}

// Helper to delay execution (Rate limiting: 5 requests / min = 12000ms delay)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

app.post('/api/trigger-bulk-stk', async (req, res) => {
  const { numbers, amount, reference, description } = req.body;

  if (!numbers || !amount || !reference) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Parse phone numbers from textarea (line breaks or commas)
  const phoneList = numbers
    .split(/[\n,]+/)
    .map((num) => num.trim())
    .filter((num) => num.length > 0)
    .map(formatPhone);

  if (phoneList.length === 0) {
    return res.status(400).json({ error: 'No valid phone numbers provided' });
  }

  // Set response headers for Server-Sent Events (SSE) to stream logs live
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendLog = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendLog({ message: `Starting bulk STK push for ${phoneList.length} numbers...` });

  const RATE_LIMIT_DELAY = 12000; // 12 seconds per request = 5 requests / minute

  for (let i = 0; i < phoneList.length; i++) {
    const phone = phoneList[i];

    const payload = {
      amount: Number(amount),
      phone: phone,
      accountReference: reference,
      transactionDesc: description || `Payment for ${reference}`,
      channelId: process.env.PALPLUSS_CHANNEL_ID,
      callbackUrl: process.env.PALPLUSS_CALLBACK_URL,
    };

    try {
      const response = await axios.post(
        'https://api.palpluss.com/v1/payments/stk',
        payload,
        {
          headers: {
            'Authorization': `Basic ${process.env.PALPLUSS_BASIC_AUTH}`,
            'Content-Type': 'application/json',
          },
        }
      );

      sendLog({
        status: 'SUCCESS',
        phone: phone,
        response: response.data,
        index: i + 1,
        total: phoneList.length,
      });
    } catch (error) {
      sendLog({
        status: 'FAILED',
        phone: phone,
        error: error.response ? error.response.data : error.message,
        index: i + 1,
        total: phoneList.length,
      });
    }

    // Delay if there are remaining requests
    if (i < phoneList.length - 1) {
      sendLog({ message: `Rate limit buffer: Waiting 12 seconds before next request...` });
      await delay(RATE_LIMIT_DELAY);
    }
  }

  sendLog({ message: 'Bulk processing completed!' });
  res.end();
});

// Webhook endpoint to catch callback updates from Palpluss
app.post('/webhooks/mpesa', (req, res) => {
  console.log('--- Palpluss Webhook Callback Received ---');
  console.log(JSON.stringify(req.body, null, 2));
  res.status(200).json({ status: 'Success' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
