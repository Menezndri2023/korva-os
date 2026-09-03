import { Injectable } from '@nestjs/common';
import type { AiAgent } from '@korva/types';
import type { AiTool } from './tools/tool.interface';

import { SearchContactsTool } from './tools/search-contacts.tool';
import { GetCustomerTool } from './tools/get-customer.tool';
import { CreateCustomerTool } from './tools/create-customer.tool';
import { SearchLeadsTool } from './tools/search-leads.tool';
import { UpdateLeadTool } from './tools/update-lead.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { SearchOffersTool } from './tools/search-offers.tool';
import { GetOfferTool } from './tools/get-offer.tool';
import { GetAvailabilityTool } from './tools/get-availability.tool';
import { CreateQuoteTool } from './tools/create-quote.tool';
import { GetQuoteTool } from './tools/get-quote.tool';
import { CreateBookingTool } from './tools/create-booking.tool';
import { CancelBookingTool } from './tools/cancel-booking.tool';
import { GetOrderTool } from './tools/get-order.tool';
import { CreateOrderTool } from './tools/create-order.tool';
import { GetInvoiceTool } from './tools/get-invoice.tool';
import { GetSalesReportTool } from './tools/get-sales-report.tool';
import { SendEmailTool } from './tools/send-email.tool';
import { SendWhatsappTool } from './tools/send-whatsapp.tool';
import { ListRecommendationsTool } from './tools/list-recommendations.tool';
import { DismissRecommendationTool } from './tools/dismiss-recommendation.tool';
import { ResolveRecommendationTool } from './tools/resolve-recommendation.tool';
import { ProposeRecommendationTool } from './tools/propose-recommendation.tool';

const AGENT_TOOL_NAMES: Record<AiAgent, string[]> = {
  sales_agent: [
    'search_contacts',
    'get_customer',
    'create_customer',
    'search_leads',
    'update_lead',
    'create_task',
    'search_offers',
    'get_offer',
    'create_quote',
    'get_quote',
    'send_email',
    'send_whatsapp',
    'list_recommendations',
    'dismiss_recommendation',
    'resolve_recommendation',
    'propose_recommendation',
  ],
  booking_agent: [
    'search_contacts',
    'get_customer',
    'search_offers',
    'get_offer',
    'get_availability',
    'create_booking',
    'cancel_booking',
    'get_order',
    'create_order',
  ],
  analytics_agent: [
    'get_sales_report',
    'search_offers',
    'get_order',
    'get_quote',
    'get_invoice',
    'list_recommendations',
    'propose_recommendation',
  ],
  general_assistant: [], // filled below with every tool
};

@Injectable()
export class AiToolsRegistryService {
  private readonly tools: AiTool[];

  constructor(
    searchContacts: SearchContactsTool,
    getCustomer: GetCustomerTool,
    createCustomer: CreateCustomerTool,
    searchLeads: SearchLeadsTool,
    updateLead: UpdateLeadTool,
    createTask: CreateTaskTool,
    searchOffers: SearchOffersTool,
    getOffer: GetOfferTool,
    getAvailability: GetAvailabilityTool,
    createQuote: CreateQuoteTool,
    getQuote: GetQuoteTool,
    createBooking: CreateBookingTool,
    cancelBooking: CancelBookingTool,
    getOrder: GetOrderTool,
    createOrder: CreateOrderTool,
    getInvoice: GetInvoiceTool,
    getSalesReport: GetSalesReportTool,
    sendEmail: SendEmailTool,
    sendWhatsapp: SendWhatsappTool,
    listRecommendations: ListRecommendationsTool,
    dismissRecommendation: DismissRecommendationTool,
    resolveRecommendation: ResolveRecommendationTool,
    proposeRecommendation: ProposeRecommendationTool,
  ) {
    this.tools = [
      searchContacts,
      getCustomer,
      createCustomer,
      searchLeads,
      updateLead,
      createTask,
      searchOffers,
      getOffer,
      getAvailability,
      createQuote,
      getQuote,
      createBooking,
      cancelBooking,
      getOrder,
      createOrder,
      getInvoice,
      getSalesReport,
      sendEmail,
      sendWhatsapp,
      listRecommendations,
      dismissRecommendation,
      resolveRecommendation,
      proposeRecommendation,
    ];
    AGENT_TOOL_NAMES.general_assistant = this.tools.map(
      (tool) => tool.definition.name,
    );
  }

  getByName(name: string): AiTool | undefined {
    return this.tools.find((tool) => tool.definition.name === name);
  }

  listForAgent(agent: AiAgent): AiTool[] {
    const names = new Set(AGENT_TOOL_NAMES[agent]);
    return this.tools.filter((tool) => names.has(tool.definition.name));
  }
}
