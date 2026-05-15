import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://jshsakura.github.io",
  base: "/opencode-resolve",
  integrations: [
    starlight({
      title: "opencode-resolve",
      description: "A lightweight resolver/coder harness for OpenCode.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/custom.css"],
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/jshsakura/opencode-resolve",
        },
      ],
      locales: {
        root: {
          label: "English",
          lang: "en",
        },
        ko: {
          label: "한국어",
          lang: "ko",
        },
      },
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Overview", slug: "index" },
            { label: "Install", slug: "start/install" },
            { label: "AI Setup", slug: "start/llm-setup" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Configuration", slug: "reference/configuration" },
            { label: "Agents", slug: "reference/agents" },
            { label: "Troubleshooting", slug: "reference/troubleshooting" },
          ],
        },
        {
          label: "Maintainers",
          items: [{ label: "Development", slug: "maintainers/development" }],
        },
      ],
    }),
  ],
});
