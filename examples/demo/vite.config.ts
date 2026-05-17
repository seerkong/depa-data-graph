import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import vue from '@vitejs/plugin-vue';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [
    vue(),
    react({
      include: [/src\/views\/react\/.*\.(t|j)sx$/],
    }),
    solid({
      include: [/src\/views\/solid\/.*\.(t|j)sx$/],
    }),
  ],
});
