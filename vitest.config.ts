import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Local audit snapshots can contain historical tests. Run the project's tests
// without collecting ignored scratch copies as another production suite.
export default mergeConfig(viteConfig, defineConfig({
  test: { exclude: [...configDefaults.exclude, '.qa/**'] },
}));
