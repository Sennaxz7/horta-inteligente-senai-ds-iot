const { Op } = require("sequelize");
const AppError = require("../utils/AppError");
const { pageOptions, paginated } = require("../utils/pagination");

class CrescimentoService {
  constructor({ models, database, plantaService }) {
    Object.assign(this, { models, database, plantaService });
  }

  async list(id, usuarioId, query) {
    await this.plantaService.owned(id, usuarioId);
    const where = { plantaId: id };
    if (query.de || query.ate)
      where.registradoEm = {
        ...(query.de ? { [Op.gte]: new Date(query.de) } : {}),
        ...(query.ate ? { [Op.lte]: new Date(query.ate) } : {}),
      };
    return paginated(
      await this.models.HistoricoCrescimento.findAndCountAll({
        where,
        ...pageOptions(query),
        order: this.order(),
      }),
      query,
    );
  }

  order() {
    return [
      ["registradoEm", "DESC"],
      ["createdAt", "DESC"],
      ["id", "DESC"],
    ];
  }

  async create(id, usuarioId, input) {
    return this.database.transaction(async (transaction) => {
      const planta = await this.plantaService.owned(id, usuarioId, {
        transaction,
        lock: true,
        active: true,
      });
      if (input.fotoId) {
        const foto = await this.models.FotoPlanta.findOne({
          where: { id: input.fotoId, plantaId: id },
          transaction,
        });
        if (!foto)
          throw new AppError(
            404,
            "PHOTO_NOT_FOUND",
            "Foto não encontrada nesta planta.",
          );
      }
      const registro = await this.models.HistoricoCrescimento.create(
        {
          ...input,
          plantaId: id,
          registradoEm: input.registradoEm || new Date(),
        },
        { transaction },
      );
      const latest = await this.models.HistoricoCrescimento.findOne({
        where: { plantaId: id },
        order: this.order(),
        transaction,
      });
      await planta.update({ faseAtual: latest.fase }, { transaction });
      return { registro, faseAtual: latest.fase };
    });
  }
}

module.exports = CrescimentoService;
