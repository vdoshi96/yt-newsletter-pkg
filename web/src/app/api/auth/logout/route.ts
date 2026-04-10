import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cookieName } from "@/lib/session";

export async function POST() {
  const store = await cookies();
  store.delete(cookieName());
  return NextResponse.json({ ok: true });
}
