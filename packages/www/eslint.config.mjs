import eslintPluginAstro from 'eslint-plugin-astro';

export default [
    ...eslintPluginAstro.configs['flat/recommended'], // In CommonJS, the `flat/` prefix is required.
    {
      rules: {
        // override/add rules settings here, such as:
        // "astro/no-set-html-directive": "error"
      }
    }
];