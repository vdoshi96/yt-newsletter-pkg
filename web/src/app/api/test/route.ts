import { NextResponse } from "next/server";
import {
  parseVideoIdFromUrl,
  processVideo,
} from "@/lib/pipeline";

export const maxDuration = 120;

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const videoUrl =
    typeof body.videoUrl === "string" ? body.videoUrl.trim() : "";
  const dryRun = Boolean(body.dryRun);

  if (!videoUrl) {
    return NextResponse.json({ error: "videoUrl is required" }, { status: 400 });
  }

  const vid = parseVideoIdFromUrl(videoUrl);
  const video = {
    video_id: vid,
    title: `Test (${vid})`,
    channel_name: "Test Channel",
    url: `https://www.youtube.com/watch?v=${vid}`,
  };

  try {
    const analysis = await processVideo(video, { dryRun });
    if (!analysis) {
      return NextResponse.json(
        { error: "Could not fetch transcript (captions may be missing or delayed)" },
        { status: 422 }
      );
    }
    return NextResponse.json({ analysis, dryRun });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Pipeline failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
