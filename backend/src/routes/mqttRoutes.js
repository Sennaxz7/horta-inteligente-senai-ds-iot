const { Router } = require("express");
const auth = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validateRequest");
const s = require("../validators/mqttValidators");
module.exports = ({ env, authService, services }) => {
  const router = Router();
  const service = services.mqttService;
  const models = service.models;
  router.use(auth({ env, authService }));
  const params = validate(s.params, "params");
  const page = validate(s.pagination, "query");
  router.get("/dispositivos", page, async (req, res) =>
    res.json(await service.listDevices(req.usuario.id, req.validatedQuery)),
  );
  router.post("/dispositivos", validate(s.dispositivo), async (req, res) => {
    res
      .status(201)
      .json({
        data: await models.Dispositivo.create({
          ...req.validatedBody,
          usuarioId: req.usuario.id,
        }),
      });
  });
  router.get("/dispositivos/:id", params, async (req, res) =>
    res.json({ data: await service.owned(req.params.id, req.usuario.id) }),
  );
  router.patch(
    "/dispositivos/:id",
    params,
    validate(s.dispositivoPatch),
    async (req, res) => {
      const device = await service.owned(req.params.id, req.usuario.id);
      // O modo simulado é imutável para preservar o significado do histórico.
      res.json({ data: await device.update({ nome: req.validatedBody.nome }) });
    },
  );
  router.delete("/dispositivos/:id", params, async (req, res) => {
    const device = await service.owned(req.params.id, req.usuario.id);
    await device.update({ arquivadoEm: new Date() });
    res.status(204).end();
  });
  router.get("/dispositivos/:id/zonas", params, page, async (req, res) => {
    await service.owned(req.params.id, req.usuario.id);
    const { pageOptions, paginated } = require("../utils/pagination");
    res.json(
      paginated(
        await models.ZonaIrrigacao.findAndCountAll({
          where: { dispositivoId: req.params.id },
          ...pageOptions(req.validatedQuery),
          order: [
            ["createdAt", "ASC"],
            ["id", "ASC"],
          ],
        }),
        req.validatedQuery,
      ),
    );
  });
  router.post(
    "/dispositivos/:id/zonas",
    params,
    validate(s.zona),
    async (req, res) =>
      res
        .status(201)
        .json({
          data: await service.saveZone(
            req.params.id,
            req.usuario.id,
            req.validatedBody,
          ),
        }),
  );
  router.put(
    "/dispositivos/:id/zonas/:zonaId",
    params,
    validate(s.zona),
    async (req, res) =>
      res.json({
        data: await service.saveZone(
          req.params.id,
          req.usuario.id,
          req.validatedBody,
          req.params.zonaId,
        ),
      }),
  );
  for (const [path, type] of [
    ["leituras", "sensores"],
    ["eventos", "eventos"],
    ["status", "status"],
  ])
    router.get(`/dispositivos/:id/${path}`, params, page, async (req, res) =>
      res.json(
        await service.history(
          req.params.id,
          req.usuario.id,
          req.validatedQuery,
          type,
        ),
      ),
    );
  router.get(
    "/dispositivos/:id/zonas/:zonaId/configuracao",
    params,
    async (req, res) => {
      await service.owned(req.params.id, req.usuario.id);
      await service.zone(req.params.id, req.params.zonaId);
      res.json({
        data: await models.ConfiguracaoMqtt.findOne({
          where: { dispositivoId: req.params.id, zonaId: req.params.zonaId },
          order: [
            ["createdAt", "DESC"],
            ["id", "DESC"],
          ],
        }),
      });
    },
  );
  router.post(
    "/dispositivos/:id/zonas/:zonaId/sincronizacao",
    params,
    validate(s.config),
    async (req, res) =>
      res
        .status(202)
        .json({
          data: await service.synchronize(
            req.params.id,
            req.params.zonaId,
            req.usuario.id,
            req.validatedBody,
          ),
        }),
  );
  router.get("/plantas/:id/leituras", params, page, async (req, res) => {
    const plant = await models.Planta.findOne({
      where: { id: req.params.id, usuarioId: req.usuario.id },
    });
    if (!plant)
      throw new (require("../utils/AppError"))(
        404,
        "PLANT_NOT_FOUND",
        "Planta não encontrada.",
      );
    const { pageOptions, paginated } = require("../utils/pagination");
    res.json(
      paginated(
        await models.MensagemMqtt.findAndCountAll({
          where: { plantaId: plant.id, tipo: "sensores" },
          ...pageOptions(req.validatedQuery),
          order: [
            ["medidoEm", "DESC"],
            ["id", "DESC"],
          ],
        }),
        req.validatedQuery,
      ),
    );
  });
  return router;
};
