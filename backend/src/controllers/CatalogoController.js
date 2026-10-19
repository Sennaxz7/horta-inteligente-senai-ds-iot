const { publicSpecies } = require("../services/CatalogoService");

class CatalogoController {
  constructor(service) {
    this.service = service;
  }
  especies = async (req, res) =>
    res.json(await this.service.listSpecies(req.validatedQuery));
  especie = async (req, res) =>
    res.json({
      data: {
        especie: publicSpecies(
          await this.service.getSpecies(req.validatedParams.id),
        ),
      },
    });
  criarEspecie = async (req, res) =>
    res.status(201).json({
      data: { especie: await this.service.createSpecies(req.validatedBody) },
    });
  fases = async (req, res) =>
    res.json({ data: await this.service.listPhases() });
}

module.exports = CatalogoController;
