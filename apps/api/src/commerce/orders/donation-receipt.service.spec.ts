import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DonationReceiptService } from './donation-receipt.service';
import type { OrderDocument } from './schemas/order.schema';
import { DocumentRenderingService } from '../../documents/rendering/document-rendering.service';
import { buildDonationReceiptDocumentManifest } from '../../documents/templates/donation-receipt-document.template';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';
import type { ContactDocument } from '../../crm/contacts/schemas/contact.schema';

const ORG = new Types.ObjectId().toString();
const donationOfferId = new Types.ObjectId();
const productOfferId = new Types.ObjectId();
const invoiceId = new Types.ObjectId();

function order(overrides: Partial<OrderDocument> = {}): OrderDocument {
  return {
    number: 'CMD-0042',
    currency: 'XOF',
    invoiceId,
    items: [
      {
        offerId: donationOfferId,
        description: 'Don libre',
        quantity: 1,
        unitPrice: 15000,
      },
      {
        offerId: productOfferId,
        description: 'T-shirt',
        quantity: 2,
        unitPrice: 5000,
      },
    ],
    ...overrides,
  } as unknown as OrderDocument;
}

function setup({
  invoiceStatus = 'paid',
  payments = [
    {
      status: 'completed',
      refundedAmount: 0,
      createdAt: new Date('2026-11-10T10:00:00Z'),
    },
  ],
}: {
  invoiceStatus?: string;
  payments?: { status: string; refundedAmount?: number; createdAt?: Date }[];
} = {}) {
  const offersService = {
    findManyByIds: jest.fn().mockResolvedValue([
      { id: donationOfferId.toString(), freeAmount: true },
      { id: productOfferId.toString(), freeAmount: undefined },
    ]),
  };
  const invoicesService = {
    getById: jest.fn().mockResolvedValue({ status: invoiceStatus }),
  };
  const paymentsService = { list: jest.fn().mockResolvedValue(payments) };
  return new DonationReceiptService(
    offersService as never,
    invoicesService as never,
    paymentsService as never,
  );
}

const expectNotAvailable = async (
  promise: Promise<unknown>,
  message: string,
) => {
  await expect(promise).rejects.toBeInstanceOf(BadRequestException);
  await expect(promise).rejects.toMatchObject({
    response: { code: 'DONATION_RECEIPT_NOT_AVAILABLE', message },
  });
};

describe('DonationReceiptService', () => {
  it('states only the gifts of a paid order, with the date the money arrived', async () => {
    const receipt = await setup().resolve(ORG, order());
    expect(receipt).toEqual({
      number: 'CMD-0042',
      lines: [{ description: 'Don libre', amount: 15000 }],
      total: 15000,
      currency: 'XOF',
      receivedAt: new Date('2026-11-10T10:00:00Z'),
    });
  });

  it('refuses an order holding no gift', async () => {
    const service = setup();
    await expectNotAvailable(
      service.resolve(ORG, order({ items: [order().items[1]!] })),
      'This order holds no donation',
    );
  });

  it('refuses a gift not received yet, or refunded', async () => {
    await expectNotAvailable(
      setup({ invoiceStatus: 'issued' }).resolve(ORG, order()),
      'This donation has not been received yet',
    );
    await expectNotAvailable(
      setup().resolve(ORG, order({ invoiceId: undefined })),
      'This donation has not been received yet',
    );
    await expectNotAvailable(
      setup({
        payments: [{ status: 'completed', refundedAmount: 5000 }],
      }).resolve(ORG, order()),
      'This donation was refunded',
    );
    expect(
      await setup({ invoiceStatus: 'partially_paid' }).isAvailable(
        ORG,
        order(),
      ),
    ).toBe(false);
    expect(await setup().isAvailable(ORG, order())).toBe(true);
  });

  it('renders a receipt that says it is not a tax receipt, in the association’s language', async () => {
    const receipt = await setup().resolve(ORG, order());
    const organization = {
      name: 'Amis du Plateau',
      legalName: 'Association Les Amis du Plateau',
      language: 'fr',
    } as unknown as OrganizationDocument;
    const contact = {
      firstName: 'Awa',
      lastName: 'Koné',
    } as unknown as ContactDocument;
    const manifest = buildDonationReceiptDocumentManifest(
      receipt,
      organization,
      contact,
    );
    expect(manifest.title).toBe('Reçu de don n° CMD-0042');
    expect(manifest.body!.paragraphs[0]).toContain(
      'Association Les Amis du Plateau atteste avoir reçu de Awa Koné un don de',
    );
    expect(manifest.body!.paragraphs[1]).toContain(
      'ne constitue pas un reçu fiscal',
    );
    const english = buildDonationReceiptDocumentManifest(
      receipt,
      { ...organization, language: 'en' } as OrganizationDocument,
      contact,
    );
    expect(english.body!.paragraphs[1]).toContain('It is not a tax receipt');

    const pdf = await new DocumentRenderingService().renderPdf(manifest);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
