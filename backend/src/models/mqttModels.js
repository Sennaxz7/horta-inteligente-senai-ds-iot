const { DataTypes: T } = require("sequelize");

module.exports = (db) => {
  const uuid = () => ({ type: T.UUID, allowNull: false });
  const id = () => ({ ...uuid(), primaryKey: true, defaultValue: T.UUIDV4 });
  const define = (name, tableName, fields) =>
    db.define(name, { id: id(), ...fields }, { tableName, underscored: true });
  return {
    Dispositivo: define("Dispositivo", "mqtt_dispositivos", {
      usuarioId: uuid(),
      nome: { type: T.STRING(120), allowNull: false },
      simulado: { type: T.BOOLEAN, allowNull: false, defaultValue: true },
      arquivadoEm: T.DATE,
      ultimaMensagemEm: T.DATE,
      ultimoStatus: T.JSONB,
    }),
    ZonaIrrigacao: define("ZonaIrrigacao", "mqtt_zonas", {
      dispositivoId: uuid(),
      nome: { type: T.STRING(120), allowNull: false },
      plantaId: T.UUID,
      calibracao: T.JSONB,
    }),
    MensagemMqtt: define("MensagemMqtt", "mqtt_mensagens", {
      dispositivoId: uuid(),
      mensagemId: uuid(),
      zonaId: T.UUID,
      plantaId: T.UUID,
      tipo: { type: T.STRING(20), allowNull: false },
      dados: { type: T.JSONB, allowNull: false },
      medidoEm: { type: T.DATE, allowNull: false },
      recebidoEm: { type: T.DATE, allowNull: false },
    }),
    ConfiguracaoMqtt: define("ConfiguracaoMqtt", "mqtt_configuracoes", {
      dispositivoId: uuid(),
      zonaId: uuid(),
      dados: { type: T.JSONB, allowNull: false },
      status: {
        type: T.STRING(20),
        allowNull: false,
        defaultValue: "PENDENTE",
      },
      confirmadaEm: T.DATE,
    }),
  };
};
