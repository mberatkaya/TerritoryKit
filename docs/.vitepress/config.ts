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
      { text: "Catalog", link: "/catalog" },
      { text: "Binary Spatial Index", link: "/binary-spatial-index" },
      { text: "Game Territory Engine", link: "/game/overview" },
      { text: "Worker Loading", link: "/worker-loading" },
      { text: "Migration Guide", link: "/migration-guide" },
      { text: "Quick Start", link: "/quick-start" },
      { text: "API", link: "/api" },
      { text: "CLI", link: "/cli" },
      { text: "Country Datasets", link: "/country-datasets" },
      { text: "Country Source Locks", link: "/country-source-locks" },
      { text: "Country Identity", link: "/country-identity" },
      { text: "Country Hierarchy", link: "/country-hierarchy" },
      { text: "Country Loaders", link: "/country-loaders" },
      { text: "Turkey Administrative Model", link: "/datasets/turkey-administrative-model" },
      { text: "Turkey National Coverage", link: "/datasets/turkey-national-coverage" },
      { text: "Turkey Sources", link: "/datasets/turkey-sources" },
      { text: "Turkey ADM3 Source Strategy", link: "/datasets/tr-adm3-source-strategy" },
      { text: "Turkey ADM3 Source Registry", link: "/datasets/tr-adm3-source-registry" },
      { text: "Turkey V2 Data Contract", link: "/datasets/turkey-v2-data-contract" },
      { text: "Turkey V2 Source Provenance", link: "/datasets/turkey-v2-source-provenance" },
      { text: "Turkey V2 Migration", link: "/datasets/turkey-v2-migration" },
      { text: "Geometry Simplification", link: "/geometry-simplification" },
      { text: "Leaflet Integration", link: "/leaflet-integration" },
      { text: "OpenLayers Integration", link: "/openlayers-integration" },
      { text: "Renderer Adapter Comparison", link: "/renderer-adapter-comparison" },
      { text: "Turkey MapLibre Example", link: "/examples/turkey-maplibre" },
      { text: "Turkey Leaflet Example", link: "/examples/turkey-leaflet" },
      { text: "Turkey OpenLayers Example", link: "/examples/turkey-openlayers" },
      { text: "Roadmap", link: "/roadmap" }
    ]
  }
});
