import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Quiz,
  QuizAttempt,
  QuizAttemptDocument,
  QuizDocument,
} from './schemas/quiz.schema';

@Injectable()
export class QuizzesRepository {
  constructor(
    @InjectModel(Quiz.name) private readonly quizModel: Model<QuizDocument>,
    @InjectModel(QuizAttempt.name)
    private readonly attemptModel: Model<QuizAttemptDocument>,
  ) {}

  create(data: Partial<Quiz>): Promise<QuizDocument> {
    return this.quizModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<QuizDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.quizModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findByCourse(
    organizationId: string,
    courseId: string,
  ): Promise<QuizDocument[]> {
    return this.quizModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        courseId: new Types.ObjectId(courseId),
      })
      .exec();
  }

  createAttempt(data: Partial<QuizAttempt>): Promise<QuizAttemptDocument> {
    return this.attemptModel.create(data);
  }

  findAttemptsForContact(
    organizationId: string,
    quizId: string,
    contactId: string,
  ): Promise<QuizAttemptDocument[]> {
    return this.attemptModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        quizId: new Types.ObjectId(quizId),
        contactId: new Types.ObjectId(contactId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}
