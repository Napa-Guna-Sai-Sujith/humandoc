/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pg", "bcryptjs", "stripe"],
  },
  async rewrites() {
    const api =
      process.env.API_INTERNAL_URL ||
      (process.env.NODE_ENV === "production" ? "https://humandoc.onrender.com" : "http://localhost:8000");
    const s3 = process.env.S3_INTERNAL_URL || "http://localhost:9000";
    return [
      { source: "/backend/:path*", destination: `${api}/:path*` },
      { source: "/s3/:path*", destination: `${s3}/:path*` },
    ];
  },
  async headers() {
    const cspHeader = [
      "default-src 'self' https: http: data: blob: 'unsafe-inline' 'unsafe-eval'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: http: blob: data: chrome-extension:",
      "style-src 'self' 'unsafe-inline' https: http:",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data: https: http:",
      "connect-src 'self' https: http: wss: ws: blob: data: chrome-extension:",
      "frame-src 'self' https: http: blob:",
      "worker-src 'self' blob: data:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https:",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
