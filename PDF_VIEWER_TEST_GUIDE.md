# PDF Viewer Fix - Complete Testing Guide

## Quick Start
All fixes are deployed and ready to test. No additional configuration needed.

## Pre-Test Checklist
- [x] Backend routes updated
- [x] Frontend component updated  
- [x] Database migration completed (2 files fixed)
- [x] No syntax errors
- [x] All files deployed

## Test Scenarios

### 1. Admin Upload & View PDF

**Steps:**
1. Log in as admin
2. Go to admin panel / courses
3. Select a course
4. Upload a new PDF file (e.g., test_document.pdf)
5. Save and verify upload succeeds
6. Open course detail/materials page
7. Click on the newly uploaded PDF

**Expected Result:**
- PDF displays inline with viewer
- Shows page count and navigation buttons
- Can zoom in/out
- Can navigate pages
- NO automatic download
- URL should be: `/api/files/download/{timestamp}-test_document.pdf` (single timestamp)

**Check Database:**
```javascript
// In MongoDB shell or compass
db.files.findOne({title: "test_document.pdf"})
// fileUrl should be: /api/files/download/{TIMESTAMP}-test_document.pdf (single timestamp)
```

### 2. Student View Existing PDF

**Steps:**
1. Log in as student
2. Navigate to a course with existing PDF materials
3. Click on PDF material from "Materials" section

**Expected Result:**
- PDF displays inline (no automatic download)
- Viewer shows all controls
- Can navigate and zoom
- Student view works same as admin
- Existing PDF displays correctly (even if uploaded before fix)

### 3. Student View New PDF

**Steps:**
1. Admin uploads new PDF to student's course
2. Log in as student
3. Navigate to that course
4. Click on the newly uploaded PDF

**Expected Result:**
- PDF displays inline
- Same functionality as existing PDFs

### 4. Non-PDF File Download

**Steps:**
1. Admin uploads Word doc, Excel sheet, or other file to a course
2. Student or admin clicks on the file

**Expected Result:**
- File downloads automatically (browser download prompt)
- Does NOT display inline
- This is correct behavior for non-PDF files

### 5. Premium PDF Access Control

**Steps:**
1. Admin marks a PDF as "Premium"
2. Student without premium tries to access course
3. Student with active premium accesses course

**Expected Result:**
- Non-premium student sees "Premium" badge and "Upgrade" button
- Premium student sees PDF viewer
- Access control still enforced correctly

### 6. Authentication & Fallback

**Steps:**
1. Check old and new files work together
2. Upload new PDF
3. Verify old PDFs (from before fix) still work

**Expected Result:**
- All PDFs display inline regardless of upload date
- Fallback logic handles old format URLs
- No file not found errors

### 7. Browser Cache Performance

**Steps:**
1. Open course with PDF
2. Load PDF viewer
3. Open same PDF again in another tab
4. Check Network tab in DevTools

**Expected Result:**
- First load: Full PDF download
- Second load: Cached from browser (should show 304 or cached)
- Cache-Control header: `public, max-age=3600`

## Browser DevTools Verification

### Check Response Headers
1. Open DevTools (F12)
2. Go to Network tab
3. Load a course with PDF
4. Click on PDF
5. Find the `/api/files/download/{filename}` request
6. Click on it and check Response Headers

**Expected Headers:**
```
Content-Type: application/pdf
Content-Disposition: inline; filename="document.pdf"
Cache-Control: public, max-age=3600
```

### Check Auth Headers
1. In Network tab, click on PDF request
2. Go to Request Headers
3. Verify: `Authorization: Bearer {token}`

**Expected:**
- Authorization header present
- Contains valid JWT token
- Format: `Bearer {token}`

## Console Error Checks

1. Open DevTools Console (F12 > Console)
2. Load course with PDF
3. Click on PDF material
4. Watch for errors

**Expected:**
- NO errors in console
- No 404 errors
- No auth errors
- PDF.js loads successfully

**Potential Errors to Watch For:**
- `404 File not found` → Check fallback logic
- `403 Unauthorized` → Check auth token
- `CORS error` → Check backend headers
- `PDF.js worker error` → Check CDN URL

## Performance Metrics

**Track these before and after:**

1. **PDF Load Time**
   - First load should be ~1-2 seconds
   - Subsequent loads should be <100ms (cached)

2. **Network Usage**
   - First load: Full PDF size
   - Cached loads: 0 bytes (from cache)

3. **Server Load**
   - With caching, repeated PDF access has minimal impact
   - Cache-Control header reduces server requests

## Rollback Procedure (If Needed)

If issues occur:

1. **Restore Previous File Routes**
   - Revert `backend/routes/file.js` to previous version
   - This includes the admin `res.download()` behavior

2. **Restore Previous PDFViewer**
   - Revert `frontend/src/components/PDFViewer.jsx`
   - Remove auth header logic

3. **No Database Rollback Needed**
   - Migration script fixed database to new format
   - Files still work with new backend code
   - If reverting backend, use old file routes that understand both formats

## Troubleshooting

### Issue: PDF Still Downloads
**Solutions:**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh page (Ctrl+F5)
3. Check Response Headers in DevTools
4. Verify `Content-Disposition: inline` (not `attachment`)

### Issue: PDF Not Loading / Blank
**Solutions:**
1. Check browser console for errors
2. Verify file exists in `/backend/uploads/` directory
3. Check auth token in localStorage (DevTools > Application > localStorage > token)
4. Verify File record in database
5. Check Network tab for 404 or 403 errors

### Issue: Authentication Failing
**Solutions:**
1. Re-login to get fresh token
2. Check token expiration
3. Verify Authorization header format in DevTools
4. Check backend is sending correct CORS headers

### Issue: Old PDFs Not Found
**Solutions:**
1. Check fallback logic is active
2. Verify migration script ran successfully
3. Check both old and new format files exist in database
4. Monitor console for "File not found" messages

## Automated Test Suite (Optional)

```javascript
// Manual test cases using curl
// Test admin PDF access
curl -H "Authorization: Bearer {adminToken}" \
  http://localhost:5000/api/files/download/{timestamp}-document.pdf

// Test student PDF access
curl -H "Authorization: Bearer {studentToken}" \
  http://localhost:5000/api/files/download/{timestamp}-document.pdf

// Verify inline response
# Should see: Content-Disposition: inline
# Should NOT see: Content-Disposition: attachment
```

## Success Indicators ✅

All of these should be true:

1. ✅ Admin users can upload PDFs
2. ✅ PDFs display inline with viewer
3. ✅ No automatic downloads triggered
4. ✅ All controls work (zoom, navigation, download)
5. ✅ Students can view accessible PDFs
6. ✅ Premium access control enforced
7. ✅ Old PDFs still display
8. ✅ New PDFs display with single timestamp
9. ✅ Non-PDF files download correctly
10. ✅ Response headers are correct
11. ✅ Auth token sent in requests
12. ✅ Caching working (Cache-Control header)
13. ✅ No console errors
14. ✅ No 404 or 403 errors for accessible files

## Known Limitations

1. **PDF.js Worker CDN**
   - Uses Cloudflare CDN for PDF.js worker
   - Requires internet connection
   - If CDN is down, PDF loading fails

2. **Browser Support**
   - PDF viewer works in all modern browsers
   - IE not supported (uses react-pdf)

3. **Large Files**
   - Very large PDFs (>50MB) may load slowly
   - Cache helps with repeated access

4. **Concurrent Access**
   - Multiple simultaneous PDF opens should work fine
   - Each opens in separate viewer instance

## Next Steps

1. **If All Tests Pass**
   - Fix is complete and production-ready
   - No further action needed

2. **If Tests Fail**
   - Check troubleshooting section
   - Review error messages in console
   - Check backend logs
   - Verify database migration ran

3. **Monitor Production**
   - Watch for error rates
   - Monitor performance metrics
   - Check storage disk usage
   - Verify cache hit rates

## Support & Documentation

- See `PDF_VIEWER_FIX_GUIDE.md` for implementation details
- See `PDF_VIEWER_FIX_COMPLETION_REPORT.md` for changes summary
- Check backend logs for any server-side issues
- Use DevTools for client-side debugging
