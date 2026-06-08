# EMAIL SETUP GUIDE FOR ACADEMY PLATFORM

## Problem
Forgot password and verification emails were not being sent from production.

## Solution: Use SendGrid SMTP Relay
Render blocks direct Gmail SMTP connections on many plans, so SendGrid is the recommended provider.

## Step 1: Create a SendGrid API Key
1. Go to https://sendgrid.com and sign up for a free account.
2. Verify your email.
3. Go to **Settings** → **API Keys**.
4. Click **Create API Key**.
5. Choose **Full Access** or at least **Mail Send** permissions.
6. Copy the generated API key.

## Step 2: Add to Render Environment Variables
Go to your Render Backend Service Dashboard → Environment:

```
SKIP_EMAIL_IN_DEV=false
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=timilehinadegbite0@gmail.com
NODE_ENV=production
```

> If you still want to use Gmail SMTP instead, keep `SKIP_EMAIL_IN_DEV=false` and configure SMTP values as shown below. SendGrid is the preferred option for Render.

## Optional: Gmail SMTP Setup (not recommended on Render)
```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-gmail-app-password
```

## Step 3: Restart / Deploy
Save the environment variables in Render. The backend should auto-redeploy and connect using SendGrid.

## Step 4: Test
1. Sign up with a new email.
2. Request password reset or email verification.
3. Check your inbox and spam folder.

## Troubleshooting
- If email sending still fails, check Render logs for errors.
- Confirm `SENDGRID_API_KEY` is present and correct.
- Confirm `EMAIL_FROM` is a valid sender email address.
- Make sure `SKIP_EMAIL_IN_DEV=false` in production.

## Local Development
If you are testing locally, email sending will use Ethereal by default unless you configure SMTP or SendGrid in `.env`.

Example local `.env` values for SendGrid:
```
SENDGRID_API_KEY=your-sendgrid-api-key
EMAIL_FROM=your-email@gmail.com
SKIP_EMAIL_IN_DEV=false
NODE_ENV=development
```

## Notes
- The code now supports SendGrid via `SENDGRID_API_KEY`.
- If `SENDGRID_API_KEY` is not set, it falls back to `SMTP_HOST` or Ethereal in development.
