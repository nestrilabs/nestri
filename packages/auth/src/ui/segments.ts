/**
 * Draws a code field as one box per character.
 *
 * An enhancement, not the field. The server sends a single plain input that
 * is complete on its own — it validates, submits and autofills — and this
 * draws boxes under it when script runs. With script off, or if this throws,
 * the person gets the plain field and loses nothing but the look.
 *
 * The boxes are pictures. The real input is stretched invisibly over them and
 * is the only thing that is ever typed into, pasted into or autofilled. This
 * is deliberate, and replaced a version with one input per box: that one
 * worked in a clean browser and broke in a real one, because a password
 * manager or an autofill prompt that hooks a one-time-code field fights any
 * script moving focus between six fields. One ordinary field gives them
 * nothing to fight.
 *
 * Runs once per field: it is emitted directly after the input's wrapper and
 * enhances `document.currentScript`'s previous sibling, so two code fields on
 * one page each get their own copy and neither looks the other up.
 *
 * Plain ES2017 in a string, for the same reason `css.ts` is a string: nothing
 * bundles this page.
 */
export default `(() => {
	const root = document.currentScript && document.currentScript.previousElementSibling;
	if (!root || root.getAttribute('data-component') !== 'segments') return;
	const real = root.querySelector('input');
	const length = Number(root.dataset.length);
	const group = Number(root.dataset.group) || length;
	const numeric = root.dataset.numeric === 'true';
	if (!real || !length) return;

	// What the field may hold. A pasted \`bcdf-3467\` is cleaned to its
	// characters here, so the dash is something the boxes draw and never
	// something typed.
	const clean = (text) => {
		const kept = numeric ? text.replace(/[^0-9]/g, '') : text.replace(/[^0-9a-zA-Z]/g, '');
		return (numeric ? kept : kept.toUpperCase()).slice(0, length);
	};

	const boxes = [];
	const row = document.createElement('div');
	row.setAttribute('data-slot', 'boxes');
	row.setAttribute('aria-hidden', 'true');
	for (let i = 0; i < length; i++) {
		if (i > 0 && i % group === 0) {
			const dash = document.createElement('span');
			dash.setAttribute('data-slot', 'separator');
			dash.textContent = '-';
			row.appendChild(dash);
		}
		const box = document.createElement('div');
		box.setAttribute('data-component', 'input');
		box.setAttribute('data-variant', 'box');
		boxes.push(box);
		row.appendChild(box);
	}

	// The caret lives at the end. Editing in the middle of a code is rarer than
	// retyping its tail, and a caret that could sit anywhere would need its
	// position drawn on boxes that do not have one.
	const toEnd = () => {
		const end = real.value.length;
		if (real.selectionStart !== end || real.selectionEnd !== end) real.setSelectionRange(end, end);
	};

	const render = () => {
		const value = real.value;
		const focused = document.activeElement === real;
		boxes.forEach((box, i) => {
			box.textContent = value[i] || '';
			box.toggleAttribute('data-active', focused && i === Math.min(value.length, length - 1));
		});
		root.toggleAttribute('data-complete', value.length === length);
	};

	real.addEventListener('input', () => {
		const cleaned = clean(real.value);
		if (cleaned !== real.value) real.value = cleaned;
		toEnd();
		render();
	});
	for (const event of ['focus', 'click', 'keyup', 'select']) real.addEventListener(event, () => (toEnd(), render()));
	real.addEventListener('blur', render);

	root.setAttribute('data-enhanced', '');
	root.appendChild(row);
	real.value = clean(real.value);
	render();
})();`;
