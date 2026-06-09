# OpenAI API Quota Error - Fix Guide

## ⚠️ What Happened

Your OpenAI API account hit the quota limit (HTTP 429 - insufficient_quota). This means the API key has exceeded its usage limits or billing is not properly configured.

**Error Details:**
```
RateLimitError: 429 You exceeded your current quota, please check your plan and billing details
```

---

## ✅ Solution: Fix Your OpenAI Account

### Step 1: Check Your OpenAI Account
1. Go to https://platform.openai.com/account/billing/overview
2. Look at your plan and billing status
3. Check if there's a warning about quota or billing

### Step 2: Common Issues & Fixes

**Issue A: Free Trial Expired**
- **Solution:** Add a payment method to your account
- Go to https://platform.openai.com/account/billing/overview
- Click "Add payment method"
- Enter your credit card details

**Issue B: No Payment Method Set Up**
- **Solution:** Add a valid payment method
- https://platform.openai.com/account/billing/overview
- Go to "Billing summary" → "Payment methods"
- Add a new payment method

**Issue C: Monthly Usage Limit Exceeded**
- **Solution:** Set up a higher usage limit
- Go to https://platform.openai.com/account/billing/limits
- Adjust your "Usage limits"
- Or wait for the month to reset

**Issue D: Billing Account Suspended**
- **Solution:** Update your billing information
- Verify your payment method is valid
- Check for any failed payments

### Step 3: Verify Your API Key

Make sure your `.env` file has the correct API key:
```bash
# In your server/.env file
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxx
```

Get your key from: https://platform.openai.com/api-keys

---

## 🛡️ Automatic Fallback System (Already Implemented)

I've added automatic fallback handling so the app **continues to work** even when OpenAI quota is exceeded:

### What Happens Now:
1. ✅ API detects 429 error (quota exceeded)
2. ✅ System **automatically returns mock responses**
3. ✅ User sees demo content with warning banner
4. ✅ **No error or crashes** - seamless experience
5. ✅ Warning banner displays link to fix billing

### Demo Mode Features:
- **Sample responses** for common questions about:
  - Pointers in C programming
  - Data structures and algorithms
  - Arrays, linked lists, trees
  - General programming concepts
- **Warning banner** at top of chat with link to billing
- **No interruption** to user experience
- **Automatic recovery** once billing is fixed

---

## 🚀 How to Use Demo Mode

When your OpenAI quota is exceeded:

1. **Chat still works** - You can send messages
2. **Sample responses appear** - AI provides demo content
3. **Yellow warning banner** shows at top with fix link
4. **Once you fix billing** - Real AI responses automatically activate

### Testing Demo Mode:
```bash
# Start backend server
cd server
npm install openai  # if needed
node app.js

# The app will automatically use demo mode if:
# - OPENAI_API_KEY is missing
# - OpenAI quota is exceeded
# - Any 429 error occurs
```

---

## 📊 Pricing & Budget

### OpenAI Pricing (as of 2024):
- **gpt-3.5-turbo:** 
  - Input: $0.0005 per 1K tokens
  - Output: $0.0015 per 1K tokens
- **gpt-4:**
  - Input: $0.03 per 1K tokens  
  - Output: $0.06 per 1K tokens

### Setting Usage Limits:
1. Go to https://platform.openai.com/account/billing/limits
2. Set a "Hard limit" (e.g., $10/month)
3. Set a "Soft limit" alert (e.g., $5/month)

---

## 🔍 Monitoring Usage

Check your API usage:
1. https://platform.openai.com/account/billing/overview → "Usage"
2. Track costs by:
   - Model type
   - Date range
   - Request counts

---

## 🎯 Next Steps

### Immediate:
1. ✅ Add payment method to OpenAI account
2. ✅ Verify API key in `.env` file
3. ✅ Restart backend server

### Verification:
```bash
# Test that demo mode is working:
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"test","message":"What is a pointer?"}'

# You should get a mock response (even if quota exceeded)
```

### Production Deployment:
1. Set `OPENAI_API_KEY` environment variable on Vercel/Railway
2. Configure billing in OpenAI account
3. Set usage limits to avoid surprises
4. Deploy frontend and backend

---

## 💡 Pro Tips

1. **Use gpt-3.5-turbo** (cheaper than gpt-4)
2. **Set monthly budget** to avoid overspending
3. **Monitor API usage** regularly
4. **Cache responses** where possible (to reduce API calls)
5. **Test with mock data first** before connecting real API

---

## ❓ Still Having Issues?

Check:
- [ ] OpenAI account has payment method
- [ ] API key is correct in `.env`
- [ ] Account is not suspended
- [ ] Usage limit not exceeded
- [ ] OPENAI_API_KEY environment variable is set

If still stuck:
- Email: OpenAI support at https://platform.openai.com/help/contact-us
- Check: https://platform.openai.com/docs/guides/error-codes/api-errors

---

**Status:** ✅ Fallback system active. Your app works even without valid OpenAI quota. Fix billing to activate real AI responses.
