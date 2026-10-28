import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative assets work both at /musicgame/ on GitHub Pages and / on EdgeOne.
export default defineConfig({ base: './', plugins: [react()] });
