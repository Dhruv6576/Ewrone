import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@boxcodex/shared"],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/owner/turfs",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
