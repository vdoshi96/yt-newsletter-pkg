import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { mailConfigured } from "@/lib/pipeline";

export async function GET() {
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return NextResponse.json({
    ok: true,
    gemini: Boolean(process.env.GEMINI_API_KEY),
    email: mailConfigured(),
    session: Boolean(process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16),
    controllerPassword: Boolean(process.env.CONTROLLER_PASSWORD),
    cron: Boolean(process.env.CRON_SECRET),
    db: dbOk,
  });
}
