# EMAIL SETUP GUIDE FOR ACADEMY PLATFORM

## Problem
Forgot password and verification emails are not being sent.

## Root Causes
1. **Development Mode**: Emails are skipped (`SKIP_EMAIL_IN_DEV=true` in .env)
2. **No SMTP Credentials**: Gmail credentials not configured

## Solution: Setup Gmail for Email Sending

### Step 1: Enable 2-Factor Authentication on Gmail
1. Go to https://myaccount.google.com
2. Click "Security" in left sidebar
3. Enable "2-Step Verification"

### Step 2: Create App Password
1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer" (or your device)
3. Google will generate a 16-character password
4. Copy this password (no spaces)

### Step 3: Add to Render Environment Variables
Go to your Render Backend Service Dashboard → Environment:

```
SKIP_EMAIL_IN_DEV=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
EMAIL_FROM=your-email@gmail.com
NODE_ENV=production
```

### Step 4: Update Local .env (Optional - for local testing)
If you want to test locally:

```
SKIP_EMAIL_IN_DEV=false
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
EMAIL_FROM=your-email@gmail.com
NODE_ENV=production
```

### Step 5: Restart Backend
After updating Render variables, the backend will auto-redeploy.

### Step 6: Test
Try forgot password again - email should arrive in 1-2 minutes.

## Troubleshooting

### "Gmail App Passwords" not available?
- Ensure 2-Factor Authentication is enabled
- Use a personal Gmail account (not work/organization)

### Still not receiving emails?
1. Check spam/promotions folder
2. Check Render logs for SMTP errors
3. Verify the email address is correct
4. Verify App Password is copied correctly (16 characters, no spaces)

### Alternative: Use SendGrid, Mailgun, or other SMTP
Replace SMTP_HOST/PORT/USER/PASS with your provider's credentials.
