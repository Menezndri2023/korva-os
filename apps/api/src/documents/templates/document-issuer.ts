import type { DocumentTemplate } from '../rendering/document-rendering.service';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';

/**
 * Who issues a business's invoice, quote or receipt, as the law expects it printed: the legal
 * name when the business gave one (else its trading name), its address, its phone, and its legal
 * identifiers (RCCM and NCC in Côte d'Ivoire, ICE and RC in Morocco, SIRET in France…) exactly as
 * the business typed them in Settings. Before this, a KORVA invoice carried the trading name and
 * nothing else — not something an accountant or a tax office accepts.
 */
export function organizationIssuer(
  organization: Pick<
    OrganizationDocument,
    | 'name'
    | 'legalName'
    | 'contactAddress'
    | 'contactPhone'
    | 'legalIdentifiers'
  >,
): DocumentTemplate['organizationHeader'] {
  const legalName = organization.legalName?.trim();
  const lines = [
    legalName && legalName !== organization.name
      ? organization.name
      : undefined,
    organization.contactPhone?.trim(),
    organization.legalIdentifiers?.trim(),
  ].filter((line): line is string => Boolean(line));
  return {
    name: legalName || organization.name,
    ...(organization.contactAddress?.trim()
      ? { address: organization.contactAddress.trim() }
      : {}),
    ...(lines.length > 0 ? { lines } : {}),
  };
}
