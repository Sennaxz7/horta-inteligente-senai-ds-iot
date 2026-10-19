const { Router } = require("express");
const { rateLimit } = require("express-rate-limit");
const authMiddleware = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validateRequest");
const { upload } = require("../middlewares/uploadMiddleware");
const schemas = require("../validators/plantaValidators");
const CatalogoController = require("../controllers/CatalogoController");
const PlantaController = require("../controllers/PlantaController");
const CrescimentoController = require("../controllers/CrescimentoController");
const FotoController = require("../controllers/FotoController");
const IdentificacaoController = require("../controllers/IdentificacaoController");

module.exports = function recursoRoutes({ env, authService, services }) {
  const router = Router();
  router.use(authMiddleware({ env, authService }));
  const catalogo = new CatalogoController(services.catalogoService);
  const plantas = new PlantaController(services.plantaService);
  const crescimento = new CrescimentoController(services.crescimentoService);
  const fotos = new FotoController(services.fotoService);
  const identificacao = new IdentificacaoController(
    services.identificacaoService,
  );
  const id = validate(schemas.idParams, "params");
  const fileRateLimit = (limit) =>
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit,
      keyGenerator: (req) => req.usuario.id,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: {
          code: "RATE_LIMITED",
          message: "Muitas solicitações. Tente novamente mais tarde.",
        },
      },
    });

  router.get(
    "/especies",
    validate(schemas.especieQuerySchema, "query"),
    catalogo.especies,
  );
  router.post(
    "/especies",
    validate(schemas.especieCreateSchema),
    catalogo.criarEspecie,
  );
  router.get("/especies/:id", id, catalogo.especie);
  router.get("/fases-crescimento", catalogo.fases);
  router.get(
    "/plantas",
    validate(schemas.plantaQuerySchema, "query"),
    plantas.listar,
  );
  router.post("/plantas", validate(schemas.plantaCreateSchema), plantas.criar);
  router.get("/plantas/:id", id, plantas.obter);
  router.patch(
    "/plantas/:id",
    id,
    validate(schemas.plantaPatchSchema),
    plantas.atualizar,
  );
  router.delete("/plantas/:id", id, plantas.arquivar);
  router.put(
    "/plantas/:id/especie",
    id,
    validate(schemas.especieManualSchema),
    plantas.especie,
  );
  router.get(
    "/plantas/:id/crescimento",
    id,
    validate(schemas.crescimentoQuerySchema, "query"),
    crescimento.listar,
  );
  router.post(
    "/plantas/:id/crescimento",
    id,
    validate(schemas.crescimentoCreateSchema),
    crescimento.criar,
  );
  router.get(
    "/plantas/:id/fotos",
    id,
    validate(schemas.paginationSchema, "query"),
    fotos.listar,
  );
  router.post(
    "/plantas/:id/fotos",
    id,
    fileRateLimit(30),
    async (req, res, next) => {
      await services.plantaService.owned(
        req.validatedParams.id,
        req.usuario.id,
        { active: true },
      );
      next();
    },
    upload,
    validate(schemas.fotoCreateSchema),
    fotos.criar,
  );
  router.get(
    "/plantas/:id/fotos/:fotoId/arquivo",
    validate(schemas.fotoParams, "params"),
    fotos.arquivo,
  );
  router.get(
    "/plantas/:id/identificacoes",
    id,
    validate(schemas.paginationSchema, "query"),
    identificacao.listar,
  );
  router.post(
    "/plantas/:id/identificacoes",
    id,
    fileRateLimit(10),
    validate(schemas.identificacaoCreateSchema),
    identificacao.identificar,
  );
  router.post(
    "/plantas/:id/identificacoes/:identificacaoId/confirmacao",
    validate(schemas.identificacaoParams, "params"),
    validate(schemas.confirmacaoSchema),
    identificacao.confirmar,
  );
  return router;
};
