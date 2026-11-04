import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  // Deliberate allowlist. Never derive entries from users, chats or other stored data.
  return ["/", "/about", "/privacy"].map((path) => ({
    url: new URL(path, SITE_URL).href,
  }));
}
