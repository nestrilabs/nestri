import { actor } from "actor-core";

export const counter = actor({
	state: { count: 0 },
	actions: {
		increment: (c, x: number) => {
			c.state.count += x;
			c.broadcast("newCount", c.state.count);
			return c.state.count;
		},
		getCount: (c) => {
			return c.state.count;
		},
	},
});