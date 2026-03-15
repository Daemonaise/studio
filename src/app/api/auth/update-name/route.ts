import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { sanitizeName, nameUpdateLimiter } from "@/lib/security";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit by user
  const rateLimitKey = session.user.email ?? session.user.id ?? "unknown";
  const rateCheck = nameUpdateLimiter.check(rateLimitKey);
  if (!rateCheck.allowed) {
    return NextResponse.json({ error: "Too many requests — please wait" }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { name } = body;

    // Sanitize name input (strips HTML, control chars, enforces length)
    const nameCheck = sanitizeName(name);
    if (!nameCheck.valid) {
      return NextResponse.json({ error: nameCheck.error ?? "Invalid name" }, { status: 400 });
    }

    const response = NextResponse.json({ success: true, name: nameCheck.sanitized });
    response.cookies.set("user_display_name", nameCheck.sanitized, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
