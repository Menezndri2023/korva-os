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
      country: 'CI',
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

  it('prints the IF the DGI requires, and no VAT for a business abroad, with the exemption', () => {
    const manifest = buildKorvaSubscriptionInvoiceManifest(invoice, plan, {
      name: 'Freeworld',
      country: 'CI',
      language: 'fr',
    });
    expect(manifest.organizationHeader.lines?.[0]).toContain(
      `IF ${LEGAL_ENTITY.if}`,
    );
    expect(manifest.table?.totals.map((total) => total.label)).toEqual([
      'Total HT',
      'Total à payer',
    ]);
    expect(manifest.footer).toContain('article 92-I-1°');
  });

  it('breaks a Moroccan business’s price down into excl. VAT, 20 % VAT and incl. VAT', () => {
    const manifest = buildKorvaSubscriptionInvoiceManifest(
      { ...(invoice as object), amount: 1990, currency: 'MAD' } as never,
      plan,
      { name: 'Atlas Café', country: 'MA', language: 'fr' },
    );
    const totals = manifest.table!.totals;
    expect(totals.map((total) => total.label)).toEqual([
      'Total HT',
      'TVA 20 %',
      'Total TTC',
    ]);
    // 1 990 incl. VAT = 1 658,33 excl. + 331,67 VAT, to the cent.
    expect(totals[0]!.value).toMatch(/1\s?658,33/);
    expect(totals[1]!.value).toMatch(/331,67/);
    expect(manifest.footer).not.toContain('92-I-1°');
  });

  it('renders to a real PDF, accents and all', async () => {
    const buffer = await new DocumentRenderingService().renderPdf(
      buildKorvaSubscriptionInvoiceManifest(invoice, plan, {
        name: 'Épicerie Ébène',
        country: 'SN',
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
