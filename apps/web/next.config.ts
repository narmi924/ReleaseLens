import type { NextConfig } from "next";

function normalizedBasePath(value: string | undefined): string {
  const basePath = value?.trim() ?? "";
  if (!basePath || basePath === "/") return "";
  if (
    !basePath.startsWith("/") ||
    basePath.includes("?") ||
    basePath.includes("#")
  ) {
    throw new Error(
      "NEXT_PUBLIC_BASE_PATH must be an absolute URL path without a query or fragment.",
    );
  }
  return basePath.replace(/\/+$/, "");
}

const nextConfig: NextConfig = {
  output: "export",
  // GitHub project Pages lives below /<repository>. Local preview and a
  // custom-domain Pages site both use the empty path. The workflow supplies
  // configure-pages' authoritative base_path at build time.
  basePath: normalizedBasePath(process.env.NEXT_PUBLIC_BASE_PATH),
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
