import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateNoteInput } from '@korva/validation';
import { NotesRepository } from './notes.repository';
import { NoteDocument } from './schemas/note.schema';

@Injectable()
export class NotesService {
  constructor(private readonly notesRepository: NotesRepository) {}

  create(
    organizationId: string,
    userId: string,
    input: CreateNoteInput,
  ): Promise<NoteDocument> {
    return this.notesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      entity: input.entity,
      entityId: new Types.ObjectId(input.entityId),
      content: input.content,
      authorId: new Types.ObjectId(userId),
    });
  }

  listForEntity(
    organizationId: string,
    entity: 'contact' | 'lead',
    entityId: string,
  ): Promise<NoteDocument[]> {
    return this.notesRepository.findForEntity(organizationId, entity, entityId);
  }
}
