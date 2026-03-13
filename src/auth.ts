import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import Facebook from "next-auth/providers/facebook";
import MicrosoftEntraId from "next-auth/providers/microsoft-entra-id";

const providers: NextAuthConfig["providers"] = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}
if (process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET) {
  providers.push(
    Apple({
      clientId: process.env.APPLE_CLIENT_ID,
      clientSecret: process.env.APPLE_CLIENT_SECRET,
      profile(profile) {
        return {
          id: profile.sub,
          name: profile.name
            ? `${profile.name.firstName ?? ""} ${profile.name.lastName ?? ""}`.trim()
            : profile.email?.split("@")[0] ?? null,
          email: profile.email,
          image: null,
        };
      },
    })
  );
}
if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET) {
  providers.push(
    MicrosoftEntraId({
      clientId: process.env.MICROSOFT_CLIENT_ID,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
    })
  );
}
if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET) {
  providers.push(
    Facebook({
      clientId: process.env.FACEBOOK_CLIENT_ID,
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    })
  );
}

const config: NextAuthConfig = {
  debug: process.env.NODE_ENV !== "production",
  providers,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isProtected = nextUrl.pathname.startsWith("/portal") || nextUrl.pathname.startsWith("/karaslice");
      if (isProtected && !isLoggedIn) {
        return Response.redirect(new URL("/login", nextUrl));
      }
      return true;
    },
    jwt({ token, user, profile, account }) {
      // On first sign-in, capture the name from the user/profile
      if (user) {
        // Apple sends name only on first auth — persist it in the token
        if (user.name && user.name !== user.email) {
          token.name = user.name;
        }
        // For Apple, also check the profile object which may have the name
        if (account?.provider === "apple" && profile?.name) {
          const appleName = profile.name as { firstName?: string; lastName?: string };
          const fullName = `${appleName.firstName ?? ""} ${appleName.lastName ?? ""}`.trim();
          if (fullName) {
            token.name = fullName;
          }
        }
      }
      return token;
    },
    session({ session, token }) {
      // Propagate persisted name from JWT into the session
      if (token.name && session.user) {
        session.user.name = token.name as string;
      }
      return session;
    },
  },
};

export const { handlers, signIn, signOut, auth } = NextAuth(config);
