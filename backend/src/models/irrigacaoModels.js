const { DataTypes: T } = require("sequelize");

module.exports = (db) => {
  const uuid = (allowNull = false) => ({ type: T.UUID, allowNull });
  const id = () => ({ ...uuid(), primaryKey: true, defaultValue: T.UUIDV4 });
  const required = (type) => ({ type, allowNull: false });
  const options = (tableName) => ({ tableName, underscored: true });
  return {
    PerfilIrrigacao: db.define("PerfilIrrigacao", {
      id: id(), usuarioId: uuid(true), tipo: required(T.STRING(20)), nome: required(T.STRING(120)),
      especieId: uuid(), fase: required(T.STRING(20)),
      umidadeMinima: required(T.DOUBLE), umidadeAlvo: required(T.DOUBLE),
      duracaoMaximaSegundos: required(T.INTEGER), intervaloMinimoSegundos: required(T.INTEGER),
      fonte: required(T.TEXT), observacao: T.TEXT,
      statusValidacao: { ...required(T.STRING(20)), defaultValue: "RASCUNHO" },
      versao: { ...required(T.INTEGER), defaultValue: 1 }, validadoEm: T.DATE, arquivadoEm: T.DATE,
    }, options("perfis_irrigacao")),
    PlantaPerfilIrrigacao: db.define("PlantaPerfilIrrigacao", {
      plantaId: { ...uuid(), primaryKey: true }, perfilIrrigacaoId: uuid(),
      versao: required(T.INTEGER), snapshot: required(T.JSONB),
    }, options("plantas_perfis_irrigacao")),
    RegistroIrrigacao: db.define("RegistroIrrigacao", {
      id: id(), dispositivoId: uuid(), zonaId: uuid(), plantaId: uuid(true), irrigacaoId: uuid(),
      simulado: required(T.BOOLEAN), iniciadaEm: T.DATE, finalizadaEm: T.DATE,
      inicioRecebidoEm: T.DATE, fimRecebidoEm: T.DATE, duracaoSegundos: T.DOUBLE,
      resultado: required(T.STRING(20)), motivoFalha: T.TEXT,
      configuracaoId: uuid(true), configuracaoSnapshot: T.JSONB,
    }, options("registros_irrigacao")),
  };
};
