export type PricingSource = "bolt" | "yango" | "uber" | "internal";

export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}>;

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface LocationInput {
  address?: string;
  placeId?: string;
  coordinates?: Coordinates;
}

export interface PlaceLocation {
  address: string;
  placeId?: string;
  coordinates: Coordinates;
}

export interface LocationSearchResult {
  description: string;
  placeId: string;
}

export interface DistanceMatrixResult {
  distanceMeters: number;
  durationSeconds?: number;
}

export interface PriceQuote {
  source: PricingSource;
  amount: number;
  currency: string;
  meta?: Record<string, unknown>;
}

export interface ProviderQuoteRequest {
  pickupLocation: PlaceLocation;
  destination: PlaceLocation;
  currency: string;
}

export interface ProviderAdapter {
  getQuote(request: ProviderQuoteRequest): Promise<PriceQuote>;
}

export interface ProviderQuoteResult {
  source: PricingSource;
  ok: boolean;
  quote?: PriceQuote;
  warning?: string;
}

export interface DistanceBand {
  upToKm: number;
  fee: number;
}

export interface InternalDeliveryConfig {
  enabled?: boolean;
  baseFee: number;
  perKmFee: number;
  minimumFee?: number;
  maximumFee?: number;
  distanceBands?: DistanceBand[];
}

export interface DeliveryPricingConfig {
  pickupLocation: LocationInput;
  currency: string;
  fallbackPrice: number;
  googleMapsApiKey: string;
  markupMultiplier?: number;
  providers: {
    bolt: ProviderAdapter;
    yango: ProviderAdapter;
    uber: ProviderAdapter;
  };
  internalDelivery: InternalDeliveryConfig;
  fetch?: FetchLike;
}

export interface ResolvedDeliveryPrice {
  currency: string;
  quotes: ProviderQuoteResult[];
  baseAmount: number;
  baseSource: PricingSource | "fallback";
  markupMultiplier: number;
  finalAmount: number;
  usedFallback: boolean;
  warnings: string[];
}

export interface DeliveryPricingClient {
  searchLocations(query: string): Promise<LocationSearchResult[]>;
  resolveLocation(placeId: string): Promise<PlaceLocation>;
  getDeliveryPrice(destination: LocationInput): Promise<ResolvedDeliveryPrice>;
}
