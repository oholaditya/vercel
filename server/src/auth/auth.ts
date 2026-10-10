import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { NextFunction, Request, Response } from 'express';
import type { PublicUser, Role } from '../domain/types.js';
import type { UserRepository } from '../db/repositories.js';

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: PublicUser;
  }
}

/** Role hierarchy: admin > operator > viewer. */
const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };

// A constant hash used to equalise timing when the username does not exist.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

export class AuthService {
  constructor(private readonly users: UserRepository, private readonly cfg: AuthConfig) {}

  async login(username: string, password: string): Promise<{ token: string; user: PublicUser } | null> {
    const record = this.users.findByUsername(username);
    const ok = await bcrypt.compare(password, record?.passwordHash ?? DUMMY_HASH);
    if (!record || !ok) return null;
    const user: PublicUser = { id: record.id, username: record.username, role: record.role };
    const token = jwt.sign({ sub: user.id, role: user.role, name: user.username }, this.cfg.jwtSecret, {
      expiresIn: this.cfg.jwtExpiresIn as SignOptions['expiresIn'],
      algorithm: 'HS256',
    });
    return { token, user };
  }

  /** Verifies a token and re-checks the user still exists with the same role. */
  verify(token: string): PublicUser | null {
    try {
      const payload = jwt.verify(token, this.cfg.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
      const record = payload.sub ? this.users.findById(payload.sub) : null;
      if (!record) return null;
      return { id: record.id, username: record.username, role: record.role };
    } catch {
      return null;
    }
  }
}

export function requireAuth(auth: AuthService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? auth.verify(token) : null;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.user = user;
    next();
  };
}

export function hasRole(user: PublicUser | undefined, min: Role): boolean {
  return !!user && RANK[user.role] >= RANK[min];
}

export function requireRole(min: Role, onDenied?: (req: Request) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!hasRole(req.user, min)) {
      onDenied?.(req);
      res.status(403).json({ error: `Requires ${min} role` });
      return;
    }
    next();
  };
}
