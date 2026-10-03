import { ErrorCode } from '../constants.js';
import { conflictError, unauthorizedError } from '../errors.js';

export function createAuthService({ users, hasher }) {
  let dummyPasswordHash;

  function getDummyPasswordHash() {
    dummyPasswordHash ??= hasher.hash('timing-equalisation-placeholder');
    return dummyPasswordHash;
  }

  async function register(email, password) {
    const passwordHash = await hasher.hash(password);
    const user = await users.create({ email, passwordHash });
    if (!user) {
      throw conflictError(ErrorCode.EMAIL_TAKEN, 'An account with this email already exists');
    }
    return user;
  }

  async function login(email, password) {
    const user = await users.findByEmail(email);

    // Unknown emails are verified against a dummy hash too, so the response time does not reveal
    // which accounts exist.
    const storedHash = user?.passwordHash ?? (await getDummyPasswordHash());
    const passwordMatches = await hasher.verify(password, storedHash);

    if (!user || !passwordMatches) {
      throw unauthorizedError(ErrorCode.INVALID_CREDENTIALS, 'Invalid email or password');
    }
    return user;
  }

  async function getUser(id) {
    const user = await users.findById(id);
    if (!user) {
      throw unauthorizedError(ErrorCode.INVALID_TOKEN, 'The account no longer exists');
    }
    return user;
  }

  return { register, login, getUser };
}
