const { Op } = require("sequelize");
const AppError = require("../utils/AppError");
const {
  pageOptions,
  paginated,
  literalSearch,
} = require("../utils/pagination");
const { publicSpecies } = require("./CatalogoService");

class PlantaService {
  constructor({ models, database, catalogoService }) {
    Object.assign(this, { models, database, catalogoService });
  }

  async owned(
    id,
    usuarioId,
    { transaction, lock = false, active = false } = {},
  ) {
    const planta = await this.models.Planta.findByPk(id, {
      transaction,
      ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!planta)
      throw new AppError(404, "PLANT_NOT_FOUND", "Planta não encontrada.");
    if (planta.usuarioId !== usuarioId)
      throw new AppError(
        403,
        "FORBIDDEN",
        "Esta planta pertence a outro usuário.",
      );
    if (active && planta.arquivadaEm)
      throw new AppError(409, "PLANT_ARCHIVED", "A planta está arquivada.");
    return planta;
  }

  async serialize(planta, transaction) {
    const result = planta.toJSON();
    result.especie = planta.especieId
      ? publicSpecies(
          await this.catalogoService.getSpecies(planta.especieId, transaction),
        )
      : null;
    return result;
  }

  async create(usuarioId, input) {
    return this.database.transaction(async (transaction) => {
      if (input.especieId)
        await this.catalogoService.getSpecies(input.especieId, transaction);
      const planta = await this.models.Planta.create(
        {
          ...input,
          usuarioId,
          statusIdentificacao: input.especieId
            ? "IDENTIFICADA"
            : "NAO_IDENTIFICADA",
          origemIdentificacao: input.especieId ? "MANUAL" : null,
        },
        { transaction },
      );
      await this.models.HistoricoCrescimento.create(
        {
          plantaId: planta.id,
          fase: planta.faseAtual,
          registradoEm: planta.createdAt,
          observacao: "Cadastro inicial da planta.",
        },
        { transaction },
      );
      return this.serialize(planta, transaction);
    });
  }

  async list(usuarioId, query) {
    const where = {
      usuarioId,
      arquivadaEm: query.arquivadas ? { [Op.ne]: null } : null,
    };
    if (query.fase) where.faseAtual = query.fase;
    if (query.especieId) where.especieId = query.especieId;
    if (query.statusIdentificacao)
      where.statusIdentificacao = query.statusIdentificacao;
    if (query.busca)
      where[Op.or] = ["nome", "apelido"].map((field) => ({
        [field]: { [Op.iLike]: literalSearch(query.busca) },
      }));
    const result = await this.models.Planta.findAndCountAll({
      where,
      ...pageOptions(query),
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"],
      ],
      include: [
        {
          model: this.models.Especie,
          as: "especie",
          attributes: { exclude: ["nomeCientificoNormalizado"] },
        },
      ],
    });
    return paginated(result, query);
  }

  async get(id, usuarioId) {
    return this.serialize(await this.owned(id, usuarioId));
  }

  async update(id, usuarioId, input) {
    return this.database.transaction(async (transaction) => {
      const planta = await this.owned(id, usuarioId, {
        transaction,
        lock: true,
        active: true,
      });
      await planta.update(input, { transaction });
      return this.serialize(planta, transaction);
    });
  }

  async archive(id, usuarioId) {
    await this.database.transaction(async (transaction) => {
      const planta = await this.owned(id, usuarioId, {
        transaction,
        lock: true,
      });
      if (!planta.arquivadaEm)
        await planta.update({ arquivadaEm: new Date() }, { transaction });
    });
  }

  async setSpecies(id, usuarioId, especieId) {
    return this.database.transaction(async (transaction) => {
      const planta = await this.owned(id, usuarioId, {
        transaction,
        lock: true,
        active: true,
      });
      if (especieId)
        await this.catalogoService.getSpecies(especieId, transaction);
      await planta.update(
        {
          especieId,
          origemIdentificacao: especieId ? "MANUAL" : null,
          statusIdentificacao: especieId ? "IDENTIFICADA" : "NAO_IDENTIFICADA",
          confiancaIdentificacao: null,
        },
        { transaction },
      );
      return this.serialize(planta, transaction);
    });
  }
}

module.exports = PlantaService;
