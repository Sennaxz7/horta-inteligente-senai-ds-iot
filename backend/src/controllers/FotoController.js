class FotoController {
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
    res.status(201).json({
      data: {
        foto: await this.service.create(
          req.validatedParams.id,
          req.usuario.id,
          req.validatedBody,
          req.file,
        ),
      },
    });
  arquivo = async (req, res) => {
    const { buffer, mimeType } = await this.service.download(
      req.validatedParams.id,
      req.validatedParams.fotoId,
      req.usuario.id,
    );
    res
      .type(mimeType)
      .set(
        "Content-Disposition",
        `inline; filename="${req.validatedParams.fotoId}.jpg"`,
      )
      .send(buffer);
  };
}

module.exports = FotoController;
