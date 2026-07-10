import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: ".next",
  images: {
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
    unoptimized: true,
  },
  devIndicators: false,
};

export default nextConfig;
