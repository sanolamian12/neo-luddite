import type { Metadata } from "next";

// The original product is the acquisition destination, including on preview builds.
export const SITE_URL = "https://neo-luddite.vercel.app";

/** Only intentional public information pages opt in to indexing and sharing. */
export function publicPageMetadata(path: "/" | "/about" | "/privacy", title: string, description: string): Metadata {
  const url = new URL(path, SITE_URL).href;
  const image = {
    url: `${SITE_URL}/brand/social-preview.png`,
    width: 1200,
    height: 630,
    alt: "Credigraph — 세금 고민, 편하게 물어보세요.",
  };

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      locale: "ko_KR",
      siteName: "Credigraph",
      title,
      description,
      url,
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}
