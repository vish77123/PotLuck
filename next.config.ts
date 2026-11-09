import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second browser identity (127.0.0.1 vs localhost) join a table while developing.
  allowedDevOrigins: ["127.0.0.1", "*.localhost"],
};

export default nextConfig;
