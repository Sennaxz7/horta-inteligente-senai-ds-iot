const AppError = require("../utils/AppError");
const { pageOptions, paginated } = require("../utils/pagination");

function publicPhoto(photo) {
  const { chaveArquivo, ...result } = photo.toJSON();
  result.arquivoUrl = `/api/v1/plantas/${result.plantaId}/fotos/${result.id}/arquivo`;
  return result;
}

class FotoService {
  constructor({ models, database, plantaService, storage }) {
    Object.assign(this, { models, database, plantaService, storage });
  }

  async ownedPhoto(plantaId, fotoId, transaction) {
    const foto = await this.models.FotoPlanta.findOne({
      where: { id: fotoId, plantaId },
      transaction,
    });
    if (!foto)
      throw new AppError(
        404,
        "PHOTO_NOT_FOUND",
        "Foto não encontrada nesta planta.",
      );
    return foto;
  }

  async create(id, usuarioId, input, file) {
    await this.plantaService.owned(id, usuarioId, { active: true });
    const stored = await this.storage.save(file);
    try {
      return await this.database.transaction(async (transaction) => {
        await this.plantaService.owned(id, usuarioId, {
          transaction,
          lock: true,
          active: true,
        });
        return publicPhoto(
          await this.models.FotoPlanta.create(
            {
              ...stored,
              ...input,
              plantaId: id,
              capturadaEm: input.capturadaEm || new Date(),
            },
            { transaction },
          ),
        );
      });
    } catch (error) {
      await this.storage.remove(stored.chaveArquivo);
      throw error;
    }
  }

  async list(id, usuarioId, query) {
    await this.plantaService.owned(id, usuarioId);
    const result = await this.models.FotoPlanta.findAndCountAll({
      where: { plantaId: id },
      ...pageOptions(query),
      order: [
        ["capturadaEm", "DESC"],
        ["id", "DESC"],
      ],
    });
    result.rows = result.rows.map(publicPhoto);
    return paginated(result, query);
  }

  async download(id, fotoId, usuarioId) {
    await this.plantaService.owned(id, usuarioId);
    const foto = await this.ownedPhoto(id, fotoId);
    return {
      buffer: await this.storage.read(foto.chaveArquivo),
      mimeType: foto.mimeType,
    };
  }
}

module.exports = FotoService;
