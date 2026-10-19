// Inicializa um cluster exclusivo em uma pasta temporária. Não conecta ao serviço
// PostgreSQL já instalado nem utiliza o DATABASE_URL de desenvolvimento.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const exe = (name) => `${name}${process.platform === "win32" ? ".exe" : ""}`;

function findBinaries() {
  if (process.env.PG_BIN_DIR) return process.env.PG_BIN_DIR;
  if (process.platform === "win32") {
    const base = path.join(
      process.env.ProgramFiles || "C:\\Program Files",
      "PostgreSQL",
    );
    if (fs.existsSync(base)) {
      for (const version of fs
        .readdirSync(base)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))) {
        const bin = path.join(base, version, "bin");
        if (fs.existsSync(path.join(bin, exe("initdb")))) return bin;
      }
    }
  }
  const config = spawnSync("pg_config", ["--bindir"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (config.status === 0) return config.stdout.trim();
  throw new Error("Binários PostgreSQL não encontrados. Configure PG_BIN_DIR.");
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function main() {
  const bin = findBinaries();
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "horta-postgres-test-"),
  );
  const dataDir = path.join(tempRoot, "data");
  const passwordFile = path.join(tempRoot, "password");
  const password = randomBytes(24).toString("hex");
  const port = await availablePort();
  const childEnv = {
    ...process.env,
    NODE_ENV: "test",
    DATABASE_SSL: "false",
    PGPASSWORD: password,
    DATABASE_URL: `postgresql://horta_test_admin:${password}@127.0.0.1:${port}/horta_inteligente_test`,
    HORTA_EPHEMERAL_POSTGRES: "true",
    UPLOAD_DIR: path.join(tempRoot, "uploads"),
  };
  let started = false;
  let commandNumber = 0;

  function run(command, args, { visible = false } = {}) {
    // pg_ctl pode transmitir pipes para postgres no Windows. Arquivos evitam
    // esperar EOF de um processo de servidor que continuará executando.
    const outputFile = path.join(tempRoot, `command-${++commandNumber}.log`);
    const fd = visible ? null : fs.openSync(outputFile, "w");
    let result;
    try {
      result = spawnSync(command, args, {
        cwd: root,
        env: childEnv,
        encoding: "utf8",
        windowsHide: true,
        stdio: visible ? "inherit" : ["ignore", fd, fd],
        timeout: 60000,
      });
    } finally {
      if (fd !== null) fs.closeSync(fd);
    }
    if (result.error || result.status !== 0) {
      const output = visible
        ? ""
        : fs
            .readFileSync(outputFile, "utf8")
            .replaceAll(password, "[REDACTED]");
      throw new Error(
        `Falha em ${path.basename(command)}: ${output.trim() || result.error?.message || result.status}`,
      );
    }
  }

  const cli = path.join(
    root,
    "node_modules",
    "sequelize-cli",
    "lib",
    "sequelize",
  );
  try {
    fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
    console.info(
      "Inicializando PostgreSQL temporário com autenticação e acesso apenas local...",
    );
    run(path.join(bin, exe("initdb")), [
      "-D",
      dataDir,
      "-U",
      "horta_test_admin",
      "--auth=scram-sha-256",
      "--encoding=UTF8",
      "--locale=C",
      `--pwfile=${passwordFile}`,
    ]);
    // Marcar antes do start permite limpar também uma inicialização parcial.
    started = true;
    run(path.join(bin, exe("pg_ctl")), [
      "start",
      "-D",
      dataDir,
      "-l",
      path.join(tempRoot, "server.log"),
      "-w",
      "-t",
      "30",
      "-o",
      `-h 127.0.0.1 -p ${port} -F`,
    ]);
    run(path.join(bin, exe("createdb")), [
      "-h",
      "127.0.0.1",
      "-p",
      String(port),
      "-U",
      "horta_test_admin",
      "-w",
      "horta_inteligente_test",
    ]);
    run(process.execPath, [cli, "db:migrate"], { visible: true });
    run(process.execPath, ["--test", "tests/integration/*.test.js"], {
      visible: true,
    });
    console.info(
      "Verificando rollback completo e reaplicação das migrations no banco temporário...",
    );
    run(process.execPath, [cli, "db:migrate:undo:all"], { visible: true });
    run(process.execPath, [cli, "db:migrate"], { visible: true });
  } finally {
    let stopped = !started;
    if (started) {
      const stop = spawnSync(
        path.join(bin, exe("pg_ctl")),
        ["stop", "-D", dataDir, "-m", "fast", "-w", "-t", "30"],
        { encoding: "utf8", windowsHide: true, timeout: 35000 },
      );
      stopped =
        stop.status === 0 ||
        !fs.existsSync(path.join(dataDir, "postmaster.pid"));
      if (!stopped) {
        console.error(
          `Não foi possível encerrar o cluster temporário: ${dataDir}`,
        );
        process.exitCode = 1;
      }
    }
    const resolved = path.resolve(tempRoot);
    const expectedParent = path.resolve(os.tmpdir());
    if (
      stopped &&
      path.dirname(resolved) === expectedParent &&
      path.basename(resolved).startsWith("horta-postgres-test-")
    ) {
      fs.rmSync(resolved, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
