const { CatalogoService } = require("./CatalogoService");
const PlantaService = require("./PlantaService");
const CrescimentoService = require("./CrescimentoService");
const FileStorageService = require("./FileStorageService");
const FotoService = require("./FotoService");
const PlantNetService = require("./PlantNetService");
const IdentificacaoService = require("./IdentificacaoService");

function createServices({ models, database, env, fetchImpl }) {
  const catalogoService = new CatalogoService({ models });
  const plantaService = new PlantaService({
    models,
    database,
    catalogoService,
  });
  const crescimentoService = new CrescimentoService({
    models,
    database,
    plantaService,
  });
  const storage = new FileStorageService({ env });
  const fotoService = new FotoService({
    models,
    database,
    plantaService,
    storage,
  });
  const plantNetService = new PlantNetService({ env, fetchImpl });
  const identificacaoService = new IdentificacaoService({
    models,
    database,
    env,
    storage,
    plantaService,
    fotoService,
    plantNetService,
    catalogoService,
  });
  return {
    catalogoService,
    plantaService,
    crescimentoService,
    fotoService,
    identificacaoService,
  };
}

module.exports = { createServices };
