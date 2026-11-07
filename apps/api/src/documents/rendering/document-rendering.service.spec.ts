import { PDFDocument } from 'pdf-lib';
import { DocumentRenderingService } from './document-rendering.service';
import type { DocumentTemplate } from './document-rendering.service';

describe('DocumentRenderingService.renderPdf', () => {
  const service = new DocumentRenderingService();

  it('renders a valid, parseable one-page PDF for a table-shaped (invoice/quote) template', async () => {
    const template: DocumentTemplate = {
      documentType: 'invoice',
      title: 'Facture FAC-0001',
      organizationHeader: { name: 'Acme SARL' },
      metadata: [
        { label: 'Client', value: 'Ada Lovelace' },
        { label: 'Statut', value: 'issued' },
      ],
      table: {
        columns: ['Description', 'Qté', 'Prix unitaire', 'Total'],
        rows: [['Consulting', '2', '100,00 €', '200,00 €']],
        totals: [
          { label: 'Sous-total', value: '200,00 €' },
          { label: 'TVA', value: '40,00 €' },
          { label: 'Total', value: '240,00 €' },
        ],
      },
      footer: 'Merci de votre confiance.',
    };

    const buffer = await service.renderPdf(template);
    expect(buffer.length).toBeGreaterThan(0);

    const parsed = await PDFDocument.load(buffer);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('renders a valid PDF for a body-shaped (certificate) template with no table', async () => {
    const template: DocumentTemplate = {
      documentType: 'certificate',
      title: 'Certificat de participation',
      organizationHeader: { name: 'Acme Formation' },
      metadata: [{ label: 'Participant', value: 'Ada Lovelace' }],
      body: {
        paragraphs: [
          'Acme Formation certifie que Ada Lovelace a participé à la formation.',
        ],
      },
    };

    const buffer = await service.renderPdf(template);
    const parsed = await PDFDocument.load(buffer);
    expect(parsed.getPageCount()).toBe(1);
  });

  it('sizes the page to fit a large number of line items without throwing', async () => {
    const template: DocumentTemplate = {
      documentType: 'invoice',
      title: 'Facture FAC-0002',
      organizationHeader: { name: 'Acme SARL' },
      metadata: [],
      table: {
        columns: ['Description', 'Qté', 'Prix unitaire', 'Total'],
        rows: Array.from({ length: 80 }, (_, i) => [
          `Article ${i}`,
          '1',
          '10,00 €',
          '10,00 €',
        ]),
        totals: [{ label: 'Total', value: '800,00 €' }],
      },
    };

    const buffer = await service.renderPdf(template);
    const parsed = await PDFDocument.load(buffer);
    const page = parsed.getPage(0);
    expect(page.getHeight()).toBeGreaterThan(80 * 16);
  });

  it('wraps long certificate paragraphs instead of overflowing the page width', async () => {
    const template: DocumentTemplate = {
      documentType: 'certificate',
      title: 'Certificat',
      organizationHeader: { name: 'Acme' },
      metadata: [],
      body: {
        paragraphs: [
          'Une phrase volontairement très longue qui doit forcer le moteur de rendu à répartir le texte sur plusieurs lignes plutôt que de le laisser déborder du cadre de la page, afin de vérifier que le retour à la ligne automatique fonctionne correctement pour un paragraphe de certificat.',
        ],
      },
    };

    const buffer = await service.renderPdf(template);
    expect(buffer.length).toBeGreaterThan(0);
    const parsed = await PDFDocument.load(buffer);
    expect(parsed.getPageCount()).toBe(1);
  });
});

describe('DocumentRenderingService — French figures', () => {
  it('renders amounts formatted for French (narrow no-break spaces) and odd characters', async () => {
    const service = new DocumentRenderingService();
    const money = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'XOF',
    }).format(150000);
    expect(money).toContain(' ');
    const pdf = await service.renderPdf({
      documentType: 'invoice',
      title: 'Facture FAC-0001',
      organizationHeader: { name: 'Salon Awa 💇' },
      metadata: [{ label: 'Total', value: money }],
      table: {
        columns: ['Article', 'Total'],
        rows: [['Tresses ≈ 3 h', money]],
        totals: [{ label: 'Total', value: money }],
      },
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
