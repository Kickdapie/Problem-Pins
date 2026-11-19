// Lets plain `node` run scripts that import the app's TypeScript sources. Those use
// extensionless relative imports (`./geo`) the way Vite resolves them; Node needs `./geo.ts`.
// Usage: node --import ./scripts/ts-hooks.ts scripts/<script>.ts
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context);
      }
      throw error;
    }
  },
});
