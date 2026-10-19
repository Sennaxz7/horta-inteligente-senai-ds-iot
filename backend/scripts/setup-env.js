const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const root = path.resolve(__dirname, "..");
const content = fs
  .readFileSync(path.join(root, ".env.example"), "utf8")
  .replace(/^JWT_SECRET=$/m, `JWT_SECRET=${randomBytes(64).toString("hex")}`);
try {
  fs.writeFileSync(path.join(root, ".env"), content, {
    flag: "wx",
    mode: 0o600,
  });
  console.info(
    ".env criado com chave JWT aleatória. Configure DATABASE_URL antes de iniciar.",
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.info(".env já existe; nenhum valor foi alterado.");
}
