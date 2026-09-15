import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if (existsSync('.env.local')) loadEnvFile('.env.local');
// The checked-in release config contains ONLY a publishable key for legacy static hosting.
const released = existsSync('stock-ai/auth-config.js') ? (await import('../stock-ai/auth-config.js')).default : {};
const url = process.env.PUBLIC_SUPABASE_URL || released.url;
const key = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY || released.key;
if (!url || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url) || !key?.startsWith('sb_publishable_')) {
  throw new Error('Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local or build environment. Only publishable keys are accepted.');
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'style.css', 'script.js', 'stock-ai', 'api']) {
  await cp(path, `dist/${path}`, { recursive: true });
}
await writeFile('dist/stock-ai/auth-config.js', `export default ${JSON.stringify({ url, key })};\n`);
await build({ entryPoints: ['stock-ai/auth.js'], bundle: true, format: 'esm', target: 'es2022', outfile: 'dist/stock-ai/auth.bundle.js', external: ['./auth-config.js', './app.js', './app.js?*', './cloud-sync.js'], minify: true });
console.log('Built dist with publishable Auth configuration.');

// Preserve the existing GitHub Pages branch publishing workflow.
await cp('dist/stock-ai/auth-config.js', 'stock-ai/auth-config.js');
await cp('dist/stock-ai/auth.bundle.js', 'stock-ai/auth.bundle.js');
