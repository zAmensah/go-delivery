import type { PriceQuote, PricingSource, ProviderAdapter, ProviderQuoteRequest } from "./types.js";

export interface MockProviderOptions {
  source: Exclude<PricingSource, "internal">;
  amount: number;
  delayMs?: number;
  shouldFail?: boolean;
}

export function createMockProviderAdapter(options: MockProviderOptions): ProviderAdapter {
  return {
    async getQuote(request: ProviderQuoteRequest): Promise<PriceQuote> {
      if (options.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      }

      if (options.shouldFail) {
        throw new Error(`${options.source} mock quote failed.`);
      }

      return {
        source: options.source,
        amount: options.amount,
        currency: request.currency,
        meta: {
          mock: true
        }
      };
    }
  };
}
