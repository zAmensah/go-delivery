import assert from "node:assert/strict";
import { test } from "node:test";
import { createDeliveryPricingClient, createMockProviderAdapter } from "../src/index.js";
import type { DeliveryPricingConfig, FetchLike, PriceQuote, ProviderAdapter } from "../src/index.js";

const pickup = {
  address: "Shop",
  coordinates: { lat: 5.56, lng: -0.2 }
};

const destination = {
  address: "Customer",
  coordinates: { lat: 5.6, lng: -0.25 }
};

test("selects the highest of four sources and applies 1.5 multiplier", async () => {
  const client = createDeliveryPricingClient(
    createConfig({
      bolt: createMockProviderAdapter({ source: "bolt", amount: 20 }),
      yango: createMockProviderAdapter({ source: "yango", amount: 25 }),
      uber: createMockProviderAdapter({ source: "uber", amount: 30 })
    })
  );

  const price = await client.getDeliveryPrice(destination);

  assert.equal(price.usedFallback, false);
  assert.equal(price.baseSource, "internal");
  assert.equal(price.baseAmount, 50);
  assert.equal(price.finalAmount, 75);
  assert.equal(price.quotes.length, 4);
});

test("uses fallback price when a provider fails", async () => {
  const client = createDeliveryPricingClient(
    createConfig({
      bolt: createMockProviderAdapter({ source: "bolt", amount: 20 }),
      yango: createMockProviderAdapter({ source: "yango", amount: 25, shouldFail: true }),
      uber: createMockProviderAdapter({ source: "uber", amount: 30 })
    })
  );

  const price = await client.getDeliveryPrice(destination);

  assert.equal(price.usedFallback, true);
  assert.equal(price.baseSource, "fallback");
  assert.equal(price.baseAmount, 99);
  assert.equal(price.finalAmount, 149);
  assert.match(price.warnings.join(" "), /Fallback price was used/);
});

test("rounds the final checkout amount up to a whole currency amount", async () => {
  const client = createDeliveryPricingClient(
    createConfig({
      distanceMeters: 5031.25,
      bolt: createMockProviderAdapter({ source: "bolt", amount: 20 }),
      yango: createMockProviderAdapter({ source: "yango", amount: 25 }),
      uber: createMockProviderAdapter({ source: "uber", amount: 30 })
    })
  );

  const price = await client.getDeliveryPrice(destination);

  assert.equal(price.usedFallback, false);
  assert.equal(price.baseSource, "internal");
  assert.equal(price.baseAmount, 50.25);
  assert.equal(price.finalAmount, 76);
});

test("uses fallback price when a provider returns a different currency", async () => {
  const mismatchedProvider: ProviderAdapter = {
    async getQuote(): Promise<PriceQuote> {
      return {
        source: "uber",
        amount: 30,
        currency: "USD"
      };
    }
  };

  const client = createDeliveryPricingClient(
    createConfig({
      bolt: createMockProviderAdapter({ source: "bolt", amount: 20 }),
      yango: createMockProviderAdapter({ source: "yango", amount: 25 }),
      uber: mismatchedProvider
    })
  );

  const price = await client.getDeliveryPrice(destination);

  assert.equal(price.usedFallback, true);
  assert.equal(price.baseAmount, 99);
  assert.match(price.warnings.join(" "), /does not match configured currency/);
});

test("applies internal delivery minimum, maximum, and distance band rules", async () => {
  const client = createDeliveryPricingClient(
    createConfig({
      internalDelivery: {
        baseFee: 10,
        perKmFee: 100,
        minimumFee: 40,
        maximumFee: 48,
        distanceBands: [{ upToKm: 10, fee: 30 }]
      },
      distanceMeters: 8000,
      bolt: createMockProviderAdapter({ source: "bolt", amount: 20 }),
      yango: createMockProviderAdapter({ source: "yango", amount: 25 }),
      uber: createMockProviderAdapter({ source: "uber", amount: 30 })
    })
  );

  const price = await client.getDeliveryPrice(destination);
  const internalQuote = price.quotes.find((quote) => quote.source === "internal")?.quote;

  assert.equal(internalQuote?.amount, 40);
  assert.equal(price.baseSource, "internal");
  assert.equal(price.finalAmount, 60);
});

test("searches and resolves Google Maps locations", async () => {
  const requests: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = String(input);
    requests.push(url);

    if (url.includes("/autocomplete/")) {
      return jsonResponse({
        status: "OK",
        predictions: [{ description: "Accra Mall, Ghana", place_id: "place-1" }]
      });
    }

    if (url.includes("/details/")) {
      return jsonResponse({
        status: "OK",
        result: {
          formatted_address: "Accra Mall, Accra",
          place_id: "place-1",
          geometry: { location: { lat: 5.622, lng: -0.173 } }
        }
      });
    }

    return jsonResponse({ status: "OK", rows: [{ elements: [{ status: "OK", distance: { value: 1000 } }] }] });
  };

  const client = createDeliveryPricingClient(createConfig({ fetch }));
  const results = await client.searchLocations("Accra Mall");
  const location = await client.resolveLocation("place-1");

  assert.deepEqual(results, [{ description: "Accra Mall, Ghana", placeId: "place-1" }]);
  assert.equal(location.address, "Accra Mall, Accra");
  assert.equal(location.coordinates.lat, 5.622);
  assert.ok(requests.some((request) => request.includes("input=Accra+Mall")));
  assert.ok(requests.some((request) => request.includes("place_id=place-1")));
});

function createConfig(
  overrides: Partial<DeliveryPricingConfig> & {
    distanceMeters?: number;
    bolt?: ProviderAdapter;
    yango?: ProviderAdapter;
    uber?: ProviderAdapter;
  } = {}
): DeliveryPricingConfig {
  const distanceMeters = overrides.distanceMeters ?? 5000;

  return {
    pickupLocation: pickup,
    currency: "GHS",
    fallbackPrice: 99,
    googleMapsApiKey: "test-key",
    markupMultiplier: 1.5,
    providers: {
      bolt: overrides.bolt ?? createMockProviderAdapter({ source: "bolt", amount: 20 }),
      yango: overrides.yango ?? createMockProviderAdapter({ source: "yango", amount: 25 }),
      uber: overrides.uber ?? createMockProviderAdapter({ source: "uber", amount: 30 })
    },
    internalDelivery: {
      baseFee: 10,
      perKmFee: 8,
      ...overrides.internalDelivery
    },
    fetch: overrides.fetch ?? createDistanceFetch(distanceMeters)
  };
}

function createDistanceFetch(distanceMeters: number): FetchLike {
  return async () =>
    jsonResponse({
      status: "OK",
      rows: [
        {
          elements: [
            {
              status: "OK",
              distance: { value: distanceMeters },
              duration: { value: 600 }
            }
          ]
        }
      ]
    });
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return body;
    }
  };
}
