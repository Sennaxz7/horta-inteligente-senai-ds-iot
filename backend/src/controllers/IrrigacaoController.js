class IrrigacaoController {
  constructor({ perfilIrrigacaoService, irrigacaoService }) {
    this.profiles = perfilIrrigacaoService;
    this.irrigations = irrigacaoService;
  }
  listar = async (req, res) => res.json(await this.profiles.list(req.usuario.id, req.validatedQuery));
  obter = async (req, res) => res.json({ data: { perfil: await this.profiles.get(req.validatedParams.id, req.usuario.id) } });
  criar = async (req, res) => res.status(201).json({ data: { perfil: await this.profiles.create(req.usuario.id, req.validatedBody) } });
  atualizar = async (req, res) => res.json({ data: { perfil: await this.profiles.update(req.validatedParams.id, req.usuario.id, req.validatedBody) } });
  copiar = async (req, res) => res.status(201).json({ data: { perfil: await this.profiles.copy(req.validatedParams.id, req.usuario.id) } });
  arquivar = async (req, res) => {
    await this.profiles.archive(req.validatedParams.id, req.usuario.id);
    res.status(204).end();
  };
  consultarVinculo = async (req, res) => res.json({ data: await this.profiles.association(req.validatedParams.id, req.usuario.id) });
  vincular = async (req, res) => res.json({ data: await this.profiles.bind(req.validatedParams.id, req.usuario.id, req.validatedBody.perfilIrrigacaoId) });
  historico = async (req, res) => res.json(await this.irrigations.list(req.validatedParams.id, req.usuario.id, req.validatedQuery));
}
module.exports = IrrigacaoController;
