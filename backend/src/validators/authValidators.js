const { z } = require("zod");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .email("Informe um e-mail válido.");
const password = z
  .string()
  .min(12, "A senha deve ter pelo menos 12 caracteres.")
  .max(72, "A senha deve ter no máximo 72 bytes.")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 72,
    "A senha deve ter no máximo 72 bytes.",
  )
  .refine(
    (value) => !value.includes("\0"),
    "A senha não pode conter byte nulo.",
  );

const registerSchema = z
  .object({
    nome: z.string().trim().min(2).max(120),
    email,
    senha: password,
  })
  .strict();

const loginSchema = z
  .object({
    email,
    senha: z
      .string()
      .min(1)
      .max(72)
      .refine((value) => Buffer.byteLength(value, "utf8") <= 72)
      .refine((value) => !value.includes("\0")),
  })
  .strict();

module.exports = { registerSchema, loginSchema };
