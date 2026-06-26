import type {
  InternalDeliveryConfig,
  PlaceLocation,
  PriceQuote,
  ProviderQuoteRequest
} from "./types.js";

export function calculateInternalDeliveryQuote(
  request: ProviderQuoteRequest,
  distanceMeters: number,
  config: InternalDeliveryConfig
): PriceQuote {
  const distanceKm = distanceMeters / 1000;
  const amount = applyBounds(calculateAmount(distanceKm, config), config);

  return {
    source: "internal",
    amount,
    currency: request.currency,
    meta: {
      distanceMeters,
      pickupLocation: compactLocation(request.pickupLocation),
      destination: compactLocation(request.destination)
    }
  };
}

function calculateAmount(distanceKm: number, config: InternalDeliveryConfig): number {
  const sortedBands = [...(config.distanceBands ?? [])].sort((a, b) => a.upToKm - b.upToKm);
  const matchingBand = sortedBands.find((band) => distanceKm <= band.upToKm);

  if (matchingBand) {
    return config.baseFee + matchingBand.fee;
  }

  return config.baseFee + distanceKm * config.perKmFee;
}

function applyBounds(amount: number, config: InternalDeliveryConfig): number {
  let boundedAmount = amount;

  if (typeof config.minimumFee === "number") {
    boundedAmount = Math.max(boundedAmount, config.minimumFee);
  }

  if (typeof config.maximumFee === "number") {
    boundedAmount = Math.min(boundedAmount, config.maximumFee);
  }

  return roundMoney(boundedAmount);
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function compactLocation(location: PlaceLocation): Record<string, unknown> {
  return {
    address: location.address,
    placeId: location.placeId,
    coordinates: location.coordinates
  };
}
