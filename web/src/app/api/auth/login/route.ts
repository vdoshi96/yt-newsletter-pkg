import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSessionToken, cookieName } from "@/lib/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  const expected = process.env.CONTROLLER_PASSWORD;

  if (!expected) {
    return NextResponse.json(
      { error: "CONTROLLER_PASSWORD is not configured on the server" },
      { status: 500 }
    );
  }

  if (password !== expected) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  let token: string;
  try {
    token = await createSessionToken();
  } catch {
    return NextResponse.json(
      { error: "SESSION_SECRET is missing or too short (min 16 chars)" },
      { status: 500 }
    );
  }
  const store = await cookies();
  store.set(cookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return NextResponse.json({ ok: true });
}
