import { NextResponse } from "next/server";
import { sendWeeklyRecap } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST() {
  try {
    const { count } = await sendWeeklyRecap();
    if (count === 0) {
      return NextResponse.json({
        ok: true,
        message: "No analyses in the last 7 days; recap email not sent",
        count: 0,
      });
    }
    return NextResponse.json({ ok: true, count });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Recap failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
