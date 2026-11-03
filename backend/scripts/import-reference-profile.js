// Operação administrativa local: não há permissão de publicação global pela API.
const fs = require("node:fs/promises");
const { loadEnvironment } = require("../src/config/env");
const { createDatabase } = require("../src/config/database");
const { initializeModels } = require("../src/models");
const { create } = require("../src/validators/irrigacaoValidators");

async function importReference(database, models, input) {
  const parsed = create.safeParse(input);
  if (!parsed.success) throw new Error("Perfil inválido. Verifique os campos documentados em docs/irrigacao.md.");
  return database.transaction(async transaction => {
    if (!await models.Especie.findByPk(parsed.data.especieId, { transaction }) ||
        !await models.FaseCrescimento.findByPk(parsed.data.fase, { transaction })) {
      throw new Error("Espécie ou fase não cadastrada.");
    }
    return models.PerfilIrrigacao.create({
      ...parsed.data, tipo: "REFERENCIA", usuarioId: null,
      statusValidacao: "VALIDADO", validadoEm: new Date(),
    }, { transaction });
  });
}

async function main() {
  if (process.argv.includes("--help")) {
    console.info("Uso: npm run perfis:importar -- caminho/perfil.json --validado\nUse somente após revisar a fonte, calibração e parâmetros. Cada execução cria uma referência nova.");
    return;
  }
  const [file, confirmation] = process.argv.slice(2);
  if (!file || confirmation !== "--validado" || process.argv.length !== 4) {
    throw new Error("Informe o arquivo JSON e --validado após revisar os parâmetros e a fonte.");
  }
  let input;
  try { input = JSON.parse(await fs.readFile(file, "utf8")); }
  catch { throw new Error("Não foi possível ler o arquivo JSON do perfil."); }
  const database = createDatabase(loadEnvironment());
  try {
    const profile = await importReference(database, initializeModels(database), input);
    console.info(`Perfil de referência cadastrado: ${profile.id}`);
  } finally { await database.close(); }
}

if (require.main === module) main().catch(() => {
  console.error("Não foi possível importar. Confira o JSON, --validado, a conexão e as migrations. Consulte --help.");
  process.exitCode = 1;
});
module.exports = { importReference };
