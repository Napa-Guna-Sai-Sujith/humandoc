import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.APP_URL || "https://humandoc.vercel.app";
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/login", "/register", "/responsible-use", "/legal/privacy", "/legal/terms"],
        disallow: ["/api/", "/backend/", "/admin", "/dashboard", "/jobs/", "/settings", "/history", "/invoices"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
