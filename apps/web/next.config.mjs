/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["pg", "bcryptjs", "stripe"],
  },
  async rewrites() {
    const api = process.env.API_INTERNAL_URL || "http://localhost:8000";
    const s3 = process.env.S3_INTERNAL_URL || "http://localhost:9000";
    return [
      { source: "/backend/:path*", destination: `${api}/:path*` },
      { source: "/s3/:path*", destination: `${s3}/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
