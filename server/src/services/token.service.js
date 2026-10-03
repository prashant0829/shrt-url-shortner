import { SignJWT, errors, jwtVerify } from 'jose';
import { ErrorCode } from '../constants.js';
import { unauthorizedError } from '../errors.js';

const JWT_ISSUER = 'url-shortener';
const JWT_AUDIENCE = 'url-shortener-api';
const JWT_ALGORITHM = 'HS256';

// Issues and verifies short-lived access tokens (HS256 JWTs).
export function createTokenService({ secret, ttlSeconds }) {
  const signingKey = new TextEncoder().encode(secret);

  async function issue(userId) {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: JWT_ALGORITHM })
      .setSubject(userId)
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(signingKey);

    return { token, expiresIn: ttlSeconds };
  }

  async function verify(token) {
    try {
      const { payload } = await jwtVerify(token, signingKey, {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        algorithms: [JWT_ALGORITHM],
      });
      if (!payload.sub) throw new errors.JWTInvalid('missing subject');
      return { id: payload.sub };
    } catch (err) {
      if (err instanceof errors.JWTExpired) {
        throw unauthorizedError(ErrorCode.TOKEN_EXPIRED, 'The access token has expired');
      }
      throw unauthorizedError(ErrorCode.INVALID_TOKEN, 'The access token is not valid');
    }
  }

  return { issue, verify };
}
