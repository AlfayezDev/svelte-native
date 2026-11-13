import { defineConfig } from 'vite';
import { svelteNative } from '../../../src/vite.ts';

export default defineConfig({ plugins: [svelteNative()] });
