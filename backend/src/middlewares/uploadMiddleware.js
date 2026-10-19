const multer = require("multer");
const AppError = require("../utils/AppError");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 1,
    fields: 2,
    parts: 3,
    fieldSize: 200,
    fieldNameSize: 40,
  },
  fileFilter(req, file, callback) {
    if (
      !["image/jpeg", "image/png", "image/webp", "image/jfif"].includes(
        file.mimetype,
      )
    ) {
      return callback(
        new AppError(
          415,
          "UNSUPPORTED_IMAGE",
          "Envie uma imagem JPEG, PNG ou WebP.",
        ),
      );
    }
    callback(null, true);
  },
}).single("foto");

module.exports = { upload, MAX_UPLOAD_BYTES };