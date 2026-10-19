const AppError = require("../utils/AppError");
const { pageOptions, paginated } = require("../utils/pagination");

class IdentificacaoService {
  constructor(dependencies) {
    Object.assign(this, dependencies);
  }

  async list(id, usuarioId, query) {
    await this.plantaService.owned(id, usuarioId);
    return paginated(
      await this.models.IdentificacaoPlanta.findAndCountAll({
        where: { plantaId: id },
        ...pageOptions(query),
        order: [
          ["createdAt", "DESC"],
          ["id", "DESC"],
        ],
      }),
      query,
    );
  }

  async identify(id, usuarioId, input) {
    this.plantNetService.assertConfigured();
    const prepared = await this.database.transaction(async (transaction) => {
      const planta = await this.plantaService.owned(id, usuarioId, {
        transaction,
        lock: true,
        active: true,
      });
      const foto = await this.fotoService.ownedPhoto(
        id,
        input.fotoId,
        transaction,
      );
      const pending = await this.models.IdentificacaoPlanta.findOne({
        where: { plantaId: id, status: "PENDENTE" },
        transaction,
      });
      if (pending) {
        // Uma queda do processo não deve bloquear a planta indefinidamente.
        if (
          Date.now() - pending.createdAt.getTime() <
          this.env.PLANTNET_TIMEOUT_MS + 60000
        ) {
          throw new AppError(
            409,
            "IDENTIFICATION_IN_PROGRESS",
            "Já existe uma identificação em andamento para esta planta.",
          );
        }
        await pending.update(
          {
            status: "ERRO",
            codigoErro: "INTERRUPTED",
            finalizadaEm: new Date(),
          },
          { transaction },
        );
      }
      const identificacao = await this.models.IdentificacaoPlanta.create(
        {
          plantaId: id,
          fotoId: foto.id,
          status: "PENDENTE",
        },
        { transaction },
      );
      if (!planta.especieId)
        await planta.update(
          { statusIdentificacao: "IDENTIFICACAO_PENDENTE" },
          { transaction },
        );
      return {
        identificacaoId: identificacao.id,
        chaveArquivo: foto.chaveArquivo,
      };
    });

    try {
      const buffer = await this.storage.read(prepared.chaveArquivo);
      const candidatos = await this.plantNetService.identify(
        buffer,
        input.orgao,
      );
      return await this.database.transaction(async (transaction) => {
        const planta = await this.plantaService.owned(id, usuarioId, {
          transaction,
          lock: true,
          active: true,
        });
        const identificacao = await this.models.IdentificacaoPlanta.findByPk(
          prepared.identificacaoId,
          { transaction },
        );
        if (identificacao.status !== "PENDENTE")
          throw new AppError(
            409,
            "IDENTIFICATION_INTERRUPTED",
            "A identificação foi interrompida.",
          );
        await identificacao.update(
          { status: "CONCLUIDA", candidatos, finalizadaEm: new Date() },
          { transaction },
        );
        if (!planta.especieId)
          await planta.update(
            {
              statusIdentificacao: candidatos.length
                ? "IDENTIFICACAO_PENDENTE"
                : "NAO_IDENTIFICADA",
            },
            { transaction },
          );
        return identificacao;
      });
    } catch (error) {
      await this.database.transaction(async (transaction) => {
        const planta = await this.plantaService.owned(id, usuarioId, {
          transaction,
          lock: true,
        });
        const identificacao = await this.models.IdentificacaoPlanta.findByPk(
          prepared.identificacaoId,
          { transaction },
        );
        if (identificacao.status !== "PENDENTE") return;
        await identificacao.update(
          {
            status: "ERRO",
            codigoErro:
              error instanceof AppError ? error.code : "INTERNAL_ERROR",
            finalizadaEm: new Date(),
          },
          { transaction },
        );
        if (!planta.especieId)
          await planta.update(
            { statusIdentificacao: "NAO_IDENTIFICADA" },
            { transaction },
          );
      });
      throw error;
    }
  }

  async confirm(id, identificacaoId, usuarioId, candidatoIndice) {
    return this.database.transaction(async (transaction) => {
      const planta = await this.plantaService.owned(id, usuarioId, {
        transaction,
        lock: true,
        active: true,
      });
      const identificacao = await this.models.IdentificacaoPlanta.findOne({
        where: { id: identificacaoId, plantaId: id },
        transaction,
      });
      if (!identificacao)
        throw new AppError(
          404,
          "IDENTIFICATION_NOT_FOUND",
          "Identificação não encontrada nesta planta.",
        );
      if (identificacao.status !== "CONCLUIDA")
        throw new AppError(
          409,
          "IDENTIFICATION_NOT_CONFIRMABLE",
          "Esta identificação não pode ser confirmada.",
        );
      const candidate = identificacao.candidatos[candidatoIndice];
      if (!candidate)
        throw new AppError(
          422,
          "INVALID_CANDIDATE",
          "Selecione um candidato retornado nesta identificação.",
        );
      const species = await this.catalogoService.resolveCandidate(
        candidate,
        transaction,
      );
      await planta.update(
        {
          especieId: species.id,
          origemIdentificacao: "API",
          statusIdentificacao: "IDENTIFICADA",
          confiancaIdentificacao: candidate.confianca,
        },
        { transaction },
      );
      await identificacao.update(
        {
          status: "CONFIRMADA",
          especieConfirmadaId: species.id,
          confirmadaEm: new Date(),
        },
        { transaction },
      );
      return {
        identificacao,
        planta: await this.plantaService.serialize(planta, transaction),
      };
    });
  }
}

module.exports = IdentificacaoService;
