import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { SessionsRepository } from './sessions.repository';
import { SessionDocument } from '../schemas/session.schema';

interface CreateSessionInput {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

@Injectable()
export class SessionsService {
  constructor(private readonly sessionsRepository: SessionsRepository) {}

  create(input: CreateSessionInput): Promise<SessionDocument> {
    return this.sessionsRepository.create({
      userId: new Types.ObjectId(input.userId),
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  revokeActiveByTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionDocument | null> {
    return this.sessionsRepository.revokeActiveByTokenHash(refreshTokenHash);
  }

  findByTokenHash(refreshTokenHash: string): Promise<SessionDocument | null> {
    return this.sessionsRepository.findByTokenHash(refreshTokenHash);
  }

  revokeByTokenHash(refreshTokenHash: string): Promise<void> {
    return this.sessionsRepository.revokeByTokenHash(refreshTokenHash);
  }

  revokeAllForUser(userId: string): Promise<void> {
    return this.sessionsRepository.revokeAllForUser(userId);
  }
}
