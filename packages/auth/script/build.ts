import { Glob, $ } from 'bun';

import pkg from '../package.json';

await $`rm -rf dist`;
const files = new Glob('./src/**/*.{ts,tsx}').scan();
for await (const file of files) {
	await Bun.build({
		format: 'esm',
		outdir: 'dist/esm',
		external: ['*'],
		root: 'src',
		entrypoints: [file]
	});
}
await Bun.build({
	format: 'esm',
	outdir: 'dist/esm',
	external: [...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)],
	root: 'src',
	// The renderer, bundled with the layout and stylesheet it pulls in. It is
	// the one entry point whose imports must be followed rather than left
	// external, because a consumer replacing the pages still imports this to
	// build on it.
	entrypoints: ['./src/ui/render.tsx']
});
await $`tsc --outDir dist/types --declaration --emitDeclarationOnly --declarationMap`;
