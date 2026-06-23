const babelTransform = {
  "^.+\\.(ts|tsx)$": [
    "babel-jest",
    {
      babelrc: false,
      configFile: false,
      presets: [
        ["@babel/preset-env", { targets: { node: "current" } }],
        "@babel/preset-typescript",
        ["@babel/preset-react", { runtime: "automatic" }],
      ],
    },
  ],
};

module.exports = {
  watchman: false,
  projects: [
    {
      // Pure logic — fast, runs in plain Node.
      displayName: "logic",
      testEnvironment: "node",
      testMatch: ["<rootDir>/src/**/*.test.ts"],
      transform: babelTransform,
    },
    {
      // Component render tests via react-test-renderer + the React Native preset.
      displayName: "components",
      preset: "@react-native/jest-preset",
      testMatch: ["<rootDir>/src/**/*.test.tsx"],
      setupFiles: ["<rootDir>/jest.setup.components.js"],
      transform: {
        "^.+\\.(js|jsx|ts|tsx)$": [
          "babel-jest",
          { babelrc: false, configFile: false, presets: ["module:@react-native/babel-preset"] },
        ],
      },
      // pnpm nests packages under .pnpm/<name>@<ver>/, so match the store dir
      // names (where @scope/pkg becomes @scope+pkg) to transform RN's ESM source.
      transformIgnorePatterns: [
        "node_modules/.pnpm/(?!(react-native|@react-native\\+|@legendapp\\+))",
      ],
    },
  ],
};
