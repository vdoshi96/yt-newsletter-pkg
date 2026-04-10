import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Ctx) {
  const { id } = await context.params;
  await prisma.channel.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
