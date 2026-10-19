class PlantaController {
  constructor(service) {
    this.service = service;
  }
  listar = async (req, res) =>
    res.json(await this.service.list(req.usuario.id, req.validatedQuery));
  obter = async (req, res) =>
    res.json({
      data: {
        planta: await this.service.get(req.validatedParams.id, req.usuario.id),
      },
    });
  criar = async (req, res) =>
    res.status(201).json({
      data: {
        planta: await this.service.create(req.usuario.id, req.validatedBody),
      },
    });
  atualizar = async (req, res) =>
    res.json({
      data: {
        planta: await this.service.update(
          req.validatedParams.id,
          req.usuario.id,
          req.validatedBody,
        ),
      },
    });
  arquivar = async (req, res) => {
    await this.service.archive(req.validatedParams.id, req.usuario.id);
    res.status(204).end();
  };
  especie = async (req, res) =>
    res.json({
      data: {
        planta: await this.service.setSpecies(
          req.validatedParams.id,
          req.usuario.id,
          req.validatedBody.especieId,
        ),
      },
    });
}

module.exports = PlantaController;