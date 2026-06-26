export class DeliveryPricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryPricingError";
  }
}

export class ConfigurationError extends DeliveryPricingError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class GoogleMapsError extends DeliveryPricingError {
  constructor(message: string) {
    super(message);
    this.name = "GoogleMapsError";
  }
}
