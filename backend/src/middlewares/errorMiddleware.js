const AppError = require("../utils/AppError");
const { MulterError } = require("multer");

function errorMiddleware(logger = console) {
  return (error, req, res, next) => {
    if (res.headersSent) return next(error);
    let known = error;
    if (error instanceof MulterError) {
      known =
        error.code === "LIMIT_FILE_SIZE"
          ? new AppError(
              413,
              "IMAGE_TOO_LARGE",
              "Envie uma imagem de até 5 MiB.",
            )
          : new AppError(
              422,
              "INVALID_UPLOAD",
              "Envie uma única foto e os campos permitidos.",
            );
    } else if (error.type === "entity.parse.failed") {
      known = new AppError(
        400,
        "INVALID_JSON",
        "O corpo da requisição contém JSON inválido.",
      );
    } else if (error.type === "entity.too.large") {
      known = new AppError(
        413,
        "PAYLOAD_TOO_LARGE",
        "O corpo da requisição excede o limite permitido.",
      );
    } else if (
      error.type === "encoding.unsupported" ||
      error.type === "charset.unsupported"
    ) {
      known = new AppError(
        415,
        "UNSUPPORTED_ENCODING",
        "Codificação não suportada.",
      );
    }

    if (!(known instanceof AppError)) {
      // Não registrar corpo, cabeçalhos, SQL ou mensagem bruta de drivers.
      logger.error(
        { requestId: req.requestId, errorType: error.name || "Error" },
        "Falha interna.",
      );
      known = new AppError(
        500,
        "INTERNAL_ERROR",
        "Não foi possível concluir a solicitação.",
      );
    }

    if (known.status === 401) res.set("WWW-Authenticate", "Bearer");
    res.status(known.status).json({
      error: {
        code: known.code,
        message: known.message,
        ...(known.details ? { details: known.details } : {}),
        requestId: req.requestId,
      },
    });
  };
}

module.exports = errorMiddleware;