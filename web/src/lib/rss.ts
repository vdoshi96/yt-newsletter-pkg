export type FeedVideo = {
  video_id: string;
  title: string;
  published: string;
  channel_name: string;
  channel_id: string;
  url: string;
};

/**
 * Last N videos from a channel RSS feed (same source as Python monitor).
 */
export async function getLatestVideos(
  channelId: string,
  channelName: string,
  limit = 5
): Promise<FeedVideo[]> {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "yt-newsletter-controller/1.0" },
    next: { revalidate: 0 },
  });
  if (!res.ok) {
    throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  }
  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  const videos: FeedVideo[] = [];

  for (const [, block] of entries) {
    const idMatch =
      block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) ||
      block.match(/<id>yt:video:([^<]+)<\/id>/);
    if (!idMatch) continue;

    const titleMatch = block.match(/<title(?:[^>]*)>([^<]*)<\/title>/);
    const publishedMatch = block.match(/<published>([^<]+)<\/published>/);
    const title = decodeXmlEntities(titleMatch?.[1]?.trim() ?? "Untitled");
    const vid = idMatch[1];

    videos.push({
      video_id: vid,
      title,
      published: publishedMatch?.[1] ?? "",
      channel_name: channelName,
      channel_id: channelId,
      url: `https://www.youtube.com/watch?v=${vid}`,
    });
    if (videos.length >= limit) break;
  }

  return videos;
}

function decodeXmlEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
