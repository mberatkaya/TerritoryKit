import { defineConfig } from "vitepress";

export default defineConfig({
  title: "TerritoryKit",
  description: "Hierarchical geospatial territory engine for TypeScript.",
  themeConfig: {
    nav: [
      { text: "Quick Start", link: "/quick-start" },
      { text: "Roadmap", link: "/roadmap" },
      { text: "PRD", link: "/prd" }
    ],
    sidebar: [
      { text: "Introduction", link: "/" },
      { text: "Product Requirements", link: "/prd" },
      { text: "H3 Comparison", link: "/h3-comparison" },
      { text: "Risk Register", link: "/risk-register" },
      { text: "Dataset Compatibility", link: "/dataset-compatibility" },
      { text: "Schema Migrations", link: "/schema-migrations" },
      { text: "Benchmarks", link: "/benchmarks" },
      { text: "Viewport Transitions", link: "/viewport-transitions" },
      { text: "Migration Guide", link: "/migration-guide" },
      { text: "Quick Start", link: "/quick-start" },
      { text: "API", link: "/api" },
      { text: "CLI", link: "/cli" },
      { text: "Roadmap", link: "/roadmap" }
    ]
  }
});
