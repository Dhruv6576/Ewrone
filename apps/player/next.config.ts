import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@boxcodex/shared"],
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  devIndicators: false,
};

export default nextConfig;
