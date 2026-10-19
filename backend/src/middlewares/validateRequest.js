const AppError = require("../utils/AppError");

module.exports = function validateRequest(schema, source = "body") {
  const targets = {
    body: "validatedBody",
    query: "validatedQuery",
    params: "validatedParams",
  };
  if (!targets[source]) throw new Error("Origem de validação inválida.");
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        new AppError(
          422,
          "VALIDATION_ERROR",
          "Verifique os campos enviados.",
          result.error.issues.map((issue) => ({
            campo: issue.path.join("."),
            mensagem: issue.message,
          })),
        ),
      );
    }
    req[targets[source]] = result.data;
    next();
  };
};
