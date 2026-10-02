import { SignJWT, errors, jwtVerify } from 'jose';
import { UnauthorizedError } from '../../shared/errors.js';

/**
 * @typedef {object} AuthUser
 * @property {string} id
 */

const ISSUER = 'url-shortener';
const AUDIENCE = 'url-shortener-api';
const ALGORITHM = 'HS256';

/** Issues and verifies short-lived access tokens (HS256 JWTs) without depending on the web framework. */
export class TokenService {
  #key;
  #options;

  /** @param {{secret: string, ttlSeconds: number}} options */
  constructor(options) {
    this.#options = options;

    this.#key = new TextEncoder().encode(options.secret);
  }

  async issue(userId) {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.#options.ttlSeconds}s`)
      .sign(this.#key);

    return { token, expiresIn: this.#options.ttlSeconds };
  }

  async verify(token) {
    try {
      const { payload } = await jwtVerify(token, this.#key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: [ALGORITHM],
      });
      if (!payload.sub) throw new errors.JWTInvalid('missing subject');
      return { id: payload.sub };
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        throw new UnauthorizedError('TOKEN_EXPIRED', 'The access token has expired');
      }
      throw new UnauthorizedError('INVALID_TOKEN', 'The access token is not valid');
    }
  }
}
