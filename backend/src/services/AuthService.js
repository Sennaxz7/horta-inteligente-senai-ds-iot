const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { UniqueConstraintError } = require("sequelize");
const AppError = require("../utils/AppError");

function publicUser(user) {
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

class AuthService {
  constructor({ Usuario, env }) {
    this.Usuario = Usuario;
    this.env = env;
    this.dummyHash = null;
  }

  async initialize() {
    // Mesmo trabalho de bcrypt para usuário inexistente e senha incorreta.
    this.dummyHash = await bcrypt.hash(
      require("node:crypto").randomBytes(32).toString("hex"),
      this.env.BCRYPT_ROUNDS,
    );
  }

  async register({ nome, email, senha }) {
    const senhaHash = await bcrypt.hash(senha, this.env.BCRYPT_ROUNDS);
    try {
      const user = await this.Usuario.create({ nome, email, senhaHash });
      return { usuario: publicUser(user) };
    } catch (error) {
      // A restrição UNIQUE também resolve cadastros concorrentes.
      if (error instanceof UniqueConstraintError) {
        throw new AppError(
          409,
          "EMAIL_IN_USE",
          "Este e-mail já está cadastrado.",
        );
      }
      throw error;
    }
  }

  async login({ email, senha }) {
    if (!this.dummyHash) throw new Error("AuthService não foi inicializado.");
    const user = await this.Usuario.scope("comSenha").findOne({
      where: { email },
    });
    const matches = await bcrypt.compare(
      senha,
      user ? user.senhaHash : this.dummyHash,
    );
    if (!user || !matches)
      throw new AppError(
        401,
        "INVALID_CREDENTIALS",
        "E-mail ou senha inválidos.",
      );

    const accessToken = jwt.sign({}, this.env.JWT_SECRET, {
      algorithm: "HS256",
      subject: user.id,
      expiresIn: this.env.JWT_EXPIRES_IN_SECONDS,
      issuer: this.env.JWT_ISSUER,
      audience: this.env.JWT_AUDIENCE,
    });
    return {
      usuario: publicUser(user),
      accessToken,
      tokenType: "Bearer",
      expiresIn: this.env.JWT_EXPIRES_IN_SECONDS,
    };
  }

  async getUser(id) {
    const user = await this.Usuario.findByPk(id);
    if (!user)
      throw new AppError(
        401,
        "INVALID_TOKEN",
        "Sessão inválida. Faça login novamente.",
      );
    return publicUser(user);
  }
}

module.exports = AuthService;
