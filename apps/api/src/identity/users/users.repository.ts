import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  create(data: Partial<User>): Promise<UserDocument> {
    return this.userModel.create(data);
  }

  findByEmail(
    email: string,
    withPasswordHash = false,
  ): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: email.toLowerCase() });
    if (withPasswordHash) query.select('+passwordHash');
    return query.exec();
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.userModel.updateOne({ _id: id }, { passwordHash }).exec();
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.userModel
      .updateOne({ _id: id }, { emailVerifiedAt: new Date() })
      .exec();
  }
}
