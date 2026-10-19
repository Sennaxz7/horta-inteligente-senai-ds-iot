class AuthController {
  constructor(authService) {
    this.authService = authService;
  }

  register = async (req, res) => {
    res
      .status(201)
      .json({ data: await this.authService.register(req.validatedBody) });
  };

  login = async (req, res) => {
    res.json({ data: await this.authService.login(req.validatedBody) });
  };

  me = (req, res) => {
    res.json({ data: { usuario: req.usuario } });
  };
}

module.exports = AuthController;
