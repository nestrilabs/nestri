// Files imported `with { type: 'text' }` arrive as their contents.
declare module '*.sh' {
	const text: string;
	export default text;
}
