import { ConfigurationError } from "./errors.js";
import { GoogleMapsClient, normalizeLocation } from "./google-maps.js";
import { calculateInternalDeliveryQuote } from "./internal-delivery.js";
import type {
  DeliveryPricingClient,
  DeliveryPricingConfig,
  FetchLike,
  LocationInput,
  PriceQuote,
  PricingSource,
  ProviderQuoteRequest,
  ProviderQuoteResult,
  ResolvedDeliveryPrice
} from "./types.js";

const REQUIRED_SOURCES: PricingSource[] = ["bolt", "yango", "uber", "internal"];

export function createDeliveryPricingClient(config: DeliveryPricingConfig): DeliveryPricingClient {
  validateConfig(config);

  const fetchImpl = resolveFetch(config.fetch);
  const googleMaps = new GoogleMapsClient(config.googleMapsApiKey, fetchImpl);
  const markupMultiplier = config.markupMultiplier ?? 1.5;

  return {
    searchLocations(query: string) {
      return googleMaps.searchLocations(query);
    },

    resolveLocation(placeId: string) {
      return googleMaps.resolveLocation(placeId);
    },

    async getDeliveryPrice(destination: LocationInput): Promise<ResolvedDeliveryPrice> {
      const [pickupLocation, resolvedDestination] = await Promise.all([
        normalizeLocation(config.pickupLocation, googleMaps),
        normalizeLocation(destination, googleMaps)
      ]);

      const request: ProviderQuoteRequest = {
        pickupLocation,
        destination: resolvedDestination,
        currency: config.currency
      };

      const quoteResults = await Promise.all([
        quoteProvider("bolt", () => config.providers.bolt.getQuote(request), config.currency),
        quoteProvider("yango", () => config.providers.yango.getQuote(request), config.currency),
        quoteProvider("uber", () => config.providers.uber.getQuote(request), config.currency),
        quoteInternal(request, config, googleMaps)
      ]);

      const successfulQuotes = quoteResults
        .filter((result): result is ProviderQuoteResult & { quote: PriceQuote } => result.ok)
        .map((result) => result.quote);

      const warnings = quoteResults
        .filter((result) => !result.ok && result.warning)
        .map((result) => result.warning as string);

      const hasAllSources = REQUIRED_SOURCES.every((source) =>
        quoteResults.some((result) => result.source === source && result.ok)
      );

      const selectedQuote = hasAllSources ? highestQuote(successfulQuotes) : undefined;
      const baseAmount = selectedQuote?.amount ?? config.fallbackPrice;
      const baseSource = selectedQuote?.source ?? "fallback";
      const finalAmount = roundUpWholeAmount(baseAmount * markupMultiplier);

      if (!hasAllSources) {
        warnings.push("Fallback price was used because fewer than four pricing sources succeeded.");
      }

      return {
        currency: config.currency,
        quotes: quoteResults,
        baseAmount,
        baseSource,
        markupMultiplier,
        finalAmount,
        usedFallback: !hasAllSources,
        warnings
      };
    }
  };
}

async function quoteProvider(
  source: Exclude<PricingSource, "internal">,
  getQuote: () => Promise<PriceQuote>,
  expectedCurrency: string
): Promise<ProviderQuoteResult> {
  return captureQuote(source, getQuote, expectedCurrency);
}

async function quoteInternal(
  request: ProviderQuoteRequest,
  config: DeliveryPricingConfig,
  googleMaps: GoogleMapsClient
): Promise<ProviderQuoteResult> {
  if (config.internalDelivery.enabled === false) {
    return {
      source: "internal",
      ok: false,
      warning: "Internal delivery calculation is disabled."
    };
  }

  return captureQuote(
    "internal",
    async () => {
      const distance = await googleMaps.distanceBetween(request.pickupLocation, request.destination);
      return calculateInternalDeliveryQuote(request, distance.distanceMeters, config.internalDelivery);
    },
    config.currency
  );
}

async function captureQuote(
  source: PricingSource,
  getQuote: () => Promise<PriceQuote>,
  expectedCurrency: string
): Promise<ProviderQuoteResult> {
  try {
    const quote = await getQuote();
    validateQuote(source, quote, expectedCurrency);
    return { source, ok: true, quote };
  } catch (error) {
    return {
      source,
      ok: false,
      warning: `${source} quote unavailable: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function validateQuote(source: PricingSource, quote: PriceQuote, expectedCurrency: string): void {
  if (quote.source !== source) {
    throw new Error(`Expected ${source} quote but received ${quote.source}.`);
  }

  if (!Number.isFinite(quote.amount) || quote.amount < 0) {
    throw new Error(`${source} quote amount must be a non-negative number.`);
  }

  if (quote.currency !== expectedCurrency) {
    throw new Error(
      `${source} quote currency ${quote.currency} does not match configured currency ${expectedCurrency}.`
    );
  }
}

function highestQuote(quotes: PriceQuote[]): PriceQuote {
  return quotes.reduce((highest, quote) => (quote.amount > highest.amount ? quote : highest));
}

function roundUpWholeAmount(amount: number): number {
  return Math.ceil(amount - Number.EPSILON);
}

function validateConfig(config: DeliveryPricingConfig): void {
  if (!config.currency.trim()) {
    throw new ConfigurationError("A currency is required.");
  }

  if (!Number.isFinite(config.fallbackPrice) || config.fallbackPrice < 0) {
    throw new ConfigurationError("fallbackPrice must be a non-negative number.");
  }

  if (!config.googleMapsApiKey.trim()) {
    throw new ConfigurationError("A Google Maps API key is required.");
  }

  if (!config.pickupLocation) {
    throw new ConfigurationError("A pickup location is required.");
  }

  for (const source of ["bolt", "yango", "uber"] as const) {
    if (!config.providers[source]?.getQuote) {
      throw new ConfigurationError(`${source} provider adapter is required.`);
    }
  }

  if (!Number.isFinite(config.markupMultiplier ?? 1.5) || (config.markupMultiplier ?? 1.5) < 0) {
    throw new ConfigurationError("markupMultiplier must be a non-negative number.");
  }

  if (!Number.isFinite(config.internalDelivery.baseFee)) {
    throw new ConfigurationError("internalDelivery.baseFee must be a number.");
  }

  if (!Number.isFinite(config.internalDelivery.perKmFee)) {
    throw new ConfigurationError("internalDelivery.perKmFee must be a number.");
  }
}

function resolveFetch(fetchImpl: FetchLike | undefined): FetchLike {
  const candidate = fetchImpl ?? globalThis.fetch;

  if (!candidate) {
    throw new ConfigurationError("A fetch implementation is required in this Node runtime.");
  }

  return candidate as FetchLike;
}
