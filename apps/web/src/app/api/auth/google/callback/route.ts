import { NextRequest, NextResponse } from "next/server";
import { findOrCreateGoogleUser } from "@/lib/auth";
import { createSession } from "@/lib/session";
import { clientIp } from "@/lib/http";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || new URL(request.url).origin;

  if (error || !code) {
    return NextResponse.redirect(new URL("/login?error=google_access_denied", appUrl));
  }

  const storedState = request.cookies.get("google_oauth_state")?.value;
  if (!state || !storedState || state !== storedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", appUrl));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/login?error=google_not_configured", appUrl));
  }

  try {
    const redirectUri = `${appUrl}/api/auth/google/callback`;

    // 1. Exchange code for tokens
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error("Failed to exchange Google token:", await tokenResponse.text());
      return NextResponse.redirect(new URL("/login?error=token_exchange_failed", appUrl));
    }

    const tokenData = await tokenResponse.json();

    // 2. Fetch user profile from Google
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileResponse.ok) {
      console.error("Failed to fetch Google profile:", await profileResponse.text());
      return NextResponse.redirect(new URL("/login?error=profile_fetch_failed", appUrl));
    }

    const profile = await profileResponse.json();
    if (!profile.email) {
      return NextResponse.redirect(new URL("/login?error=email_required", appUrl));
    }

    // 3. Find or create user
    const result = await findOrCreateGoogleUser({
      email: profile.email,
      name: profile.name,
      googleId: profile.sub,
    });

    // 4. Create session
    await createSession(result.userId, {
      remember: true,
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });

    // 5. Redirect to dashboard with session cookie
    const response = NextResponse.redirect(new URL("/dashboard", appUrl));
    response.cookies.delete("google_oauth_state");
    return response;
  } catch (err) {
    console.error("Google auth callback error:", err);
    return NextResponse.redirect(new URL("/login?error=auth_failed", appUrl));
  }
}
