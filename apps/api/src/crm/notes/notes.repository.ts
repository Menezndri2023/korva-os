import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Note, NoteDocument } from './schemas/note.schema';

@Injectable()
export class NotesRepository {
  constructor(
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
  ) {}

  create(data: Partial<Note>): Promise<NoteDocument> {
    return this.noteModel.create(data);
  }

  findForEntity(
    organizationId: string,
    entity: 'contact' | 'lead' | 'deal',
    entityId: string,
  ): Promise<NoteDocument[]> {
    return this.noteModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        entity,
        entityId: new Types.ObjectId(entityId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}
