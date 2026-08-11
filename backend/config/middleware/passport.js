const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../../models/User");

function buildCallbackUrl(req) {
  if (process.env.GOOGLE_CALLBACK_URL) {
    return process.env.GOOGLE_CALLBACK_URL;
  }

  const forwardedProto = req?.headers?.['x-forwarded-proto']?.split(',')[0]?.trim();
  const forwardedHost = req?.headers?.['x-forwarded-host']?.split(',')[0]?.trim();
  const protocol = forwardedProto || (req?.secure ? 'https' : 'http');
  const host = forwardedHost || req?.headers?.host || 'localhost:5000';
  return `${protocol}://${host}/api/auth/google/callback`;
}

passport.buildCallbackUrl = buildCallbackUrl;

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
    },

    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({
          email: profile.emails[0].value
        });

        if (!user) {
          user = await User.create({
            name: profile.displayName,
            email: profile.emails[0].value,
            googleId: profile.id
          });
        }

        done(null, user);

      } catch (err) {
        done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const User = require("../../models/User");
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

console.log("GOOGLE STRATEGY LOADED");

module.exports = passport;