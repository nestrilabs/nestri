/**
 * Turns a code field into one box per character.
 *
 * An enhancement, not the field. The server sends a single plain input that
 * is complete on its own — it validates, submits and autofills — and this
 * draws boxes over it when script runs. With script off, or if this throws,
 * the person gets the plain field and loses nothing but the look.
 *
 * The real input stays the one that submits and the one the stylesheet reads
 * validity from, so the button still dims on the same rule. The boxes carry no
 * `name` and are never sent.
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

	// What one box accepts. A pasted \`BCDF-3467\` is cleaned to its characters
	// here, so the dash is something the boxes draw and never something typed.
	const clean = (text) => {
		const kept = numeric ? text.replace(/[^0-9]/g, '') : text.replace(/[^0-9a-zA-Z]/g, '');
		return numeric ? kept : kept.toUpperCase();
	};

	const boxes = [];
	const row = document.createElement('div');
	row.setAttribute('data-slot', 'boxes');
	for (let i = 0; i < length; i++) {
		if (i > 0 && i % group === 0) {
			const dash = document.createElement('span');
			dash.setAttribute('data-slot', 'separator');
			dash.setAttribute('aria-hidden', 'true');
			dash.textContent = '-';
			row.appendChild(dash);
		}
		const box = document.createElement('input');
		box.type = 'text';
		box.setAttribute('data-component', 'input');
		box.setAttribute('data-variant', 'box');
		box.setAttribute('aria-label', real.getAttribute('aria-label') + ', character ' + (i + 1) + ' of ' + length);
		box.inputMode = numeric ? 'numeric' : 'text';
		box.autocapitalize = 'characters';
		box.spellcheck = false;
		// Only the first box offers the one-time-code autofill, and it may be
		// handed the whole code at once — which \`spread\` below deals out.
		box.autocomplete = i === 0 ? real.autocomplete || 'one-time-code' : 'off';
		boxes.push(box);
		row.appendChild(box);
	}

	const sync = () => {
		real.value = boxes.map((b) => b.value).join('');
		// The button dims on the real field's validity, so it must hear this.
		real.dispatchEvent(new Event('input', { bubbles: true }));
	};

	// The first empty box, or the last one if the code is complete.
	const next = () => {
		const empty = boxes.findIndex((b) => !b.value);
		return boxes[empty === -1 ? length - 1 : empty];
	};

	// Put \`text\` into the boxes from \`from\` onwards and move to what is next.
	const spread = (from, text) => {
		const chars = clean(text).split('');
		for (let i = from; i < length && chars.length; i++) boxes[i].value = chars.shift();
		sync();
		next().focus();
	};

	boxes.forEach((box, i) => {
		// Typing into a filled box replaces it, rather than leaving two
		// characters for \`spread\` to guess the order of.
		box.addEventListener('focus', () => box.select());
		box.addEventListener('input', () => {
			const text = box.value;
			box.value = '';
			if (text) spread(i, text);
			else sync();
		});
		box.addEventListener('paste', (event) => {
			event.preventDefault();
			spread(i, (event.clipboardData || window.clipboardData).getData('text'));
		});
		box.addEventListener('keydown', (event) => {
			if (event.key === 'Backspace' && !box.value && i > 0) {
				event.preventDefault();
				boxes[i - 1].value = '';
				boxes[i - 1].focus();
				sync();
			} else if (event.key === 'ArrowLeft' && i > 0) {
				event.preventDefault();
				boxes[i - 1].focus();
			} else if (event.key === 'ArrowRight' && i < length - 1) {
				event.preventDefault();
				boxes[i + 1].focus();
			}
		});
	});

	// The real field is hidden from here on, so the browser's own message
	// would point at nothing. Pressing the button early moves to the first
	// empty box instead, which says what is missing just as plainly.
	real.addEventListener('invalid', (event) => {
		event.preventDefault();
		next().focus();
	});

	real.tabIndex = -1;
	real.setAttribute('aria-hidden', 'true');
	real.autocomplete = 'off';
	root.setAttribute('data-enhanced', '');
	root.appendChild(row);
	const prefilled = clean(real.value).split('');
	boxes.forEach((b) => (b.value = prefilled.shift() || ''));
	sync();
	if (real.autofocus) next().focus();
})();`;
