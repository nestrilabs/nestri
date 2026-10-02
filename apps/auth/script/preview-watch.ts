/**
 * Runs `preview.ts`, and runs it again whenever the sign-in UI's source changes.
 *
 * Not `bun --watch`, which watches each imported file. Many editors save by
 * writing a new file and renaming it over the old one, and a watch on a file
 * does not follow the rename: the first such save reloads, and every one after
 * it is silently ignored. A watch on the directory sees every save, however it
 * was made.
 */

import { watch } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..', '..', '..');
const DIRS = [join(ROOT, 'packages/auth/src'), join(ROOT, 'apps/auth/src'), import.meta.dir];
const SERVER = join(import.meta.dir, 'preview.ts');

let child = start();
let timer: ReturnType<typeof setTimeout> | undefined;

function start() {
	return Bun.spawn(['bun', SERVER], { stdio: ['inherit', 'inherit', 'inherit'] });
}

async function restart(file: string) {
	child.kill();
	// The port is free only once the old server has exited.
	await child.exited;
	console.log(`changed: ${file}`);
	child = start();
}

for (const dir of DIRS) {
	watch(dir, { recursive: true }, (_event, file) => {
		if (!file || !/\.(ts|tsx)$/.test(file)) return;
		// One save can be several events: a write, then a rename.
		clearTimeout(timer);
		timer = setTimeout(() => restart(file), 60);
	});
}

// Ctrl-C reaches the whole process group, but a plain `kill` reaches only
// this process, and would leave the server holding the port.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
	process.on(signal, () => {
		child.kill();
		process.exit(0);
	});
}
