import { Types } from 'mongoose';
import { LEGAL_ENTITY } from '@korva/types';
import { DocumentRenderingService } from '../rendering/document-rendering.service';
import { buildKorvaSubscriptionInvoiceManifest } from './korva-subscription-invoice.template';
import { organizationIssuer } from './document-issuer';

const invoice = {
  _id: new Types.ObjectId(),
  number: 'ABO-0007',
  status: 'paid',
  amount: 99000,
  currency: 'XOF',
  issuedAt: new Date('2026-11-27T10:00:00Z'),
  dueAt: new Date('2026-12-04T10:00:00Z'),
  paidAt: new Date('2026-11-27T11:00:00Z'),
  periodStart: new Date('2026-11-27T10:00:00Z'),
  periodEnd: new Date('2027-11-27T10:00:00Z'),
} as never;
const plan = { name: 'Starter', interval: 'year' } as never;

describe('KORVA subscription invoice', () => {
  it('is issued by VIT GLOBAL with its RC and ICE, to the business, for the period paid', () => {
    const manifest = buildKorvaSubscriptionInvoiceManifest(invoice, plan, {
      name: 'Freeworld',
      legalName: 'Freeworld SARL',
      contactAddress: 'Cocody, Abidjan',
      legalIdentifiers: 'RCCM CI-ABJ-2024-A-1234',
      language: 'fr',
    });

    expect(manifest.organizationHeader.name).toBe(
      `${LEGAL_ENTITY.name} ${LEGAL_ENTITY.form}`,
    );
    expect(manifest.organizationHeader.lines?.[0]).toContain(
      `ICE ${LEGAL_ENTITY.ice}`,
    );
    expect(manifest.organizationHeader.lines?.[0]).toContain(
      `RC ${LEGAL_ENTITY.rc}`,
    );
    const customer = manifest.metadata.find((m) => m.label === 'Client');
    expect(customer?.value).toBe(
      'Freeworld SARL · Cocody, Abidjan · RCCM CI-ABJ-2024-A-1234',
    );
    expect(manifest.table?.rows[0]?.[0]).toBe('Abonnement Starter (1 an)');
  });

  it('renders to a real PDF, accents and all', async () => {
    const buffer = await new DocumentRenderingService().renderPdf(
      buildKorvaSubscriptionInvoiceManifest(invoice, plan, {
        name: 'Épicerie Ébène',
        language: 'fr',
      }),
    );
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('organizationIssuer — a business invoice names who issues it', () => {
  it('prints the legal name, address, phone and legal identifiers the business gave', () => {
    expect(
      organizationIssuer({
        name: 'Chez Awa',
        legalName: 'Awa Restauration SARL',
        contactAddress: 'Plateau, Abidjan',
        contactPhone: '+225 07 07 07 07 07',
        legalIdentifiers: 'RCCM CI-ABJ-2024-B-99 · NCC 2412345 A',
      }),
    ).toEqual({
      name: 'Awa Restauration SARL',
      address: 'Plateau, Abidjan',
      lines: [
        'Chez Awa',
        '+225 07 07 07 07 07',
        'RCCM CI-ABJ-2024-B-99 · NCC 2412345 A',
      ],
    });
  });

  it('falls back to the trading name alone when nothing else is filled in', () => {
    expect(organizationIssuer({ name: 'Chez Awa' })).toEqual({
      name: 'Chez Awa',
    });
  });
});
