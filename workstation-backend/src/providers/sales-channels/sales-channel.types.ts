export type SalesSendMessageInput = {
  to: string;
  content: string;
  subject?: string;
  from?: string;
};

export type SalesSendResult = {
  providerMessageId: string;
  providerMetadata?: Record<string, unknown>;
};

export interface SalesChannelGateway {
  isConfigured(): boolean;
  sendMessage(input: SalesSendMessageInput): Promise<SalesSendResult>;
}
