class IdentificacaoController {
  constructor(service) {
    this.service = service;
  }
  listar = async (req, res) =>
    res.json(
      await this.service.list(
        req.validatedParams.id,
        req.usuario.id,
        req.validatedQuery,
      ),
    );
  identificar = async (req, res) =>
    res.status(201).json({
      data: {
        identificacao: await this.service.identify(
          req.validatedParams.id,
          req.usuario.id,
          req.validatedBody,
        ),
      },
    });
  confirmar = async (req, res) =>
    res.json({
      data: await this.service.confirm(
        req.validatedParams.id,
        req.validatedParams.identificacaoId,
        req.usuario.id,
        req.validatedBody.candidatoIndice,
      ),
    });
}

module.exports = IdentificacaoController;