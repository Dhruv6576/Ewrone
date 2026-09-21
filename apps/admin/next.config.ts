import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@boxcodex/shared"],
  async redirects() {
    return [
      {
        source: "/",
        destination: "/admin/turfs",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
