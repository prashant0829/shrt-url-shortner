import { HttpStatus } from '../constants.js';
import { currentUser } from '../middleware/auth.middleware.js';

const toUserView = (user) => ({
  id: user.id,
  email: user.email,
  createdAt: user.createdAt.toISOString(),
});

export function createAuthController({ authService, tokenService }) {
  async function openSession(user) {
    return { ...(await tokenService.issue(user.id)), user: toUserView(user) };
  }

  async function register(req, res) {
    const { email, password } = req.input.body;
    const user = await authService.register(email, password);
    res.status(HttpStatus.CREATED).json(await openSession(user));
  }

  async function login(req, res) {
    const { email, password } = req.input.body;
    res.json(await openSession(await authService.login(email, password)));
  }

  async function me(req, res) {
    const user = await authService.getUser(currentUser(req).id);
    res.json({ user: toUserView(user) });
  }

  return { register, login, me };
}
