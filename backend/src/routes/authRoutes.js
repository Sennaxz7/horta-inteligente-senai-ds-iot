const { Router } = require("express");
const { rateLimit } = require("express-rate-limit");
const AuthController = require("../controllers/AuthController");
const authMiddleware = require("../middlewares/authMiddleware");
const validateBody = require("../middlewares/validateBody");
const { registerSchema, loginSchema } = require("../validators/authValidators");

function authRoutes({ env, authService }) {
  const router = Router();
  const controller = new AuthController(authService);
  const limiter = rateLimit({
    windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
    limit: env.AUTH_RATE_LIMIT_MAX,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      error: {
        code: "RATE_LIMITED",
        message: "Muitas tentativas. Tente novamente mais tarde.",
      },
    },
  });

  router.post(
    "/register",
    limiter,
    validateBody(registerSchema),
    controller.register,
  );
  router.post("/login", limiter, validateBody(loginSchema), controller.login);
  router.get("/me", authMiddleware({ env, authService }), controller.me);
  return router;
}

module.exports = authRoutes;
