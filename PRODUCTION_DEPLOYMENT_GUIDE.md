# 🚀 Production Deployment Guide

**Academic Success Suite - Ready for Production Testing**

---

## 📋 Table of Contents
1. [Pre-Deployment Verification](#pre-deployment-verification)
2. [Environment Configuration](#environment-configuration)
3. [Database Setup](#database-setup)
4. [Backend Deployment](#backend-deployment)
5. [Frontend Deployment](#frontend-deployment)
6. [Post-Deployment Testing](#post-deployment-testing)
7. [Monitoring & Maintenance](#monitoring--maintenance)

---

## ✅ Pre-Deployment Verification

Run this command to verify all components are in place:

```bash
node SETUP_AND_TEST_GUIDE.js
```

**Expected output:**
- ✓ All 6 database models created
- ✓ API routes (ai.js, analytics.js) mounted
- ✓ OpenAI utility configured
- ✓ Frontend components built
- ✓ All dependencies installed

---

## ⚙️ Environment Configuration

### Step 1: Get OpenAI API Key
1. Visit https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (you won't see it again)

### Step 2: Update server/.env
```
OPENAI_API_KEY=sk_your_actual_key_here
```

### Complete .env Variables (All Must Be Set)
```env
# Server
PORT=5000
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com

# Database
MONGO_URI=your_mongodb_connection_string

# Authentication
JWT_SECRET=your_random_jwt_secret_min_32_chars
JWT_REFRESH_SECRET=your_random_refresh_secret_min_32_chars

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# Payments
PAYSTACK_SECRET_KEY=your_paystack_secret_key
PAYSTACK_PUBLIC_KEY=your_paystack_public_key

# Email
SENDGRID_API_KEY=your_sendgrid_api_key
# OR use SMTP:
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# AI Features
OPENAI_API_KEY=sk_your_openai_api_key
```

### Verify .env Is Secure
```bash
# Add to .gitignore (if not already there)
echo ".env" >> .gitignore
echo ".env.local" >> .gitignore
```

---

## 🗄️ Database Setup

### MongoDB Atlas Configuration

#### 1. Network Access
```
1. Login to MongoDB Atlas
2. Go to Security → Network Access
3. Add IP address or allow all (0.0.0.0/0)
4. Click "Confirm"
```

#### 2. Create Database Indexes
These will be automatically created on first model access, but you can manually verify:

```javascript
// Run in MongoDB Shell or MongoDB Compass
db.aiconversations.createIndex({ user: 1, course: 1, createdAt: -1 });
db.aiconversations.createIndex({ user: 1, createdAt: -1 });

db.studentnotes.createIndex({ user: 1, course: 1, createdAt: -1 });
db.studentnotes.createIndex({ user: 1, createdAt: -1 });

db.studentperformances.createIndex({ user: 1, course: 1 });
db.studentperformances.createIndex({ user: 1 });
db.studentperformances.createIndex({ "topicMetrics.topic": 1 });

db.pastquestionexplanations.createIndex({ question: 1 });
db.pastquestionexplanations.createIndex({ createdAt: -1 });

db.learningpaths.createIndex({ user: 1, course: 1 });
db.learningpaths.createIndex({ user: 1, createdAt: -1 });

db.questionexplanationcaches.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
```

#### 3. Enable Backups
```
1. Go to Backup → Continuous Backup
2. Toggle "Continuous Backup"
3. Set retention to 30 days
```

---

## 🔧 Backend Deployment

### Option 1: Deploy to Vercel (Recommended for Node.js)

```bash
# Install Vercel CLI
npm install -g vercel

# In server directory
cd server

# Deploy
vercel --prod

# Follow prompts to link to project
```

### Option 2: Deploy to Render

1. Push code to GitHub
2. Visit https://render.com/
3. Click "New+" → "Web Service"
4. Connect GitHub repository
5. Configure:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Environment Variables: Add all from .env
6. Click "Deploy"

### Option 3: Deploy to Railway

1. Visit https://railway.app/
2. Click "Create New Project"
3. Select "Deploy from GitHub"
4. Connect your repo
5. Add environment variables
6. Railway auto-detects Node.js and deploys

### Option 4: Deploy to Heroku

```bash
# Install Heroku CLI
npm install -g heroku

# Login
heroku login

# Create app
heroku create your-app-name

# Add environment variables
heroku config:set OPENAI_API_KEY=sk_...
heroku config:set MONGO_URI=...
# ... other variables

# Deploy
git push heroku main
```

### Post-Deployment Backend Verification
```bash
# Test health endpoint
curl https://your-backend-domain.com/api/quiz/health

# Expected response:
{
  "success": true,
  "service": "quiz",
  "status": "ok",
  "timestamp": "2026-06-09T..."
}
```

---

## 🎨 Frontend Deployment

### Option 1: Deploy to Vercel (Easiest for React)

```bash
# In frontend directory
cd frontend

# Install Vercel CLI (if not already)
npm install -g vercel

# Deploy
vercel --prod

# Set environment variables:
# VITE_API_URL=https://your-backend-domain.com/api
```

### Option 2: Deploy to Netlify

```bash
# Build first
cd frontend
npm run build

# Method 1: CLI
npm install -g netlify-cli
netlify deploy --prod --dir=dist

# Method 2: GitHub integration
# 1. Push to GitHub
# 2. Login to Netlify
# 3. New site from Git
# 4. Select repo
# 5. Build command: npm run build
# 6. Publish directory: dist
# 7. Add environment variables
# 8. Deploy
```

### Option 3: Deploy to GitHub Pages

```bash
# Add to frontend/package.json:
"homepage": "https://yourusername.github.io/academy-platform"

# Add deploy script:
"scripts": {
  "deploy": "npm run build && gh-pages -d dist"
}

# Deploy
npm run deploy
```

### Post-Deployment Frontend Verification
```bash
# Check that app loads at your URL
https://your-frontend-domain.com

# Verify environment variable is set
Open browser console and check:
- VITE_API_URL should point to your backend
- No CORS errors
- API calls successful
```

---

## 🧪 Post-Deployment Testing

### 1. Test API Endpoints
Use these curl commands to verify all endpoints work:

```bash
# Set variables
BACKEND_URL="https://your-backend-domain.com"
TOKEN="your_jwt_token_from_login"
COURSE_ID="your_course_id_from_db"

# Test 1: Chat endpoint
curl -X POST $BACKEND_URL/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"courseId":"'$COURSE_ID'","message":"Hello"}'

# Test 2: Analytics endpoint
curl -X GET $BACKEND_URL/api/analytics/performance/$COURSE_ID \
  -H "Authorization: Bearer $TOKEN"

# Test 3: Health check
curl $BACKEND_URL/api/quiz/health
```

### 2. Test Frontend Features
- [ ] Login/register works
- [ ] Can access AI Chat page
- [ ] Can access Analytics page
- [ ] Course selector works
- [ ] Sending chat message works
- [ ] Premium gating works (free users blocked)
- [ ] Responsive on mobile
- [ ] No console errors

### 3. Test Premium Features
```bash
# Create test user with premium subscription
db.users.updateOne(
  { email: "test@example.com" },
  { $set: { subscriptionType: "premium" } }
)

# Verify AI features now accessible
```

### 4. Monitor API Usage
```bash
# Check OpenAI API usage
curl -X GET $BACKEND_URL/api/ai/usage/stats \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Expected response:
{
  "success": true,
  "totalTokensUsed": 1250,
  "estimatedCost": 0.45,
  "breakdown": {
    "chatMessages": 850,
    "noteEnhancements": 300,
    "questionExplanations": 100
  }
}
```

---

## 📊 Monitoring & Maintenance

### Weekly Checks
```bash
# Monitor API costs
- Check OpenAI dashboard for usage
- Compare against budget
- Alert if trending over expected

# Database performance
- Check slow query logs
- Verify indexes are used
- Monitor connection pool

# Error logs
- Check application logs
- Fix any 5xx errors
- Monitor 4xx rate
```

### Monthly Tasks
```bash
# Database maintenance
- Run backups verification
- Check storage usage
- Archive old conversations (>3 months)

# Performance review
- Analyze API response times
- Check database query performance
- Review user feedback

# Security audit
- Rotate API keys
- Review access logs
- Update dependencies
```

### Cost Optimization
```bash
# OpenAI API
- Monitor cost per user (target: $0.05/month)
- Consider implementing caching
- Batch API calls where possible
- Use gpt-3.5-turbo instead of gpt-4

# Database
- MongoDB: Free tier up to 500MB
- After that: ~$9/month for M2 tier
- Optimize indexes to reduce queries

# Hosting
- Backend: Free tier often sufficient
- Frontend: Vercel free tier sufficient
- Total: $0-50/month until significant scale
```

### Scaling Strategy
```
Phase 1 (0-1000 users): Current setup sufficient
Phase 2 (1000-10k): Add Redis caching, optimize queries
Phase 3 (10k-100k): Database replication, CDN, rate limiting
Phase 4 (100k+): Microservices, dedicated database, load balancing
```

---

## 🔑 Important Security Notes

### Before Going Live
- [ ] Change all default passwords
- [ ] Regenerate JWT secrets
- [ ] Update CORS origins (remove localhost)
- [ ] Enable HTTPS only (force redirect)
- [ ] Set secure cookie flags
- [ ] Enable rate limiting
- [ ] Hide server version headers
- [ ] Enable HSTS headers
- [ ] Implement CSRF protection
- [ ] Scan for vulnerabilities: `npm audit`

### Regular Security
- [ ] Monitor for unauthorized access
- [ ] Review API logs weekly
- [ ] Keep dependencies updated
- [ ] Rotate API keys quarterly
- [ ] Audit database access
- [ ] Test authentication flow monthly

---

## 📞 Support Resources

### Documentation
- [OpenAI API Docs](https://platform.openai.com/docs/api-reference)
- [MongoDB Documentation](https://docs.mongodb.com)
- [Express.js Guide](https://expressjs.com)
- [React Documentation](https://react.dev)

### Debugging
- Check server logs: `vercel logs` or `heroku logs --tail`
- Check frontend console: Browser DevTools
- Monitor API: Postman or Thunder Client
- Database queries: MongoDB Compass

### Getting Help
1. Check [IMPLEMENTATION_COMPLETE.md](./IMPLEMENTATION_COMPLETE.md) for feature overview
2. Check [COMPONENT_IMPLEMENTATION_GUIDE.md](./COMPONENT_IMPLEMENTATION_GUIDE.md) for component details
3. Review API error responses for specific issues
4. Check OpenAI documentation for AI-related errors

---

## ✨ Deployment Checklist

### 48 Hours Before Launch
- [ ] Test all features on staging
- [ ] Verify OpenAI API key works
- [ ] Run load testing (simulated users)
- [ ] Review error handling
- [ ] Prepare rollback plan

### Launch Day
- [ ] Deploy backend
- [ ] Deploy frontend
- [ ] Run smoke tests
- [ ] Monitor logs closely
- [ ] Have team on standby

### Post-Launch
- [ ] Monitor for errors every 15 min (first 2 hours)
- [ ] Check API costs hourly (first 24 hours)
- [ ] Collect user feedback
- [ ] Document any issues
- [ ] Plan fixes for issues found

---

## 🎉 You're Ready!

Your Academic Success Suite is ready for production. Following this guide will ensure:

✅ Secure deployment  
✅ Proper configuration  
✅ Robust monitoring  
✅ Scalable architecture  
✅ Excellent user experience  

**Good luck with your launch! 🚀**

---

**Last Updated:** June 9, 2026  
**Status:** Production Ready  
**Next Review:** After first week of launch
