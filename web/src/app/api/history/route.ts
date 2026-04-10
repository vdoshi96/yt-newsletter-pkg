import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit")) || 20, 100);

  const rows = await prisma.analysis.findMany({
    orderBy: { processedAt: "desc" },
    take: limit,
    select: {
      id: true,
      videoId: true,
      channelName: true,
      videoUrl: true,
      processedAt: true,
      payload: true,
    },
  });

  return NextResponse.json({ analyses: rows });
}
