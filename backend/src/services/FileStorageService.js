const path = require("node:path");
const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const AppError = require("../utils/AppError");
const { MAX_UPLOAD_BYTES } = require("../middlewares/uploadMiddleware");

class FileStorageService {
  constructor({ env }) {
    this.root = path.resolve(__dirname, "../..", env.UPLOAD_DIR);
  }

  pathFor(key) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/.test(
        key,
      )
    ) {
      throw new Error("Chave de arquivo inválida.");
    }
    return path.join(this.root, key);
  }

  async save(file) {
    if (!file)
      throw new AppError(
        422,
        "PHOTO_REQUIRED",
        "Envie a imagem no campo foto.",
      );
    let buffer;
    try {
      const image = sharp(file.buffer, {
        limitInputPixels: 25000000,
        failOn: "warning",
      });
      const metadata = await image.metadata();
      if (
        !["jpeg", "png", "webp"].includes(metadata.format) ||
        (metadata.pages || 1) > 1
      )
        throw new Error("Formato inválido.");
      // Reencodar remove metadados e conteúdo extra; a orientação EXIF é aplicada antes.
      buffer = await image
        .rotate()
        .resize({
          width: 2400,
          height: 2400,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 90 })
        .toBuffer();
    } catch {
      throw new AppError(
        422,
        "INVALID_IMAGE",
        "Imagem inválida, animada ou acima do limite de 25 milhões de pixels.",
      );
    }
    if (buffer.length > MAX_UPLOAD_BYTES)
      throw new AppError(
        413,
        "IMAGE_TOO_LARGE",
        "A imagem processada excede 5 MiB.",
      );
    const key = `${randomUUID()}.jpg`;
    await fs.mkdir(this.root, { recursive: true });
    await fs.writeFile(this.pathFor(key), buffer, { flag: "wx", mode: 0o600 });
    return {
      chaveArquivo: key,
      mimeType: "image/jpeg",
      tamanhoBytes: buffer.length,
    };
  }

  async read(key) {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch (error) {
      if (error.code === "ENOENT")
        throw new AppError(
          404,
          "PHOTO_FILE_NOT_FOUND",
          "Arquivo da foto não encontrado.",
        );
      throw error;
    }
  }

  async remove(key) {
    await fs.rm(this.pathFor(key), { force: true });
  }
}

module.exports = FileStorageService;
