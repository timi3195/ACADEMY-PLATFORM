# 🧪 API Testing & Production Deployment Guide

## Part 1: Testing API Endpoints

### Setup for Testing

#### 1. Get Your JWT Token (Required for All Protected Routes)
```bash
# First, register or login to get a token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "password123"
  }'

# Response includes:
# {
#   "success": true,
#   "token": "eyJhbGciOiJIUzI1NiIs..."  <-- COPY THIS
# }
```

#### 2. Get Your Course ID (For Course-Specific Tests)
```bash
# Get your enrolled courses
curl -X GET http://localhost:5000/api/courses \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response:
# {
#   "success": true,
#   "courses": [
#     {
#       "_id": "507f1f77bcf86cd799439011",  <-- USE THIS
#       "title": "Data Structures",
#       ...
#     }
#   ]
# }
```

---

## Part 2: Test Each API Endpoint

### Test 1: AI Chat - Send Message ✅

```bash
curl -X POST http://localhost:5000/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "courseId": "YOUR_COURSE_ID",
    "message": "Explain the concept of recursion"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": {
    "role": "assistant",
    "content": "Recursion is a programming concept where...",
    "tokens": 245,
    "cost": 0.00037
  },
  "conversationId": "507f...",
  "totalMessages": 1
}
```

**What to Check:**
- ✓ Response comes from OpenAI (NOT just an echo)
- ✓ Token count is accurate
- ✓ Conversation ID is created
- ✓ No 401/403 errors (auth working)

---

### Test 2: Analytics - Get Performance ✅

```bash
curl -X GET http://localhost:5000/api/analytics/performance/YOUR_COURSE_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "performance": {
    "_id": "507f...",
    "user": "507f...",
    "course": "507f...",
    "overallAccuracy": 75.5,
    "topicMetrics": [
      {
        "topic": "Arrays",
        "correctAttempts": 17,
        "totalAttempts": 20,
        "accuracy": 85.0,
        "masteryLevel": "advanced"
      }
    ],
    "topStrengths": ["Arrays", "Linked Lists"],
    "areasToImprove": ["Trees", "Graphs"],
    "estimatedExamScore": 78
  }
}
```

---

### Test 3: Analytics - Record Quiz Attempt ✅

```bash
curl -X POST http://localhost:5000/api/analytics/record-attempt \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "courseId": "YOUR_COURSE_ID",
    "topic": "Arrays",
    "isCorrect": true,
    "score": 10
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Attempt recorded successfully",
  "performance": {
    "topic": "Arrays",
    "accuracy": 85.0,
    "totalAttempts": 20,
    "masteryLevel": "advanced"
  }
}
```

---

### Test 4: Get Conversation History ✅

```bash
curl -X GET http://localhost:5000/api/ai/chat/YOUR_COURSE_ID \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Expected Response:**
```json
{
  "success": true,
  "conversations": [
    {
      "_id": "507f...",
      "title": "Recursion Discussion",
      "totalMessages": 5,
      "lastMessageAt": "2026-06-09T...",
      "createdAt": "2026-06-09T..."
    }
  ]
}
```

---

### Test 5: Generate Learning Path ✅

```bash
curl -X POST http://localhost:5000/api/ai/learning-path/generate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "courseId": "YOUR_COURSE_ID",
    "studyHoursPerDay": 2,
    "targetExamDate": "2026-07-15"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "path": {
    "_id": "507f...",
    "title": "Data Structures 7-Day Plan",
    "schedule": [
      {
        "day": 1,
        "activities": [
          {
            "type": "read-notes",
            "title": "Introduction to Arrays",
            "duration": 45,
            "completed": false
          }
        ]
      }
    ]
  }
}
```

---

### Test 6: Check Premium Access ✅

```bash
# This should work if user is premium
curl -X GET http://localhost:5000/api/ai/user/usage \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Expected for PREMIUM user:
# {
#   "success": true,
#   "usage": {
#     "aiChatMessages": 45,
#     "aiChatLimit": 100,
#     "notesProcessed": 8,
#     "notesLimit": 20
#   }
# }

# Expected for FREE user:
# {
#   "success": false,
#   "message": "Premium feature required"
# }
```

---

## Part 3: Common Testing Issues & Fixes

### ❌ Issue 1: "OPENAI_API_KEY is not set"

**Solution:**
```bash
# 1. Get real API key from https://platform.openai.com/api-keys
# 2. Update server/.env
OPENAI_API_KEY=sk_your_actual_key_here

# 3. Restart server
cd server && npm run dev
```

---

### ❌ Issue 2: "401 Unauthorized"

**Cause:** Invalid or expired JWT token

**Solution:**
```bash
# Get a fresh token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your_password"
  }'

# Use the new token in subsequent requests
```

---

### ❌ Issue 3: "Premium feature required"

**Cause:** Free user trying to access AI features

**Solution:**
```bash
# For testing, manually upgrade user in MongoDB
# In MongoDB Compass or Atlas:
db.users.updateOne(
  { email: "test@example.com" },
  { $set: { subscriptionType: "premium" } }
)

# Or use the /upgrade endpoint if implemented
```

---

### ❌ Issue 4: Course not found

**Solution:**
```bash
# Make sure the course ID is valid and you're enrolled
curl -X GET http://localhost:5000/api/courses \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Copy an actual course ID from the response
```

---

## Part 4: Frontend Testing Checklist

### ✅ Login & Navigation
- [ ] Can login with valid credentials
- [ ] Navbar shows username
- [ ] All links appear (Courses, Notes, AI, Analytics, etc.)
- [ ] Logout works

### ✅ AI Chat Page
- [ ] Page loads at http://localhost:5173/ai-chat
- [ ] Course selector dropdown works
- [ ] Can type message in input box
- [ ] Send button is clickable
- [ ] Message appears after sending
- [ ] AI response loads (wait for OpenAI)
- [ ] No console errors

### ✅ Analytics Dashboard
- [ ] Page loads at http://localhost:5173/analytics
- [ ] Metric cards display (accuracy, readiness, trend)
- [ ] Topic table shows data
- [ ] Strengths/weaknesses lists appear
- [ ] Recommendations display
- [ ] Responsive on mobile (resize browser)

### ✅ Premium Gating
- [ ] Free user redirected to upgrade page
- [ ] Premium user can access all features
- [ ] Premium gate message is clear

### ✅ Error Handling
- [ ] No JavaScript errors in console
- [ ] Network errors show friendly messages
- [ ] Loading states display correctly
- [ ] 401 errors redirect to login

---

## Part 5: Production Deployment

### Step 1: Choose Your Hosting Platform

#### Option A: Vercel (Easiest for Full Stack)
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy backend
cd server
vercel --prod
# Follow prompts

# Deploy frontend
cd ../frontend
vercel --prod
```

#### Option B: Render (Simple GitHub Integration)
```
1. Push code to GitHub
2. Go to https://render.com
3. Click "New +" → "Web Service"
4. Select your GitHub repo
5. Configure build: npm install && npm start
6. Add environment variables from .env
7. Click Deploy
```

#### Option C: Railway (Modern & Easy)
```
1. Go to https://railway.app
2. Click "Create New Project"
3. Select "Deploy from GitHub"
4. Connect your repo
5. Railway auto-detects Node.js
6. Add environment variables
7. Railway deploys automatically
```

---

### Step 2: Set Environment Variables

#### Backend (.env)
```
# Essential
PORT=5000
NODE_ENV=production
OPENAI_API_KEY=sk_your_real_key
MONGO_URI=your_production_mongodb_uri

# Auth
JWT_SECRET=generate_new_random_secret_here
JWT_REFRESH_SECRET=generate_new_random_refresh_secret

# Frontend URL
FRONTEND_URL=https://your-production-frontend.vercel.app

# Other
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
PAYSTACK_SECRET_KEY=...
# etc.
```

#### Frontend (.env or .env.production)
```
VITE_API_URL=https://your-production-backend.com/api
```

---

### Step 3: Database Preparation

```bash
# Verify MongoDB indexes are created
# Run this in MongoDB shell or Compass:

db.aiconversations.createIndex({ user: 1, course: 1, createdAt: -1 });
db.studentperformances.createIndex({ user: 1, course: 1 });
db.studentnotes.createIndex({ user: 1, course: 1, createdAt: -1 });
db.questionexplanationcaches.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

# Enable backups in MongoDB Atlas:
# 1. Go to MongoDB Atlas
# 2. Backup → Continuous Backup → Enable
# 3. Set retention to 30+ days
```

---

### Step 4: Pre-Deployment Checklist

- [ ] OpenAI API key works
- [ ] All tests pass locally
- [ ] No console errors
- [ ] Environment variables set correctly
- [ ] Database backups enabled
- [ ] CORS origins updated for production URLs
- [ ] SSL/HTTPS enforced
- [ ] All API endpoints tested
- [ ] Premium gating works
- [ ] Mobile responsiveness verified

---

### Step 5: Deploy & Verify

#### Backend Deployment
```bash
# Test health endpoint
curl https://your-backend.com/api/quiz/health

# Expected response:
# {
#   "success": true,
#   "service": "quiz",
#   "status": "ok"
# }
```

#### Frontend Deployment
```
# Open in browser
https://your-frontend.vercel.app

# Verify:
- Login page loads
- Login works
- All pages accessible
- No console errors
- API calls successful
```

#### Post-Deployment Testing
```bash
# Test AI Chat
curl -X POST https://your-backend.com/api/ai/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"courseId":"YOUR_ID","message":"Test"}'

# Test Analytics
curl -X GET https://your-backend.com/api/analytics/performance/YOUR_COURSE_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Part 6: Monitoring & Maintenance

### Weekly Tasks
```
- Check OpenAI API usage costs
- Review error logs
- Monitor database performance
- Check server uptime
```

### Monthly Tasks
```
- Test backups
- Review database growth
- Analyze user feedback
- Plan feature improvements
```

### Security Tasks
```
- Rotate API keys quarterly
- Update dependencies: npm audit
- Review access logs
- Run security scan
```

---

## Part 7: Quick Reference

| Task | Command | Time |
|------|---------|------|
| Get JWT Token | `curl -X POST http://localhost:5000/api/auth/login ...` | 2 min |
| Test AI Chat | `curl -X POST http://localhost:5000/api/ai/chat ...` | 1 min |
| Deploy Backend | `vercel --prod` (from server/) | 5-10 min |
| Deploy Frontend | `vercel --prod` (from frontend/) | 5-10 min |
| Check Status | `curl https://backend.com/api/quiz/health` | 1 min |

---

## 📞 Troubleshooting

### Issue: "Cannot GET /api/ai/chat"
**Fix:** Backend routes not mounted. Check app.js has: `app.use("/api/ai", aiRoutes);`

### Issue: CORS errors in browser
**Fix:** Update FRONTEND_URL in backend .env to match production domain

### Issue: AI responses empty
**Fix:** Check OPENAI_API_KEY is valid and account has credits

### Issue: Database queries slow
**Fix:** Verify indexes created. Run: `db.collection.getIndexes()`

### Issue: Premium gate not working
**Fix:** Check user.subscriptionType field in database

---

**You're now ready to test and deploy! 🚀**
