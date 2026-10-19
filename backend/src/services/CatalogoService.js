const { Op, UniqueConstraintError } = require("sequelize");
const AppError = require("../utils/AppError");
const {
  pageOptions,
  paginated,
  literalSearch,
} = require("../utils/pagination");

function publicSpecies(species) {
  if (!species) return null;
  const data =
    typeof species.toJSON === "function" ? species.toJSON() : species;
  const { nomeCientificoNormalizado, ...result } = data;
  return result;
}

class CatalogoService {
  constructor({ models }) {
    this.models = models;
  }

  async listSpecies(query) {
    const where = query.busca
      ? {
          [Op.or]: [
            { nomeCientifico: { [Op.iLike]: literalSearch(query.busca) } },
            { nomeComum: { [Op.iLike]: literalSearch(query.busca) } },
          ],
        }
      : {};
    const result = await this.models.Especie.findAndCountAll({
      where,
      ...pageOptions(query),
      order: [
        ["nomeCientifico", "ASC"],
        ["id", "ASC"],
      ],
    });
    result.rows = result.rows.map(publicSpecies);
    return paginated(result, query);
  }

  async getSpecies(id, transaction) {
    const species = await this.models.Especie.findByPk(id, { transaction });
    if (!species)
      throw new AppError(404, "SPECIES_NOT_FOUND", "Espécie não encontrada.");
    return species;
  }

  async createSpecies(input) {
    try {
      return publicSpecies(
        await this.models.Especie.create({
          ...input,
          nomeCientificoNormalizado: input.nomeCientifico.toLowerCase(),
        }),
      );
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new AppError(
          409,
          "SPECIES_ALREADY_EXISTS",
          "Esta espécie já está no catálogo.",
        );
      }
      throw error;
    }
  }

  async resolveCandidate(candidate, transaction) {
    const nomeCientifico = candidate.nomeCientifico.trim().replace(/\s+/g, " ");
    const [species] = await this.models.Especie.findOrCreate({
      where: { nomeCientificoNormalizado: nomeCientifico.toLowerCase() },
      defaults: {
        nomeCientifico,
        nomeComum: candidate.nomeComum,
        plantNetId: candidate.plantNetId,
      },
      transaction,
    });
    return species;
  }

  listPhases() {
    return this.models.FaseCrescimento.findAll({ order: [["ordem", "ASC"]] });
  }
}

module.exports = { CatalogoService, publicSpecies };
