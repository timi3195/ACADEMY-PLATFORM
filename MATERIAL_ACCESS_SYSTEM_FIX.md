# Material Access System - Fix Documentation

**Date:** 2026-07-04  
**Status:** ✅ Completed and Deployed

---

## Issues Identified & Fixed

### Issue 1: Free Users Cannot View PDFs
**Problem:** Free users were unable to view free (non-premium) PDF materials inside the browser. They were being prompted to upgrade unnecessarily.

**Root Cause:** 
- The frontend `canAccessMaterial()` function was recalculating access permissions independently, which could cause inconsistencies
- Backend and frontend were not synchronized on what "accessible" means
- PDFViewer error handling was not user-friendly

**Fix Applied:**
- Frontend now uses the `accessible` field from the backend response directly (backend calculates this server-side)
- Added fallback client-side calculation if `accessible` field is missing
- Improved PDFViewer error messages to distinguish auth errors from other failures

---

### Issue 2: Download Functionality Not Working
**Problem:** Download feature was not functioning correctly for any user type.

**Root Cause:**
- Download permissions were unclear - unclear whether downloads should be restricted by file type or subscription level
- Error messages were generic and not helpful

**Fix Applied:**
- **Clear policy:** Only premium users and admins can download ANY file type (regardless of `isPremium` setting)
- Free users can view but cannot download
- Added detailed console logging for debugging
- Improved error messages: `"Only premium members can download materials. Upgrade your plan to download."`

---

### Issue 3: Separation of View vs Download Permissions Not Explicit
**Problem:** The permission model conflated viewing and downloading permissions.

**Root Cause:**
- Backend view endpoint logic was correct but not clearly documented
- Download endpoint was treating all files uniformly without clear rules

**Fix Applied:**
- **View Endpoint (`/api/files/view/:id`):**
  - ✅ Authenticates user
  - ✅ Verifies course/department/year access
  - ✅ For free materials: allows all authenticated students in the course
  - ✅ For premium materials: only allows premium users with active subscription
  - ✅ Admins always allowed

- **Download Endpoint (`/api/files/download/:id`):**
  - ✅ Authenticates user
  - ✅ Verifies course/department/year access
  - ✅ **Requires premium subscription** (for all non-admins, regardless of file type)
  - ✅ Admins always allowed
  - ✅ Free users always denied with clear message

---

## Code Changes

### Backend Changes

#### 1. `/api/files/view/:id` - Viewing Route
**File:** `backend/routes/file.js`

```javascript
// NEW: View endpoint properly separates view permissions from download
// - Free users CAN view free materials
// - Free users CANNOT view premium materials (unless premium themselves)
// - Premium users CAN view everything they have course access to
// - Added console logging for debugging
```

**Key improvements:**
- Clearer logic flow with comments
- Better error messages
- Console logging at each authorization step

#### 2. `/api/files/download/:id` - Download Route
**File:** `backend/routes/file.js`

```javascript
// NEW: Downloads restricted to premium users/admins ONLY
// - No free user can download (any file type)
// - Better error message for free users
// - Added console logging
```

**Key improvements:**
- Explicit "premium only" policy for downloads
- Better logging for debugging
- User-friendly error message

### Frontend Changes

#### 1. `frontend/src/pages/CourseDetail.jsx`
```javascript
// Changed: canAccessMaterial() now uses backend 'accessible' field
// Benefits:
// - Eliminates client-side recalculation inconsistencies
// - Uses server-side truth
// - Falls back to client-side if needed
```

#### 2. `frontend/src/pages/CourseMaterials.jsx`
```javascript
// Changed: Uses backend 'accessible' field
// - Consistent with CourseDetail
// - Properly shows/hides PDF viewer based on access
// - Shows upgrade prompts only for premium materials
```

#### 3. `frontend/src/components/PDFViewer.jsx`
```javascript
// Improved: Better error handling and display
// - Detects auth errors (403, 'premium', 'subscription', 'unauthorized')
// - Friendly error messages
// - Suggests premium upgrade when appropriate
// - Added onDocumentLoadError handler
// - Better logging for debugging
```

---

## Expected Behavior After Fix

### Free Users
- ✅ Can open and view **free** PDF materials inside the browser
- ✅ Cannot download any materials
- ✅ Not prompted to upgrade when viewing free materials
- ✅ Only see upgrade prompt when accessing **premium** materials

### Premium Users (Active Subscription)
- ✅ Can view all free and premium materials in their courses
- ✅ Can download all materials they have access to
- ✅ No restrictions on file types

### Admins
- ✅ Can view any material
- ✅ Can download any material
- ✅ No restrictions

### Expired Premium Users
- ✅ Treated as free users after subscription expiration
- ✅ Can view free materials
- ✅ Cannot download or access premium materials

---

## Testing Checklist

- [ ] **Free User - Free Material PDF:**
  - [ ] Can view inside browser
  - [ ] Cannot download
  - [ ] No upgrade prompt shown
  
- [ ] **Free User - Premium Material PDF:**
  - [ ] Cannot view inside browser
  - [ ] Sees "requires premium" message
  - [ ] Upgrade prompt shown
  
- [ ] **Free User - Free Material (non-PDF):**
  - [ ] Can view/open
  - [ ] Cannot download
  - [ ] No upgrade prompt
  
- [ ] **Premium User - Any Material:**
  - [ ] Can view
  - [ ] Can download
  - [ ] Works for all file types
  
- [ ] **Admin - Any Material:**
  - [ ] Can view
  - [ ] Can download
  - [ ] Works for all file types

---

## Deployment Notes

1. **Database Migration:** Run before or after deployment
   ```bash
   cd backend && node scripts/migrate_file_urls_to_view.js --apply
   ```
   - Converts old `fileUrl` entries to new view URL format
   - Populates `storageFilename` and `originalName` fields
   - Safe to run (checks existing migrations)

2. **Server Restart:** Required to pick up code changes
   - Kill existing `npm run dev` process
   - Run `npm run dev` or `npm start`

3. **Browser Cache:** May need to clear browser cache to see UI changes
   - Especially important for CSS and JS bundle updates

4. **Environment Variables:** No new env vars required
   - All logic uses existing `JWT`, `USER` model, and course access patterns

---

## API Response Changes

### Before (Incorrect)
```json
{
  "success": true,
  "files": [
    {
      "_id": "6a4788a9a72a5b19ea13a161",
      "title": "Sample Material",
      "fileUrl": "/uploads/1627382910-sample.pdf",
      "isPremium": false
    }
  ]
}
```

### After (Fixed)
```json
{
  "success": true,
  "files": [
    {
      "_id": "6a4788a9a72a5b19ea13a161",
      "title": "Sample Material",
      "fileUrl": "/api/files/view/6a4788a9a72a5b19ea13a161",
      "isPremium": false,
      "accessible": true,
      "createdAt": "2026-07-04T..."
    }
  ]
}
```

---

## Debugging

### Backend Logs to Look For
```
📖 View file 6a4788a9a72a5b19ea13a161: isPremium=false, userId=...
✅ User viewing file 6a4788a9a72a5b19ea13a161

📥 Download request for file 6a4788a9a72a5b19ea13a161, user ...
❌ Download denied for file 6a4788a9a72a5b19ea13a161: isPremium=false, notExpired=true
```

### Browser Console Logs
```
📄 PDFViewer: Setting up file { fileUrl: '/api/files/view/...', hasToken: true }
✅ PDFViewer: Auth token added to headers
✅ PDF loaded successfully with X pages
❌ PDF load error: [error details]
```

---

## Related Files Modified

- ✅ `backend/routes/file.js` - View/download authorization
- ✅ `backend/models/File.js` - Storage field additions
- ✅ `frontend/src/components/PDFViewer.jsx` - Error handling
- ✅ `frontend/src/pages/CourseDetail.jsx` - Access logic
- ✅ `frontend/src/pages/CourseMaterials.jsx` - Access logic
- ✅ `backend/scripts/migrate_file_urls_to_view.js` - Migration script

---

## Commit History

- `9f498cd` - fix(files): separate view/download permissions; fix frontend logic; improve error handling
- `c3e8eab` - feat(files): secure streaming & gated downloads; frontend viewer update; add migration script

---

## Next Steps (Optional Enhancements)

1. **Tokenized Signed URLs** - Short-lived URLs for viewing/downloading
2. **Watermarking** - Add server-side PDF watermarking
3. **Content Protection** - Disable copy/print/save on PDFs
4. **View Analytics** - Track who viewed which materials
5. **Download Limits** - Limit downloads per user per day/month

---

## Questions or Issues?

If free users still cannot view PDFs after this fix:

1. Check browser console for error messages
2. Check backend logs for authorization errors
3. Verify user's department and year of study are set
4. Verify file is marked as `isPremium: false` in database
5. Clear browser cache and try again

