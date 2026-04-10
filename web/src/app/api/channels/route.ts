import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const channels = await prisma.channel.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ channels });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";
  const sport =
    typeof body.sport === "string" && body.sport.trim()
      ? body.sport.trim()
      : "basketball";

  if (!name || !channelId) {
    return NextResponse.json(
      { error: "name and channelId are required" },
      { status: 400 }
    );
  }

  try {
    const ch = await prisma.channel.create({
      data: { name, channelId, sport },
    });
    return NextResponse.json({ channel: ch });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Create failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
