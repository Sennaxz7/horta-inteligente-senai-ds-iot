const defineUsuario = require("./Usuario");

function initializeModels(sequelize) {
  const Usuario = defineUsuario(sequelize);
  const Especie = require("./Especie")(sequelize);
  const FaseCrescimento = require("./FaseCrescimento")(sequelize);
  const Planta = require("./Planta")(sequelize);
  const HistoricoCrescimento = require("./HistoricoCrescimento")(sequelize);
  const FotoPlanta = require("./FotoPlanta")(sequelize);
  const IdentificacaoPlanta = require("./IdentificacaoPlanta")(sequelize);

  Usuario.hasMany(Planta, { foreignKey: "usuarioId", as: "plantas" });
  Planta.belongsTo(Usuario, { foreignKey: "usuarioId", as: "usuario" });
  Especie.hasMany(Planta, { foreignKey: "especieId", as: "plantas" });
  Planta.belongsTo(Especie, { foreignKey: "especieId", as: "especie" });
  FaseCrescimento.hasMany(Planta, { foreignKey: "faseAtual", as: "plantas" });
  Planta.belongsTo(FaseCrescimento, { foreignKey: "faseAtual", as: "fase" });
  for (const [Model, as] of [
    [HistoricoCrescimento, "crescimento"],
    [FotoPlanta, "fotos"],
    [IdentificacaoPlanta, "identificacoes"],
  ]) {
    Planta.hasMany(Model, { foreignKey: "plantaId", as });
    Model.belongsTo(Planta, { foreignKey: "plantaId", as: "planta" });
  }
  FaseCrescimento.hasMany(HistoricoCrescimento, {
    foreignKey: "fase",
    as: "historicos",
  });
  HistoricoCrescimento.belongsTo(FaseCrescimento, {
    foreignKey: "fase",
    as: "faseCrescimento",
  });
  FotoPlanta.hasMany(HistoricoCrescimento, {
    foreignKey: "fotoId",
    as: "registrosCrescimento",
  });
  HistoricoCrescimento.belongsTo(FotoPlanta, {
    foreignKey: "fotoId",
    as: "foto",
  });
  FotoPlanta.hasMany(IdentificacaoPlanta, {
    foreignKey: "fotoId",
    as: "identificacoes",
  });
  IdentificacaoPlanta.belongsTo(FotoPlanta, {
    foreignKey: "fotoId",
    as: "foto",
  });
  Especie.hasMany(IdentificacaoPlanta, {
    foreignKey: "especieConfirmadaId",
    as: "identificacoes",
  });
  IdentificacaoPlanta.belongsTo(Especie, {
    foreignKey: "especieConfirmadaId",
    as: "especieConfirmada",
  });
  return {
    Usuario,
    Especie,
    FaseCrescimento,
    Planta,
    HistoricoCrescimento,
    FotoPlanta,
    IdentificacaoPlanta,
  };
}

module.exports = { initializeModels };
