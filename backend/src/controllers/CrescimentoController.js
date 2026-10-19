class CrescimentoController {
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
  criar = async (req, res) =>
    res
      .status(201)
      .json({
        data: await this.service.create(
          req.validatedParams.id,
          req.usuario.id,
          req.validatedBody,
        ),
      });
}

module.exports = CrescimentoController;
