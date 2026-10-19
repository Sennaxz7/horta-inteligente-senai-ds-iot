const { z } = require("zod");
const AppError = require("../utils/AppError");

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        score: z.number().min(0).max(1),
        species: z.object({
          scientificNameWithoutAuthor: z.string().trim().min(2).max(255),
          commonNames: z.array(z.string()).nullish(),
        }),
      }),
    )
    .max(100),
});

class PlantNetService {
  constructor({ env, fetchImpl = fetch }) {
    Object.assign(this, { env, fetchImpl });
  }

  assertConfigured() {
    if (!this.env.PLANTNET_API_KEY) {
      throw new AppError(
        503,
        "PLANTNET_NOT_CONFIGURED",
        "A identificação por imagem ainda não foi configurada no servidor.",
      );
    }
  }

  async identify(buffer, orgao) {
    this.assertConfigured();
    const url = new URL(
      `https://my-api.plantnet.org/v2/identify/${this.env.PLANTNET_PROJECT}`,
    );
    url.searchParams.set("api-key", this.env.PLANTNET_API_KEY);
    url.searchParams.set("nb-results", "5");
    url.searchParams.set("lang", "pt");
    const body = new FormData();
    body.append(
      "images",
      new Blob([buffer], { type: "image/jpeg" }),
      "planta.jpg",
    );
    body.append("organs", orgao);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(this.env.PLANTNET_TIMEOUT_MS),
        redirect: "error",
      });
      if (!response.ok) {
        if (response.status === 404)
          throw new AppError(
            422,
            "PLANTNET_NO_RESULT",
            "Não foi possível identificar uma planta nesta imagem.",
          );
        if (response.status === 429)
          throw new AppError(
            503,
            "PLANTNET_QUOTA_EXCEEDED",
            "O limite de identificações foi atingido. Tente novamente mais tarde.",
          );
        if ([401, 403].includes(response.status))
          throw new AppError(
            502,
            "PLANTNET_AUTH_ERROR",
            "O servidor não conseguiu autenticar na PlantNet.",
          );
        throw new AppError(
          502,
          "PLANTNET_UNAVAILABLE",
          "A PlantNet não conseguiu processar a solicitação.",
        );
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 512 * 1024)
          throw new AppError(
            502,
            "PLANTNET_INVALID_RESPONSE",
            "Resposta inválida da PlantNet.",
          );
        chunks.push(Buffer.from(chunk));
      }
      let decoded;
      try {
        decoded = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new AppError(
          502,
          "PLANTNET_INVALID_RESPONSE",
          "Resposta inválida da PlantNet.",
        );
      }
      const result = resultSchema.safeParse(decoded);
      if (!result.success)
        throw new AppError(
          502,
          "PLANTNET_INVALID_RESPONSE",
          "Resposta inválida da PlantNet.",
        );
      return result.data.results.slice(0, 5).map((item) => ({
        nomeCientifico: item.species.scientificNameWithoutAuthor.replace(
          /\s+/g,
          " ",
        ),
        nomeComum: item.species.commonNames?.[0]?.slice(0, 160) || null,
        confianca: item.score,
        plantNetId: null,
      }));
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (["AbortError", "TimeoutError"].includes(error.name)) {
        throw new AppError(
          504,
          "PLANTNET_TIMEOUT",
          "A PlantNet demorou a responder. Tente novamente.",
        );
      }
      // Não propagar erros de fetch: podem incluir a URL com a chave.
      throw new AppError(
        502,
        "PLANTNET_UNAVAILABLE",
        "Não foi possível consultar a PlantNet.",
      );
    }
  }
}

module.exports = PlantNetService;
