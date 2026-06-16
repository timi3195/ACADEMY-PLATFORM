# Academy Platform - Collaborator Guide

Welcome to the **Academy Platform** project! This document provides a comprehensive overview of the project, its current state, and what needs to be done.

---

## 📋 Table of Contents
1. [Project Overview](#project-overview)
2. [What's Already Built](#whats-already-built)
3. [Tech Stack](#tech-stack)
4. [Getting Started](#getting-started)
5. [Project Roadmap (What's Left)](#project-roadmap-whats-left)
6. [Branch Workflow](#branch-workflow)
7. [Key Folders & Files](#key-folders--files)

---

## 🎯 Project Overview

### What Is This?
The **Academy Platform** is a comprehensive **educational technology solution** designed for a Nigerian polytechnic (Yabatech). It's evolving from a simple Computer-Based Test (CBT) system into a full-featured **AI-powered learning ecosystem**.

### Core Features
- ✅ **Computer-Based Testing (CBT)**: Multiple-choice question quizzes
- ✅ **Authentication**: Google OAuth + Email/Password with JWT
- ✅ **Premium Subscriptions**: Semester-based billing with Paystack
- ✅ **AI Study Assistant**: OpenAI-powered chat for question explanations
- ✅ **Student Notes**: Smart note-taking with AI enhancement
- ✅ **Performance Analytics**: Track student progress & insights
- ✅ **Role-Based Access**: Students, Lecturers, Admins with different permissions
- ✅ **Multi-Department Support**: Organized by School → Department → Course

### Scale
- Designed for **1,000+ simultaneous students**
- Support for **50,000+ practice questions**
- **Multiple departments and courses** across the institution

---

## ✅ What's Already Built

### **Backend (Node.js + Express)**

#### Database Models
```
✅ User           - Students, lecturers, admins with roles
✅ Course         - All courses organized by department & level
✅ Question       - Practice questions with explanations
✅ Department     - Academic departments within schools
✅ School         - Institution structure (top level)
✅ AIConversation - Stores AI chat history
✅ StudentNote    - Student-created notes
✅ StudentPerformance - Analytics & performance tracking
✅ QuizSession    - Active quiz sessions
✅ Transaction    - Payment records
```

#### API Endpoints (50+ total)
- **Authentication** (`/api/auth`): Login, register, Google OAuth
- **Courses** (`/api/courses`): List, filter, enroll
- **Questions** (`/api/questions`): Get questions, filter by difficulty
- **Quiz** (`/api/quiz`): Start quiz, submit answers, get results
- **AI Features** (`/api/ai`): Chat, question explanations, quiz generation
- **Analytics** (`/api/analytics`): Student performance, learning insights
- **Search** (`/api/search`): Global search across courses & questions
- **Payments** (`/api/payments`): Initialize & verify payments
- **Admin** (`/api/admin`): Manage users, schools, departments
- **Notes** (`/api/notes`): Create, update, enhance notes
- **Files** (`/api/files`): Upload & manage study materials

#### Security
```
✅ JWT Token Authentication
✅ Role-Based Access Control (Student/Lecturer/Admin)
✅ Premium Subscription Verification
✅ Protected Routes with Middleware
```

#### Payment Integration
```
✅ Paystack Integration
✅ Semester-based Subscriptions (2024-1, 2024-2, etc.)
✅ Multiple Plans (Free, Basic, Premium)
✅ Subscription Expiration Tracking
```

#### AI Integration
```
✅ OpenAI (GPT-3.5-turbo) Integration
✅ Question Explanation Generation
✅ Quiz Generation
✅ Study Chat Assistant
✅ Cost Optimization (Caching)
✅ Token Usage Tracking
```

### **Frontend (React + Vite)**

#### Pages
```
✅ Login.jsx              - User authentication
✅ Register.jsx           - New account creation
✅ Dashboard.jsx          - Student home screen
✅ Courses.jsx            - Browse & enroll courses
✅ CBTQuiz.jsx            - Take practice quizzes
✅ AIChatPage.jsx         - AI Study Assistant
✅ AnalyticsDashboard.jsx - Performance metrics
✅ Notes.jsx              - Note management
✅ AdminPanel.jsx         - Admin management (basic)
✅ Upgrade.jsx            - Premium upgrade
```

#### Components
```
✅ ChatInterface.jsx      - Chat UI for AI assistant
✅ Navbar.jsx             - Navigation header
✅ PremiumGate.jsx        - Premium content protection
```

#### Styling
```
✅ 700+ lines of responsive CSS
✅ Purple gradient theme
✅ Mobile-optimized
✅ Dark mode ready
```

---

## 🛠️ Tech Stack

### Backend
- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB (Atlas)
- **Authentication**: JWT, Passport (Google OAuth)
- **Payment**: Paystack API
- **AI**: OpenAI API (GPT-3.5-turbo)
- **Email**: Resend (configured)
- **File Storage**: Cloudinary (configured)

### Frontend
- **Framework**: React 18+
- **Build Tool**: Vite
- **Styling**: CSS3 + Custom
- **HTTP Client**: Axios
- **Routing**: React Router
- **State Management**: React Hooks / Context API

### DevOps & Deployment
- **Backend Hosting**: Vercel, Render, or Railway
- **Frontend Hosting**: Vercel or Netlify
- **Database**: MongoDB Atlas (cloud)
- **Environment**: Node 18+

---

## 🚀 Getting Started

### Prerequisites
```bash
# Required
- Node.js 18+ 
- npm or yarn
- Git
- MongoDB Atlas account (or local MongoDB)

# API Keys Needed
- OPENAI_API_KEY (from OpenAI)
- PAYSTACK_SECRET_KEY & PAYSTACK_PUBLIC_KEY (from Paystack)
- GOOGLE_CLIENT_ID & GOOGLE_CLIENT_SECRET (from Google Cloud)
```

### Setup Instructions

#### 1. Clone & Install
```bash
git clone https://github.com/timi3195/ACADEMY-PLATFORM.git
cd academy-platform

# Backend setup
cd backend
npm install

# Frontend setup (in new terminal)
cd frontend
npm install
```

#### 2. Environment Setup

**Backend** (`backend/.env`):
```env
# Database
MONGODB_URI=your_mongodb_connection_string

# Authentication
JWT_SECRET=your_jwt_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret

# AI
OPENAI_API_KEY=your_openai_api_key

# Payment
PAYSTACK_SECRET_KEY=your_paystack_secret
PAYSTACK_PUBLIC_KEY=your_paystack_public_key

# Email
RESEND_API_KEY=your_resend_api_key

# File Storage
CLOUDINARY_NAME=your_cloudinary_name
CLOUDINARY_API_KEY=your_cloudinary_key
CLOUDINARY_API_SECRET=your_cloudinary_secret
```

**Frontend** (`frontend/.env`):
```env
VITE_API_URL=http://localhost:5000
VITE_GOOGLE_CLIENT_ID=your_google_client_id
```

#### 3. Run Development Servers
```bash
# Terminal 1: Backend
cd backend
npm start
# Server runs on http://localhost:5000

# Terminal 2: Frontend
cd frontend
npm run dev
# App runs on http://localhost:5173
```

#### 4. Test the App
- Go to http://localhost:5173
- Register/Login with test account
- Try CBT quiz, AI chat, analytics
- Check admin panel

---

## 📚 Project Roadmap (What's Left)

### 🔴 **Critical - Must Do First**

#### 1. **Complete Admin Dashboard UI**
- **Status**: Backend API ✅, Frontend UI ⚠️ (Partial)
- **What's Needed**:
  - User management interface (promote to lecturer/admin)
  - Department & course management forms
  - Analytics dashboard with charts
  - Approve/reject lecturer question uploads
- **Location**: `frontend/src/pages/AdminPanel.jsx`
- **Effort**: 2-3 days

#### 2. **Lecturer Portal**
- **Status**: Backend API ✅, Frontend ❌ (Not Started)
- **What's Needed**:
  - Upload questions (single & bulk CSV/Excel)
  - Upload course materials
  - View student performance in their courses
  - Create learning paths
- **Effort**: 3-4 days

#### 3. **File Upload & Management**
- **Status**: Backend API ~50%, Frontend ❌ (Not Started)
- **What's Needed**:
  - File upload UI (drag & drop)
  - File preview (PDF, images)
  - Cloudinary integration complete
  - Delete/manage files
- **Effort**: 2 days

#### 4. **Payment UI (Premium Upgrade)**
- **Status**: Backend API ✅, Frontend ⚠️ (Basic)
- **What's Needed**:
  - Payment selection UI (plan comparison)
  - Semester selection
  - Paystack payment form integration
  - Receipt & subscription confirmation
- **Location**: `frontend/src/pages/Upgrade.jsx`
- **Effort**: 1-2 days

### 🟡 **Important - Do After Critical Items**

#### 5. **Email Notifications**
- **Status**: Backend Configured ✅, Triggers ⚠️ (Partial)
- **What's Needed**:
  - Welcome email on signup
  - Subscription confirmation email
  - Weekly performance digest
  - Assignment reminders
- **Files**: `backend/utils/email.js`
- **Effort**: 1-2 days

#### 6. **Advanced Search & Filtering**
- **Status**: Backend API ✅, Frontend ⚠️ (Basic)
- **What's Needed**:
  - Filter by: department, level, year, difficulty
  - Search across: courses, questions, notes, lecturers
  - Sorting options (popularity, difficulty, recent)
- **Effort**: 1 day

#### 7. **Mobile Responsiveness**
- **Status**: Partially done ⚠️
- **What's Needed**:
  - Test all pages on mobile
  - Fix layout issues
  - Touch-friendly buttons
  - Mobile navigation drawer
- **Effort**: 1-2 days

#### 8. **Learning Paths & Recommendations**
- **Status**: Backend Model ✅, API ~30%, Frontend ❌
- **What's Needed**:
  - AI-generated study recommendations
  - Structured learning paths
  - Progress tracking
  - Milestone badges
- **Effort**: 2-3 days

### 🟢 **Nice to Have - Lower Priority**

#### 9. **Bulk Question Import**
- Upload CSV/Excel with hundreds of questions
- Validate before import
- Progress tracking

#### 10. **Caching Layer (Redis)**
- Reduce database queries
- Cache frequently accessed data

#### 11. **Rate Limiting**
- Prevent API abuse
- Usage quota per user

#### 12. **Advanced Analytics**
- Heatmaps of difficult topics
- Student cohort comparisons
- Trend analysis

#### 13. **Social Features**
- Study groups
- Peer-to-peer notes sharing
- Discussion forums

---

## 🔄 Branch Workflow

### How We're Organizing Work

We've set up **branch protection** on GitHub to ensure quality code:

```
main (protected)
 ↑
 │ (Pull Requests only)
 │
dev (protected)
 ↑
 │ (Feature branches from dev)
 │
feature/admin-dashboard
feature/lecturer-portal
feature/payments-ui
...
```

### For Each Feature:

1. **Create a feature branch from `dev`**:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/your-feature-name
   ```

2. **Make changes & commit**:
   ```bash
   git add .
   git commit -m "Add: your feature description"
   git push origin feature/your-feature-name
   ```

3. **Create a Pull Request on GitHub**:
   - Go to https://github.com/timi3195/ACADEMY-PLATFORM
   - Click "Pull Requests" → "New Pull Request"
   - Select `dev` as base branch
   - Add description of changes
   - Request review

4. **After Approval, Merge to `dev`**:
   - Owner reviews & approves
   - Merges to `dev` branch
   - Once enough features accumulate, merge `dev` → `main`

---

## 📁 Key Folders & Files

### Backend Structure
```
backend/
├── models/                 # Database schemas
│   ├── User.js
│   ├── Course.js
│   ├── Question.js
│   ├── AIConversation.js
│   └── ... (more models)
├── routes/                 # API endpoints
│   ├── auth.js            # Login, register, OAuth
│   ├── courses.js         # Course management
│   ├── quiz.js            # Quiz session
│   ├── ai.js              # AI features (600+ lines)
│   ├── analytics.js       # Performance tracking
│   ├── admin.js           # Admin operations
│   ├── payments.js        # Paystack integration
│   └── ... (more routes)
├── config/                 # Middleware & config
│   ├── middleware/
│   │   ├── adminOnly.js
│   │   ├── lecturerOnly.js
│   │   ├── authMiddleware.js
│   │   └── planMiddleware.js
│   └── passport.js        # Google OAuth config
├── utils/                  # Utilities
│   ├── openai.js          # OpenAI integration
│   ├── email.js           # Email sending
│   ├── claude.js          # Claude AI (optional)
│   └── token.js           # JWT utilities
├── uploads/               # Temporary file storage
├── app.js                 # Express app setup
└── package.json
```

### Frontend Structure
```
frontend/
├── src/
│   ├── pages/             # Page components
│   │   ├── Login.jsx
│   │   ├── AIChatPage.jsx
│   │   ├── AdminPanel.jsx
│   │   ├── AnalyticsDashboard.jsx
│   │   └── ... (more pages)
│   ├── components/        # Reusable components
│   │   ├── Navbar.jsx
│   │   ├── PremiumGate.jsx
│   │   ├── AI/
│   │   │   └── ChatInterface/
│   │   │       └── ChatInterface.jsx
│   │   └── ... (more components)
│   ├── utils/
│   │   └── api.js         # API client (axios)
│   ├── App.jsx            # Root component
│   ├── main.jsx           # Entry point
│   └── styles.css
├── index.html
├── vite.config.js
└── package.json
```

### Important Configuration Files
```
📄 ACADEMIC_SUCCESS_SUITE_PLAN.md    - Original vision & features
📄 IMPLEMENTATION_COMPLETE.md         - Detailed implementation notes
📄 QUICK_START_GUIDE.md              - Quick setup reference
```

---

## 🎯 Immediate Next Steps

### For This Week (Priority Order):

1. **Setup Your Environment**
   - Clone repo
   - Install dependencies
   - Get API keys (OpenAI, Paystack)
   - Run locally & verify it works

2. **Pick Your First Task**
   - Start with **Admin Dashboard UI** (most critical)
   - Or **Lecturer Portal** (high impact)
   - Or **Payment UI** (revenue-blocking)

3. **Create Feature Branch**
   - Branch from `dev`
   - Follow naming: `feature/short-description`

4. **Submit First Pull Request**
   - Get code reviewed
   - Iterate based on feedback
   - Merge to `dev`

---

## ❓ Common Questions

### Q: How do I add a new API endpoint?
1. Create route file: `backend/routes/myfeature.js`
2. Import in `backend/app.js`
3. Add to Express: `app.use('/api/myfeature', myFeatureRoutes)`
4. Document in API section

### Q: How do I protect a route?
```javascript
router.post('/protected', protect, requirePremium, (req, res) => {
  // Only authenticated premium users can access
});
```

### Q: How do I call the API from frontend?
```javascript
import axios from 'axios';

const response = await axios.post('/api/courses/enroll', {
  courseId: '123'
}, {
  headers: { Authorization: `Bearer ${token}` }
});
```

### Q: Where do I deploy this?
- **Backend**: Render.com (free tier), Railway, or Vercel
- **Frontend**: Vercel or Netlify (free tier)
- **Database**: MongoDB Atlas (free tier included)
- Total cost: **$0-20/month**

### Q: How do I test the payment system?
- Use Paystack test keys (provided in `.env`)
- Use test card: `4111111111111111` with any future date
- Check transaction in Paystack dashboard

---

## 📞 Support & Communication

### When You Have Questions:
1. Check this document first
2. Check the code comments
3. Check existing PR descriptions
4. Ask in PR comments (for code-specific)

### Where to Keep Track:
- **GitHub Issues**: For bugs & feature requests
- **Pull Requests**: For code review & discussions
- **This File**: Update as we learn

---

## 🚀 You've Got This!

This is a **real-world, production-grade** project building an actual product for real students. Every feature you add, every bug you fix, every line you write helps students learn better.

**Let's build something amazing together!** 💪

---

**Last Updated**: 2026-06-13
**Maintained By**: Development Team
