module.exports = {
  projects: [
    {
      displayName: "rapidos",
      rootDir: __dirname,
      testEnvironment: "node",
      testMatch: [
        "<rootDir>/tests/unit/**/*.test.js",
        "<rootDir>/tests/http/**/*.test.js",
      ],
    },
    {
      displayName: "integracao",
      rootDir: __dirname,
      testEnvironment: "node",
      testMatch: ["<rootDir>/tests/integration/**/*.test.js"],
    },
  ],
};
