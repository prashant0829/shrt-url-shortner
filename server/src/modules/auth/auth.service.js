import { ConflictError, UnauthorizedError } from '../../shared/errors.js';

export class AuthService {
  #dummyHash;
  #deps;

  /** @param {{users: import('./user.repository.js').UserStore, hasher: import('./password-hasher.js').PasswordHasher}} deps */
  constructor(deps) {
    this.#deps = deps;
  }

  async register(email, password) {
    const passwordHash = await this.#deps.hasher.hash(password);
    const user = await this.#deps.users.create({ email, passwordHash });
    if (!user) throw new ConflictError('EMAIL_TAKEN', 'An account with this email already exists');
    return user;
  }

  async login(email, password) {
    const user = await this.#deps.users.findByEmail(email);

    // Verify against a dummy hash for unknown emails so response time does not reveal
    // whether an account exists.
    const stored = user?.passwordHash ?? (await this.#getDummyHash());
    const passwordMatches = await this.#deps.hasher.verify(password, stored);

    if (!user || !passwordMatches) {
      throw new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password');
    }
    return user;
  }

  async getUser(id) {
    const user = await this.#deps.users.findById(id);
    if (!user) throw new UnauthorizedError('INVALID_TOKEN', 'The account no longer exists');
    return user;
  }

  #getDummyHash() {
    this.#dummyHash ??= this.#deps.hasher.hash('timing-equalisation-placeholder');
    return this.#dummyHash;
  }
}
