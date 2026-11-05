import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-metadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Crawl preferences only; access control remains the responsibility of the app.
      disallow: [
        "/api/", "/chat", "/consultations", "/rooms", "/audit", "/admin",
        "/account", "/auth", "/login", "/register", "/forgot-password",
        "/reset-password", "/expert", "/select", "/offers", "/demo",
        "/design-system",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
