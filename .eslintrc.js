"use strict";

module.exports = {
  extends: [
    // standard configuration
    "standard",

    // https://github.com/mysticatea/eslint-plugin-n#-rules
    "plugin:n/recommended",

    // disable rules handled by prettier
    "prettier",
  ],

  parserOptions: {
    ecmaVersion: 11,

    sourceType: "script", // or "script" if not using ES modules
  },

  reportUnusedDisableDirectives: true,

  rules: {
    // uncomment if you are using a builder like Babel
    // "n/no-unsupported-features/es-syntax": "off",

    strict: "error",
  },
};
