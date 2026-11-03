const { Op } = require("sequelize");
const AppError = require("../utils/AppError");
const { pageOptions, paginated } = require("../utils/pagination");
const { create: createSchema } = require("../validators/irrigacaoValidators");

class PerfilIrrigacaoService {
  constructor({ models, database, plantaService, catalogoService }) {
    Object.assign(this, { models, database, plantaService, catalogoService });
  }

  visibility(usuarioId) {
    return { [Op.or]: [
      { tipo: "PESSOAL", usuarioId },
      { tipo: "REFERENCIA", statusValidacao: "VALIDADO" },
    ] };
  }

  async get(id, usuarioId, transaction, lock = false) {
    const profile = await this.models.PerfilIrrigacao.findOne({
      where: { id, ...this.visibility(usuarioId) }, transaction,
      ...(lock ? { lock: transaction.LOCK.UPDATE } : {}),
    });
    if (!profile) throw new AppError(404, "PROFILE_NOT_FOUND", "Perfil não encontrado.");
    return profile;
  }

  async list(usuarioId, query) {
    const where = { ...this.visibility(usuarioId), arquivadoEm: query.arquivados ? { [Op.ne]: null } : null };
    for (const field of ["especieId", "fase", "tipo", "statusValidacao"]) {
      if (query[field]) where[field] = query[field];
    }
    if (query.plantaId) {
      const plant = await this.plantaService.owned(query.plantaId, usuarioId);
      if (!plant.especieId) throw new AppError(409, "PLANT_SPECIES_REQUIRED", "Confirme a espécie da planta antes de buscar perfis compatíveis.");
      if ((query.especieId && query.especieId !== plant.especieId) || (query.fase && query.fase !== plant.faseAtual)) {
        throw new AppError(422, "INCOMPATIBLE_FILTERS", "Os filtros devem corresponder à espécie e fase da planta.");
      }
      where.especieId = plant.especieId;
      where.fase = plant.faseAtual;
    }
    return paginated(await this.models.PerfilIrrigacao.findAndCountAll({
      where, ...pageOptions(query), order: [["nome", "ASC"], ["id", "ASC"]],
    }), query);
  }

  async validateCatalog(input, transaction) {
    await this.catalogoService.getSpecies(input.especieId, transaction);
    if (!await this.models.FaseCrescimento.findByPk(input.fase, { transaction })) {
      throw new AppError(404, "PHASE_NOT_FOUND", "Fase não encontrada.");
    }
  }

  async create(usuarioId, input) {
    return this.database.transaction(async transaction => {
      await this.validateCatalog(input, transaction);
      return this.models.PerfilIrrigacao.create({ ...input, usuarioId, tipo: "PESSOAL" }, { transaction });
    });
  }

  editable(profile, usuarioId) {
    if (profile.tipo !== "PESSOAL" || profile.usuarioId !== usuarioId) {
      throw new AppError(403, "REFERENCE_PROFILE_READ_ONLY", "Copie o perfil de referência para personalizá-lo.");
    }
    if (profile.arquivadoEm) throw new AppError(409, "PROFILE_ARCHIVED", "O perfil está arquivado.");
  }

  async update(id, usuarioId, input) {
    return this.database.transaction(async transaction => {
      const profile = await this.get(id, usuarioId, transaction, true);
      this.editable(profile, usuarioId);
      const { statusValidacao, ...fields } = input;
      const parsed = createSchema.safeParse({
        ...Object.fromEntries(["nome", "especieId", "fase", "umidadeMinima", "umidadeAlvo", "duracaoMaximaSegundos", "intervaloMinimoSegundos", "fonte", "observacao"].map(k => [k, profile[k]])),
        ...fields,
      });
      if (!parsed.success) throw new AppError(422, "VALIDATION_ERROR", "Verifique os parâmetros do perfil.", parsed.error.issues.map(i => ({ campo: i.path.join("."), mensagem: i.message })));
      const changed = Object.keys(fields).some(k => fields[k] !== profile[k]);
      if (changed && statusValidacao === "VALIDADO") {
        throw new AppError(409, "PROFILE_REVALIDATION_REQUIRED", "Salve as alterações antes de validar a nova versão.");
      }
      await this.validateCatalog(parsed.data, transaction);
      const changes = { ...fields };
      if (changed) Object.assign(changes, { versao: profile.versao + 1, statusValidacao: "RASCUNHO", validadoEm: null });
      else if (statusValidacao) Object.assign(changes, {
        statusValidacao, validadoEm: statusValidacao === "VALIDADO" ? profile.validadoEm || new Date() : null,
      });
      return profile.update(changes, { transaction });
    });
  }

  async archive(id, usuarioId) {
    return this.database.transaction(async transaction => {
      const profile = await this.get(id, usuarioId, transaction, true);
      if (profile.arquivadoEm && profile.usuarioId === usuarioId) return;
      this.editable(profile, usuarioId);
      await profile.update({ arquivadoEm: new Date() }, { transaction });
    });
  }

  async copy(id, usuarioId) {
    return this.database.transaction(async transaction => {
      const source = await this.get(id, usuarioId, transaction, true);
      if (source.arquivadoEm) throw new AppError(409, "PROFILE_ARCHIVED", "O perfil está arquivado.");
      const fields = Object.fromEntries(["nome", "especieId", "fase", "umidadeMinima", "umidadeAlvo", "duracaoMaximaSegundos", "intervaloMinimoSegundos", "fonte", "observacao"].map(k => [k, source[k]]));
      return this.models.PerfilIrrigacao.create({ ...fields, usuarioId, tipo: "PESSOAL", statusValidacao: "RASCUNHO", versao: 1 }, { transaction });
    });
  }

  async association(plantaId, usuarioId) {
    // Uma visão consistente da planta, vínculo e perfil evita informar revisão obsoleta.
    return this.database.transaction(async transaction => {
      const plant = await this.plantaService.owned(plantaId, usuarioId, { transaction, lock: true });
      const link = await this.models.PlantaPerfilIrrigacao.findByPk(plantaId, { transaction });
      if (!link) return { perfil: null, vinculo: null, necessitaRevisao: false, motivos: [] };
      const profile = await this.get(link.perfilIrrigacaoId, usuarioId, transaction, true);
      const motivos = [];
      if (profile.arquivadoEm) motivos.push("PERFIL_ARQUIVADO");
      if (profile.statusValidacao !== "VALIDADO") motivos.push("PERFIL_NAO_VALIDADO");
      if (profile.versao !== link.versao) motivos.push("VERSAO_ALTERADA");
      if (plant.especieId !== link.snapshot.especieId) motivos.push("ESPECIE_ALTERADA");
      if (plant.faseAtual !== link.snapshot.fase) motivos.push("FASE_ALTERADA");
      return { perfil: profile, vinculo: link, necessitaRevisao: motivos.length > 0, motivos };
    });
  }

  async bind(plantaId, usuarioId, perfilIrrigacaoId) {
    await this.database.transaction(async transaction => {
      const plant = await this.plantaService.owned(plantaId, usuarioId, { transaction, lock: true, active: true });
      if (!perfilIrrigacaoId) {
        await this.models.PlantaPerfilIrrigacao.destroy({ where: { plantaId }, transaction });
        return;
      }
      const profile = await this.get(perfilIrrigacaoId, usuarioId, transaction, true);
      if (profile.arquivadoEm || profile.statusValidacao !== "VALIDADO") {
        throw new AppError(409, "PROFILE_NOT_AVAILABLE", "Selecione um perfil ativo e validado.");
      }
      if (profile.especieId !== plant.especieId || profile.fase !== plant.faseAtual) {
        throw new AppError(409, "PROFILE_INCOMPATIBLE", "O perfil deve corresponder à espécie e fase da planta.");
      }
      await this.models.PlantaPerfilIrrigacao.upsert({ plantaId, perfilIrrigacaoId, versao: profile.versao, snapshot: profile.toJSON() }, { transaction });
    });
    return this.association(plantaId, usuarioId);
  }
}

module.exports = PerfilIrrigacaoService;
