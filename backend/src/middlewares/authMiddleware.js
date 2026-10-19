const jwt = require("jsonwebtoken");
const { z } = require("zod");
const AppError = require("../utils/AppError");

function authMiddleware({ env, authService }) {
  return async (req, res, next) => {
    const header = req.get("authorization");
    const match =
      typeof header === "string" && /^Bearer ([^\s]+)$/i.exec(header);
    if (!match)
      throw new AppError(
        401,
        "AUTH_REQUIRED",
        "Informe um token Bearer válido.",
      );

    let payload;
    try {
      payload = jwt.verify(match[1], env.JWT_SECRET, {
        algorithms: ["HS256"],
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      });
      if (
        typeof payload !== "object" ||
        !z.string().uuid().safeParse(payload.sub).success ||
        !Number.isInteger(payload.exp) ||
        !Number.isInteger(payload.iat)
      ) {
        throw new Error("Claims inválidas.");
      }
    } catch {
      throw new AppError(
        401,
        "INVALID_TOKEN",
        "Token inválido ou expirado. Faça login novamente.",
      );
    }

    req.usuario = await authService.getUser(payload.sub);
    next();
  };
}

module.exports = authMiddleware;