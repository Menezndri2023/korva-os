import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { UsersRepository } from './users.repository';
import { UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  async create(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string,
  ): Promise<UserDocument> {
    const passwordHash = await argon2.hash(password);
    return this.usersRepository.create({
      email,
      passwordHash,
      firstName,
      lastName,
    });
  }

  findByEmail(
    email: string,
    withPasswordHash = false,
  ): Promise<UserDocument | null> {
    return this.usersRepository.findByEmail(email, withPasswordHash);
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.usersRepository.findById(id);
  }

  verifyPassword(passwordHash: string, plain: string): Promise<boolean> {
    return argon2.verify(passwordHash, plain);
  }
}
