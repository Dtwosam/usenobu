import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Domain code uses ESM .js import specifiers that map to .ts sources
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
  // node:sqlite is built into Node 22+
  serverExternalPackages: [],
};

export default nextConfig;
