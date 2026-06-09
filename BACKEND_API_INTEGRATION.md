# Backend API Integration Guide

## ✅ Status: Real APIs Connected

The Performance Analytics Dashboard and AI Study Assistant are now **fully connected to backend APIs** with automatic fallback to demo data.

---

## 🔗 API Endpoints Used

### 1. **Course List** (Required)
**Endpoint:** `GET /api/courses`

**Response:**
```json
{
  "success": true,
  "courses": [
    {
      "_id": "course_id_1",
      "title": "Data Structures",
      "code": "CS201",
      "department": "Computer Science"
    }
  ]
}
```

**Frontend Usage:** Course selector dropdown in both AI.jsx and AnalyticsDashboard.jsx

---

### 2. **Dashboard Overview** (Analytics)
**Endpoint:** `GET /api/analytics/dashboard`
**Auth:** Bearer token required

**Expected Response:**
```json
{
  "success": true,
  "student": {
    "name": "Student Name",
    "program": "ND2 Computer Science",
    "department": "Computer Science",
    "semester": "2025/2026 - Semester II"
  },
  "overall": {
    "accuracy": 76.5,
    "examReadiness": 72
  },
  "engagement": {
    "conversations": 24,
    "processedNotes": 8,
    "learningPaths": 3
  },
  "topicMetrics": [
    {
      "name": "Arrays & Lists",
      "accuracy": 88,
      "attempts": 12
    }
  ],
  "performanceTrend": [
    {
      "week": 1,
      "accuracy": 65,
      "attempts": 12
    }
  ],
  "departmentalAvg": 68.2
}
```

**Frontend Usage:** 
- Overall student metrics (name, program, accuracy)
- Topic breakdown
- Performance trend chart
- Departmental comparison

---

### 3. **Performance by Course** (Analytics)
**Endpoint:** `GET /api/analytics/performance/:courseId`
**Auth:** Bearer token required

**Expected Response:**
```json
{
  "success": true,
  "overallAccuracy": 76.5,
  "topicMetrics": [
    {
      "topic": "Pointers",
      "accuracy": 76,
      "attempts": 9
    }
  ]
}
```

**Frontend Usage:** Update accuracy and topic data when course is changed

---

### 4. **AI Chat** (AI Study Assistant)
**Endpoint:** `POST /api/ai/chat`
**Auth:** Bearer token required

**Request:**
```json
{
  "courseId": "course_id_1",
  "message": "What is a pointer?",
  "conversationId": "conv_id_optional"
}
```

**Response:**
```json
{
  "success": true,
  "message": "A pointer is a variable that stores...",
  "conversationId": "conv_id_123",
  "tokens": {
    "input": 50,
    "output": 150,
    "total": 200
  },
  "cost": 0.00035,
  "isMockData": false
}
```

**Frontend Usage:** AI tutor responses in AI.jsx

---

## 📊 Data Flow Diagram

```
Frontend (React)
    ↓
API Calls (axios/fetch)
    ↓
Backend Routes
    ├── GET /api/courses → List of courses
    ├── GET /api/analytics/dashboard → Student overview + metrics
    ├── GET /api/analytics/performance/:id → Course-specific data
    └── POST /api/ai/chat → AI responses
    ↓
Database (MongoDB)
    ├── User collection (student data)
    ├── Course collection
    ├── StudentPerformance collection
    ├── AIConversation collection
    └── Analytics aggregations
    ↓
External Services
    ├── OpenAI API (for AI responses)
    └── JWT/OAuth (for authentication)
```

---

## 🛡️ Fallback System

**When Real API Fails:**

1. ✅ **Charts displayed**: Uses mock data
2. ✅ **UI renders**: No errors or crashes
3. ✅ **Error banner**: Shows "Could not load real data"
4. ✅ **Demo badge**: Indicates mock data mode
5. ✅ **Auto-recovery**: Fetches real data again on page refresh

**When OpenAI Quota Exceeded:**

1. ✅ **AI chat works**: Returns demo responses
2. ✅ **Yellow banner**: Shows quota issue with fix link
3. ✅ **User can still type**: No interruption
4. ✅ **Auto-activation**: Real AI works once billing fixed

---

## 🚀 How It Works

### **On Page Load:**
1. ✅ Fetch courses list
2. ✅ Attempt to fetch dashboard data from `/api/analytics/dashboard`
3. ✅ If success: Display real data + "✓ Real Data" badge
4. ✅ If fail: Display mock data + "📋 Demo Data" badge + error banner

### **On Course Change:**
1. ✅ Fetch performance data for selected course
2. ✅ Update accuracy and topic metrics
3. ✅ Keep demo data as fallback

### **When Sending AI Message:**
1. ✅ Call `/api/ai/chat` endpoint
2. ✅ If success: Display real AI response
3. ✅ If fail (429): Display demo response + warning banner
4. ✅ If fail (other): Show error message

---

## 📱 Frontend Components Affected

### **AnalyticsDashboard.jsx**
```javascript
// State variables now pull from real APIs
const [studentData, setStudentData] = useState(null);     // Real student info
const [topicData, setTopicData] = useState(MOCK_TOPIC_DATA);  // Topic breakdown
const [trendData, setTrendData] = useState(MOCK_TREND_DATA);  // Performance trend
const [usingRealData, setUsingRealData] = useState(false);    // Real data badge

// Fetches data on mount
useEffect(() => {
  loadAllData();  // Calls /api/analytics/dashboard
}, []);

// Fetches course-specific data on course change
useEffect(() => {
  if (selectedCourse) {
    loadCoursePerformance(selectedCourse._id);  // Calls /api/analytics/performance/:id
  }
}, [selectedCourse]);
```

### **AI.jsx**
```javascript
// Already had real API integration, now with fallback
const sendMessage = async () => {
  const res = await apiPost('/api/ai/chat', {
    courseId: selectedCourse,
    message: question
  });
  
  // Detects if response is mock data
  if (res.isMockData) {
    setDemoMode(true);  // Shows demo banner
  }
};
```

---

## 🔐 Authentication

All API calls require Bearer token:

```javascript
const token = localStorage.getItem("token");
const headers = { Authorization: `Bearer ${token}` };
```

**Token is set after login/OAuth flow and stored in localStorage**

---

## 📈 Example: Real Data Flow

**Scenario: Student logs in and views analytics**

1. Frontend loads AnalyticsDashboard component
2. `loadAllData()` called on mount:
   ```
   GET /api/courses → Returns 5 courses
   GET /api/analytics/dashboard → Returns:
     - Student: "Chioma Okafor"
     - Overall Accuracy: 76.5%
     - Topics: 8 with accuracy levels
     - Trend: 8-week progression
   ```
3. UI renders with real data + "✓ Real Data" badge
4. Student selects "Data Structures" course
5. `loadCoursePerformance()` called:
   ```
   GET /api/analytics/performance/CS201_id → Returns:
     - Course-specific accuracy
     - Topic metrics for this course
   ```
6. Chart updates with real course data
7. Recommendations dynamically generated based on actual weaknesses

---

## ⚠️ Common Issues & Solutions

### Issue: "Real Data" badge not showing
**Cause:** `/api/analytics/dashboard` returning error or wrong format
**Solution:** 
1. Check backend logs
2. Verify endpoint returns correct JSON structure
3. Ensure authentication token is valid

### Issue: Chart shows NaN or incorrect values
**Cause:** API returning non-numeric data or missing fields
**Solution:**
1. Validate API response includes `accuracy`, `attempts`, `week` fields
2. Check data types (should be numbers, not strings)
3. Use `Math.round()` to ensure integers

### Issue: Loading spinner never goes away
**Cause:** API call hanging or not returning
**Solution:**
1. Check network tab in browser DevTools
2. Verify API endpoint exists and is accessible
3. Check CORS settings on backend
4. Verify token is not expired

---

## 🎯 Testing the Integration

### Test Real Data Connection:
```bash
# 1. Start backend
cd server
npm install
node app.js

# 2. In browser, login and go to /analytics
# Expected: "✓ Real Data" badge appears

# 3. Check browser console
# Should see API calls to /api/analytics/dashboard
# Should NOT see errors in console
```

### Test Fallback System:
```bash
# 1. Stop backend server
# 2. Refresh /analytics page
# Expected: "📋 Demo Data" badge + error banner

# 3. Start backend again and refresh
# Expected: Real data loads and badge changes to "✓ Real Data"
```

### Test AI Chat:
```bash
# 1. Go to /ai page
# 2. Select a course
# 3. Type a message

# If OpenAI API works:
# - Real response appears
# - No yellow banner

# If OpenAI quota exceeded:
# - Demo response appears (with sample content)
# - Yellow "Demo Mode" banner appears
# - Message: "Click here to fix your billing"
```

---

## 📊 Backend Requirements

### Required Database Collections:
- ✅ `users` - Student profiles
- ✅ `courses` - Course listings
- ✅ `studentperformances` - Performance metrics by course
- ✅ `aiconversations` - Chat history
- ✅ `questions` - Past questions
- ✅ `notes` - Study notes

### Required Backend Routes:
- ✅ `GET /api/courses`
- ✅ `GET /api/analytics/dashboard`
- ✅ `GET /api/analytics/performance/:courseId`
- ✅ `POST /api/ai/chat`
- ✅ `GET /api/ai/chat/:courseId`

---

## 🚀 Deployment Checklist

- [ ] Backend deployed (Railway/Heroku)
- [ ] Frontend deployed (Vercel/Netlify)
- [ ] Environment variables set on backend (OPENAI_API_KEY, MongoDB URI)
- [ ] CORS configured to allow frontend domain
- [ ] Database has sample student data
- [ ] API endpoints tested and working
- [ ] Real data badge appears in AnalyticsDashboard
- [ ] AI chat shows real or demo responses appropriately
- [ ] Error handling works (fallback to mock data)
- [ ] Authentication tokens persist across page refreshes

---

**Status:** ✅ **Fully integrated with automatic fallback system**

Real APIs are now actively used with graceful degradation to mock data if any API fails.
