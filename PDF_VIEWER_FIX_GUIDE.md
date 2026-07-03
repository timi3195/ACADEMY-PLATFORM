# PDF Viewer Fix - Complete Implementation Guide

## Issues Fixed

### 1. **Double Timestamp Bug in File URLs**
- **Problem**: Uploaded files had URLs like `/api/files/download/1234567890-1234567890-document.pdf` (double timestamp)
- **Root Cause**: The upload route was adding `Date.now()` while `req.file.filename` already contained it from the storage config
- **Fix**: Removed the extra `Date.now()` in the upload route (line 41 of `backend/routes/file.js`)

### 2. **Forced Download Instead of Inline Viewing**
- **Problem**: Admin users always got `res.download()` which forced file downloads
- **Root Cause**: PDF inline logic was placed after admin user check, making it unreachable for admins
- **Fix**: Reorganized the download route to check if file is PDF BEFORE role-based access control
  - All users (admin and students) now get inline PDFs with `Content-Disposition: inline`
  - Non-PDF files still force download as expected

### 3. **Missing Authentication Headers in PDF Fetching**
- **Problem**: React-pdf might not include auth tokens when fetching protected PDFs
- **Root Cause**: PDFViewer component was passing plain URL string without auth headers
- **Fix**: Updated PDFViewer to:
  - Extract auth token from localStorage
  - Create a file object with `httpHeaders` containing `Authorization` bearer token
  - Pass this authenticated file object to react-pdf's Document component

### 4. **File Not Found Errors for Existing Files**
- **Problem**: Existing files with double timestamps couldn't be found
- **Root Cause**: Upload fix changes the expected fileUrl format
- **Fix**: Added fallback logic in download route to find files with both old and new formats

## Files Modified

### Backend (`backend/routes/file.js`)
1. **Line 41**: Fixed upload route - removed duplicate `Date.now()`
   ```javascript
   // Before: fileUrl: `/api/files/download/${Date.now()}-${req.file.filename}`
   // After:  fileUrl: `/api/files/download/${req.file.filename}`
   ```

2. **Lines 54-85**: Reorganized download route
   - Check if file exists on server first
   - Moved PDF detection before user role checks
   - Serve PDFs inline for ALL users (admin and students)
   - Added fallback logic for finding old format files
   - Added `Cache-Control` header for CDN optimization

### Frontend (`frontend/src/components/PDFViewer.jsx`)
1. **Added authentication support**:
   - Added `useEffect` hook to prepare file object with auth headers
   - Extract token from localStorage
   - Include Authorization bearer token in httpHeaders
   - Pass authenticated file object to Document component instead of plain URL

2. **Updated Document component**:
   - Changed from `file={fileUrl}` to `file={fileWithAuth}`
   - Wait for auth setup before rendering PDF

### Database Migration Script (`backend/scripts/fix_file_urls.js`)
- New script to fix existing files with double timestamp URLs
- Identifies files with pattern: `/api/files/download/{timestamp}-{timestamp}-{filename}`
- Corrects them to: `/api/files/download/{timestamp}-{filename}`

## Implementation Steps

### Step 1: Deploy Backend Changes
The backend is already updated with:
- Fixed upload route (no more double timestamps)
- Reorganized download route (PDFs now serve inline)
- Fallback logic for existing files (backwards compatible)

### Step 2: Deploy Frontend Changes
The frontend is updated with:
- Authentication support in PDFViewer
- Proper token handling for protected PDFs

### Step 3: Run Database Migration (Optional but Recommended)
To clean up existing files with double timestamps:

```bash
# Navigate to backend directory
cd backend

# Run the migration script
node scripts/fix_file_urls.js
```

This script will:
- Connect to MongoDB
- Find all files with double timestamp URLs
- Correct them to the new format
- Display a summary of fixed files

**Note**: The fallback logic in the download route means this migration is optional for functionality, but recommended for database cleanliness.

## Verification Steps

### 1. **Test PDF Upload**
- Log in as admin
- Upload a new PDF file to a course
- Verify the fileUrl in database is `/api/files/download/{timestamp}-{filename}` (single timestamp)

### 2. **Test PDF Viewing - Admin**
- Open the course
- Click on the PDF material
- Verify PDF displays inline in the viewer (no automatic download)
- Test zoom, page navigation, and download button

### 3. **Test PDF Viewing - Student**
- Log in as a student with course access
- Open a course with PDF materials
- Verify PDF displays inline
- Verify premium-gated PDFs show proper access messages

### 4. **Test Non-PDF Files**
- Upload a non-PDF file (Word, Excel, etc.)
- Verify clicking it triggers a download (not inline viewing)

### 5. **Test Existing Files**
- Verify existing courses with PDFs still load correctly
- Both old (double timestamp) and new (single timestamp) formats work

## Response Headers

The fix ensures correct HTTP response headers for PDFs:

```
Content-Type: application/pdf
Content-Disposition: inline; filename="course-material.pdf"
Cache-Control: public, max-age=3600
```

These headers ensure:
- Browser recognizes the content as PDF
- `inline` disposition tells browser to display in-page instead of downloading
- Cache headers optimize performance for repeated access

## Backwards Compatibility

The solution is fully backwards compatible:
- Old files with double timestamp URLs still work through fallback logic
- New uploads use the correct format
- Migration script is optional (fallback handles both formats)
- No breaking changes to API contracts

## Troubleshooting

### PDFs Still Downloading
1. Clear browser cache
2. Check that auth token is in localStorage
3. Verify `Content-Disposition: inline` in response headers (DevTools Network tab)
4. Check browser console for PDF.js errors

### PDF Not Loading / Blank Viewer
1. Check browser console for 404 errors
2. Verify file exists in `/backend/uploads/` directory
3. Check auth token is valid and not expired
4. Verify File record exists in database with correct fileUrl

### Migration Script Errors
1. Ensure MongoDB connection string is correct in `.env`
2. Check that `MONGO_URI` is set in backend `.env`
3. Verify Node.js version is 14+
4. Ensure mongoose models are properly configured

## Performance Optimization

- Added `Cache-Control: public, max-age=3600` header
- PDFs can be cached for 1 hour by browsers and CDNs
- Subsequent requests for same file load faster
- Cache is bypassed on new file versions

## Security Considerations

- Auth tokens are sent only to protected `/api/files/download/` endpoint
- Tokens are not exposed in file URLs (stored in headers)
- Premium file access validation remains intact
- Department/year access control still enforced
