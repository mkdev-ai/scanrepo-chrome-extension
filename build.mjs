// Build: bundles each extension entry point separately and assembles dist/.
import { build, context } from 'esbuild';
import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(root, 'src');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

const entryPoints = [
  { in: path.join(src, 'background/index.js'), out: 'background' },
  { in: path.join(src, 'content/index.js'), out: 'content' },
  { in: path.join(src, 'options/options.js'), out: 'options' },
];

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints,
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome110',
  platform: 'browser',
  sourcemap: false,
  logLevel: 'info',
  minify: !watch,
};

async function copyStatic() {
  await mkdir(path.join(dist, 'icons'), { recursive: true });
  await cp(path.join(src, 'manifest.json'), path.join(dist, 'manifest.json'));
  await cp(path.join(src, 'content/content.css'), path.join(dist, 'content.css'));
  await cp(path.join(src, 'options/options.html'), path.join(dist, 'options.html'));
  await cp(path.join(src, 'options/options.css'), path.join(dist, 'options.css'));

  const iconsDir = path.join(root, 'icons');
  if (existsSync(iconsDir)) {
    for (const name of await readFile(path.join(root, 'icons/manifest.txt'), 'utf8')
      .then((/** @type {string} */ t) => t.split('\n').filter(Boolean))
      .catch(() => [])) {
      await cp(path.join(iconsDir, name), path.join(dist, 'icons', name));
    }
  }
}

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    await copyStatic();
    console.log('watching for changes…');
    return;
  }

  await build(options);
  await copyStatic();
  await writeFile(
    path.join(dist, 'BUILD_INFO.txt'),
    `built ${new Date().toISOString()}\n`,
    'utf8',
  );
  console.log('build complete → dist/');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});