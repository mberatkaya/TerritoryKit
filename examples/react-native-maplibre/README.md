# React Native MapLibre Example

This is a minimal copyable React Native screen. It is not wired into the monorepo CI as a native
build because MapLibre React Native requires Android/iOS project setup, Pods/Gradle, and often Expo
config-plugin work.

Use it inside an existing React Native or Expo dev-client application that already has:

```sh
pnpm add @territory-kit/react-native @maplibre/maplibre-react-native
```

Set `REGISTRY_URL` and `STYLE_URL` in `src/App.tsx` for your environment.
