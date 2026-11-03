const { Router } = require("express");
const auth = require("../middlewares/authMiddleware");
const validate = require("../middlewares/validateRequest");
const s = require("../validators/irrigacaoValidators");
const Controller = require("../controllers/IrrigacaoController");

module.exports = ({ env, authService, services }) => {
  const router = Router();
  router.use(auth({ env, authService }));
  const c = new Controller(services);
  const id = validate(s.params, "params");
  router.get("/perfis-irrigacao", validate(s.list, "query"), c.listar);
  router.post("/perfis-irrigacao", validate(s.create), c.criar);
  router.get("/perfis-irrigacao/:id", id, c.obter);
  router.patch("/perfis-irrigacao/:id", id, validate(s.patch), c.atualizar);
  router.delete("/perfis-irrigacao/:id", id, c.arquivar);
  router.post("/perfis-irrigacao/:id/copia", id, validate(require("zod").z.object({}).strict()), c.copiar);
  router.get("/plantas/:id/perfil-irrigacao", id, c.consultarVinculo);
  router.put("/plantas/:id/perfil-irrigacao", id, validate(s.bind), c.vincular);
  router.get("/plantas/:id/irrigacoes", id, validate(s.history, "query"), c.historico);
  return router;
};
