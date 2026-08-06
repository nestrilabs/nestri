import { AsyncLocalStorage } from 'node:async_hooks';

import { ErrorCodes, VisibleError } from './error.js';

export namespace Context {
	export class NotFound extends VisibleError {
		constructor() {
			super(
				'internal',
				ErrorCodes.Server.INTERNAL_ERROR,
				'No context available - actor-dependent code was called outside of Actor.with()'
			);
		}
	}

	export function create<T>() {
		const storage = new AsyncLocalStorage<T>();
		return {
			use() {
				const result = storage.getStore();
				if (!result) {
					throw new NotFound();
				}
				return result;
			},
			provide<R>(value: T, fn: () => R) {
				return storage.run<R>(value, fn);
			}
		};
	}
}
