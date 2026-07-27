# Native icon and splash sources

These five SVGs are the art the committed native icons and splash screens were rendered from, laid out the way `@capacitor/assets` expects to find them:

| file                  | renders                                    |
| --------------------- | ------------------------------------------ |
| `icon-only.svg`       | the iOS app icon                           |
| `icon-background.svg` | the Android adaptive-icon background layer |
| `icon-foreground.svg` | the Android adaptive-icon foreground layer |
| `splash.svg`          | the iOS and Android light splash screens   |
| `splash-dark.svg`     | the iOS and Android dark splash screens    |

The rendered images are committed under `ios/` and `android/`, so a normal build never runs a generator. Keep these SVGs anyway: they are the only way to re-render that art at every density if the mark changes.

To re-render, run the generator from the repo root:

```sh
pnpm dlx @capacitor/assets@3.0.5 generate
```

It is deliberately neither a dependency nor a package script. It pulls in a few hundred packages, including an image library whose native build this repo's pnpm build-script allowlist blocks, so wiring it into `pnpm install` would cost every install a large dependency tree for a tool that only runs when the brand mark changes. Allow that build in the environment where you actually re-render.
